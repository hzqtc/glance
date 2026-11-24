package handler

import (
	"bytes"
	"encoding/binary"
	"encoding/json"
	"io"
	"math"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
)

func TestParsePhotoAlbumURLsFromEnv(t *testing.T) {
	t.Setenv("PHOTOS_ALBUM_URLS", "")
	t.Setenv("PHOTOS_ALBUM_URL", "https://photos.app.goo.gl/abc123, https://photos.google.com/share/xyz")
	urls := parsePhotoAlbumURLsFromEnv()
	if len(urls) != 2 || urls[0] != "https://photos.app.goo.gl/abc123" || urls[1] != "https://photos.google.com/share/xyz" {
		t.Fatalf("unexpected comma-separated album urls: %+v", urls)
	}

	t.Setenv("PHOTOS_ALBUM_URLS", `["https://photos.app.goo.gl/one","https://photos.app.goo.gl/two"]`)
	urls2 := parsePhotoAlbumURLsFromEnv()
	if len(urls2) != 2 || urls2[0] != "https://photos.app.goo.gl/one" || urls2[1] != "https://photos.app.goo.gl/two" {
		t.Fatalf("unexpected json album urls: %+v", urls2)
	}
}

func TestParseGooglePhotosAlbumHTMLAndHandler(t *testing.T) {
	mockHTML := `<!doctype html><html><head></head><body><script>
AF_initDataCallback({key: 'ds:1', hash: '2', data:[null,[
  ["id1",["https://lh3.googleusercontent.com/pw/AP1GczLandscapePhoto001",4032,3024,null,null]],
  ["id2",["https://lh3.googleusercontent.com/pw/AP1GczPortraitPhoto002",3024,4032,null,null]],
  ["id3",["https://lh3.googleusercontent.com/pw/AP1GczLandscapePhoto001=w400-h300",4032,3024,null,null]],
  ["id4",["https://lh3.googleusercontent.com/pw/AP1GczTinyIcon003",96,96,null,null]],
  ["id5",["https://lh3.googleusercontent.com/a/ACg8ocAvatarNotAPhoto",512,512,null,null]]
]], sideChannel: {}});
</script></body></html>`

	origClient := photosHTTPClient
	photosHTTPClient = &http.Client{
		Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
			return &http.Response{
				StatusCode: http.StatusOK,
				Header:     http.Header{"Content-Type": []string{"text/html; charset=utf-8"}},
				Body:       io.NopCloser(bytes.NewBufferString(mockHTML)),
			}, nil
		}),
	}
	defer func() {
		photosHTTPClient = origClient
		photosCacheMu.Lock()
		photosCache = map[string]photosCacheEntry{}
		photoBaseURLByID = map[string]string{}
		photosCacheMu.Unlock()
	}()

	t.Setenv("PHOTOS_ALBUM_URLS", "")
	t.Setenv("PHOTOS_ALBUM_URL", "https://photos.app.goo.gl/testalbum")

	req := httptest.NewRequest(http.MethodGet, "/api/photos", nil)
	rec := httptest.NewRecorder()
	PhotosHandler(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	if cc := rec.Header().Get("Cache-Control"); cc != "private, no-store" {
		t.Fatalf("expected private, no-store Cache-Control, got %q", cc)
	}

	var resp PhotosResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("invalid json: %v", err)
	}
	if !resp.Configured || resp.AlbumCount != 1 || resp.PhotoCount != 2 || len(resp.Photos) != 2 {
		t.Fatalf("unexpected photos response: %+v", resp)
	}
	if resp.Photos[0].Width != 4032 || resp.Photos[0].Height != 3024 || resp.Photos[0].FullURL != "https://lh3.googleusercontent.com/pw/AP1GczLandscapePhoto001=w1600-h1200" {
		t.Fatalf("unexpected landscape photo: %+v", resp.Photos[0])
	}
	if resp.Photos[1].Width != 3024 || resp.Photos[1].Height != 4032 || resp.Photos[1].TileURL != "https://lh3.googleusercontent.com/pw/AP1GczPortraitPhoto002=w1000-h1000" {
		t.Fatalf("unexpected portrait photo: %+v", resp.Photos[1])
	}

	// Unconfigured env should return configured=false gracefully
	t.Setenv("PHOTOS_ALBUM_URL", "")
	req2 := httptest.NewRequest(http.MethodGet, "/api/photos", nil)
	rec2 := httptest.NewRecorder()
	PhotosHandler(rec2, req2)
	if rec2.Code != http.StatusOK {
		t.Fatalf("expected 200 when unconfigured, got %d", rec2.Code)
	}
	var emptyResp PhotosResponse
	_ = json.Unmarshal(rec2.Body.Bytes(), &emptyResp)
	if emptyResp.Configured || len(emptyResp.Photos) != 0 {
		t.Fatalf("expected configured=false and 0 photos, got %+v", emptyResp)
	}
}

func TestParseGooglePhotosAlbumHTMLFiltersVideos(t *testing.T) {
	mockHTML := `<!doctype html><html><head></head><body><script>
AF_initDataCallback({key: 'ds:1', hash: '2', data:[null,[
  ["photo1",["https://lh3.googleusercontent.com/pw/AP1GczStillPhoto001",2784,1856,null,null],1766453864790,"k1",36000000,1795323524027,["owner"],[[2]],2,{"15":152499,"101428965":[0,"abc"],"525000002":[["x"]]}],
  ["video1",["https://lh3.googleusercontent.com/pw/AP1GczVideoPoster001",2160,3840,null,null],1766507636000,"k2",-18000000,1795323524027,["owner"],[[2]],2,{"15":152499,"76647426":[15566,null,1080,1920,null,4,134,null,[["stream"]],0,null,null,null,["https://lh3.googleusercontent.com/pw/AP1GczVideoThumbNested001"]],"101428965":[0,"def"]}],
  ["video2",["https://lh3.googleusercontent.com/pw/AP1GczVideoLegacy002",1920,1080,null,null],1766507637000,"k3",-18000000,1795323524027,["owner"],[[2]],2,{"15":152499,"999":["https://video-downloads.googleusercontent.com/stream123"]}],
  ["photo2",["https://lh3.googleusercontent.com/pw/AP1GczStillPhoto002",3024,4032,null,null],1766507638000,"k4",36000000,1795323524027,["owner"],[[2]],2,{"15":152499,"101428965":[0,"ghi"]}]
],null,["https://lh3.googleusercontent.com/pw/AP1GczVideoPoster001",2160,3840]], sideChannel: {}});
</script></body></html>`

	items := parseGooglePhotosAlbumHTML(mockHTML)
	if len(items) != 2 {
		t.Fatalf("expected 2 still photos after filtering videos, got %d: %+v", len(items), items)
	}
	if items[0].FullURL != "https://lh3.googleusercontent.com/pw/AP1GczStillPhoto001=w1600-h1200" {
		t.Fatalf("unexpected first photo: %+v", items[0])
	}
	if items[0].TakenAt != 1766453864790 || items[0].TakenDate != "Dec 23, 2025" {
		t.Fatalf("expected Dec 23, 2025 from UTC+10 timestamp, got takenAt=%d takenDate=%q", items[0].TakenAt, items[0].TakenDate)
	}
	if items[1].FullURL != "https://lh3.googleusercontent.com/pw/AP1GczStillPhoto002=w1600-h1200" {
		t.Fatalf("unexpected second photo: %+v", items[1])
	}
	if items[1].TakenAt != 1766507638000 || items[1].TakenDate != "Dec 24, 2025" {
		t.Fatalf("expected Dec 24, 2025 from UTC+10 timestamp crossing midnight, got takenAt=%d takenDate=%q", items[1].TakenAt, items[1].TakenDate)
	}
}

func TestParseGooglePhotosAlbumHTMLAllVideosReturnsEmpty(t *testing.T) {
	mockHTML := `<!doctype html><html><body><script>
AF_initDataCallback({key: 'ds:1', hash: '2', data:[null,[
  ["video1",["https://lh3.googleusercontent.com/pw/AP1GczOnlyVideo001",1920,1080,null,null],1766507636000,"k1",0,1,["owner"],[],2,{"76647426":[9000,null,1920,1080]}]
]], sideChannel: {}});
</script></body></html>`

	items := parseGooglePhotosAlbumHTML(mockHTML)
	if len(items) != 0 {
		t.Fatalf("expected 0 items when album only contains videos (must not fall back to regex), got %d: %+v", len(items), items)
	}
}

func TestFetchAlbumPhotosDetectsGoogleSignInRedirect(t *testing.T) {
	origClient := photosHTTPClient
	photosHTTPClient = &http.Client{
		Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
			redirectReq, _ := http.NewRequest(http.MethodGet, "https://accounts.google.com/v3/signin/identifier", nil)
			return &http.Response{
				StatusCode: http.StatusOK,
				Request:    redirectReq,
				Header:     http.Header{"Content-Type": []string{"text/html; charset=utf-8"}},
				Body:       io.NopCloser(bytes.NewBufferString("<html>Sign in</html>")),
			}, nil
		}),
	}
	defer func() {
		photosHTTPClient = origClient
		photosCacheMu.Lock()
		photosCache = map[string]photosCacheEntry{}
		photoBaseURLByID = map[string]string{}
		photosCacheMu.Unlock()
	}()

	_, err := fetchAlbumPhotosCached("https://photos.app.goo.gl/privatealbum", true)
	if err == nil || !bytes.Contains([]byte(err.Error()), []byte("sign-in")) {
		t.Fatalf("expected sign-in diagnostic error, got: %v", err)
	}
}

func buildMockExifGPSPayload(order binary.ByteOrder, latRef string, latDeg, latMin, latSec uint32, lonRef string, lonDeg, lonMin, lonSec uint32) []byte {
	var tiff bytes.Buffer
	if order == binary.LittleEndian {
		tiff.Write([]byte{'I', 'I'})
	} else {
		tiff.Write([]byte{'M', 'M'})
	}
	_ = binary.Write(&tiff, order, uint16(0x002a))
	_ = binary.Write(&tiff, order, uint32(8)) // IFD0 offset

	// IFD0: 1 entry (GPSInfoIFDPointer = 0x8825)
	// IFD0 starts at 8, size = 2 + 12 + 4 = 18 -> GPS IFD starts at 26
	gpsIFDOffset := uint32(26)
	_ = binary.Write(&tiff, order, uint16(1))
	_ = binary.Write(&tiff, order, uint16(0x8825))
	_ = binary.Write(&tiff, order, uint16(4)) // LONG
	_ = binary.Write(&tiff, order, uint32(1))
	_ = binary.Write(&tiff, order, gpsIFDOffset)
	_ = binary.Write(&tiff, order, uint32(0)) // next IFD

	// GPS IFD at 26: 4 entries -> size = 2 + 4*12 + 4 = 54 -> rationals start at 80
	latRatOff := uint32(80)
	lonRatOff := uint32(104)
	_ = binary.Write(&tiff, order, uint16(4))

	// Tag 1: GPSLatitudeRef
	_ = binary.Write(&tiff, order, uint16(0x0001))
	_ = binary.Write(&tiff, order, uint16(2))
	_ = binary.Write(&tiff, order, uint32(2))
	refBytes := [4]byte{}
	copy(refBytes[:], latRef)
	tiff.Write(refBytes[:])

	// Tag 2: GPSLatitude
	_ = binary.Write(&tiff, order, uint16(0x0002))
	_ = binary.Write(&tiff, order, uint16(5))
	_ = binary.Write(&tiff, order, uint32(3))
	_ = binary.Write(&tiff, order, latRatOff)

	// Tag 3: GPSLongitudeRef
	_ = binary.Write(&tiff, order, uint16(0x0003))
	_ = binary.Write(&tiff, order, uint16(2))
	_ = binary.Write(&tiff, order, uint32(2))
	lonRefBytes := [4]byte{}
	copy(lonRefBytes[:], lonRef)
	tiff.Write(lonRefBytes[:])

	// Tag 4: GPSLongitude
	_ = binary.Write(&tiff, order, uint16(0x0004))
	_ = binary.Write(&tiff, order, uint16(5))
	_ = binary.Write(&tiff, order, uint32(3))
	_ = binary.Write(&tiff, order, lonRatOff)

	_ = binary.Write(&tiff, order, uint32(0)) // next IFD

	// Rationals (deg/1, min/1, sec*100/100)
	for _, pair := range [][2]uint32{
		{latDeg, 1}, {latMin, 1}, {latSec, 100},
		{lonDeg, 1}, {lonMin, 1}, {lonSec, 100},
	} {
		_ = binary.Write(&tiff, order, pair[0])
		_ = binary.Write(&tiff, order, pair[1])
	}

	var full bytes.Buffer
	// Prefix with a HEIC-style iinf false-positive "Exif\x00\x00" box name before real EXIF
	full.WriteString("ftypheic....iinfExif\x00\x00not_tiff....")
	full.Write([]byte{'E', 'x', 'i', 'f', 0, 0})
	full.Write(tiff.Bytes())
	return full.Bytes()
}

func TestExtractEXIFGPS(t *testing.T) {
	// Big-endian: 37° 17' 28.00" N, 121° 59' 17.00" W (Campbell/San Jose, CA)
	be := buildMockExifGPSPayload(binary.BigEndian, "N", 37, 17, 2800, "W", 121, 59, 1700)
	lat, lon, ok := extractEXIFGPS(be)
	if !ok {
		t.Fatalf("expected big-endian GPS extraction to succeed")
	}
	if math.Abs(lat-37.291111) > 0.001 || math.Abs(lon-(-121.988055)) > 0.001 {
		t.Fatalf("unexpected big-endian coords: lat=%f lon=%f", lat, lon)
	}

	// Little-endian: 33° 52' 08.00" S, 151° 12' 33.00" E (Sydney)
	le := buildMockExifGPSPayload(binary.LittleEndian, "S", 33, 52, 800, "E", 151, 12, 3300)
	lat2, lon2, ok2 := extractEXIFGPS(le)
	if !ok2 {
		t.Fatalf("expected little-endian GPS extraction to succeed")
	}
	if math.Abs(lat2-(-33.868888)) > 0.001 || math.Abs(lon2-151.209166) > 0.001 {
		t.Fatalf("unexpected little-endian coords: lat=%f lon=%f", lat2, lon2)
	}

	// Reject Null Island (0, 0)
	zero := buildMockExifGPSPayload(binary.BigEndian, "N", 0, 0, 0, "E", 0, 0, 0)
	if _, _, ok3 := extractEXIFGPS(zero); ok3 {
		t.Fatalf("expected Null Island (0,0) to be rejected")
	}
}

func TestFormatReverseGeocodeLabel(t *testing.T) {
	cases := []struct {
		in   bigDataCloudReverseResp
		want string
	}{
		{
			in:   bigDataCloudReverseResp{City: "San Francisco", PrincipalSubdivision: "California", PrincipalSubdivisionCode: "US-CA", CountryCode: "US", CountryName: "United States of America"},
			want: "San Francisco, CA",
		},
		{
			in:   bigDataCloudReverseResp{City: "Vancouver", PrincipalSubdivision: "British Columbia", PrincipalSubdivisionCode: "CA-BC", CountryCode: "CA", CountryName: "Canada"},
			want: "Vancouver, BC",
		},
		{
			in:   bigDataCloudReverseResp{City: "London", CountryCode: "GB", CountryName: "United Kingdom of Great Britain and Northern Ireland"},
			want: "London, UK",
		},
		{
			in:   bigDataCloudReverseResp{City: "Shimukappu", PrincipalSubdivision: "Hokkaido", CountryCode: "JP", CountryName: "Japan"},
			want: "Shimukappu, Japan",
		},
		{
			in:   bigDataCloudReverseResp{City: "Singapore", CountryCode: "SG", CountryName: "Singapore"},
			want: "Singapore",
		},
		{
			in:   bigDataCloudReverseResp{Locality: "Big Sur", PrincipalSubdivision: "California", PrincipalSubdivisionCode: "US-CA", CountryCode: "US"},
			want: "Big Sur, CA",
		},
	}
	for _, tc := range cases {
		if got := formatReverseGeocodeLabel(tc.in); got != tc.want {
			t.Fatalf("formatReverseGeocodeLabel(%+v) = %q, want %q", tc.in, got, tc.want)
		}
	}
}

func TestPhotosHandlerLocateEndpoint(t *testing.T) {
	mockHTML := `<!doctype html><html><body><script>
AF_initDataCallback({key: 'ds:1', hash: '2', data:[null,[
  ["photo1",["https://lh3.googleusercontent.com/pw/AP1GczGeoPhoto001",4032,3024,null,null],1766453864790,"k1",-28800000,1795323524027,["owner"],[[2]],2,{"15":152499}],
  ["photo2",["https://lh3.googleusercontent.com/pw/AP1GczNoGpsPhoto002",4032,3024,null,null],1766453864790,"k2",-28800000,1795323524027,["owner"],[[2]],2,{"15":152499}]
]], sideChannel: {}});
</script></body></html>`

	exifPayload := buildMockExifGPSPayload(binary.BigEndian, "N", 37, 17, 2800, "W", 121, 59, 1700)
	var (
		rangeMu   sync.Mutex
		rangeSeen string
	)

	origPhotosClient := photosHTTPClient
	origGeoClient := geoHTTPClient
	photosHTTPClient = &http.Client{
		Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
			if strings.Contains(r.URL.Host, "photos.app.goo.gl") {
				return &http.Response{
					StatusCode: http.StatusOK,
					Header:     http.Header{"Content-Type": []string{"text/html; charset=utf-8"}},
					Body:       io.NopCloser(bytes.NewBufferString(mockHTML)),
				}, nil
			}
			rangeMu.Lock()
			rangeSeen = r.Header.Get("Range")
			rangeMu.Unlock()
			if strings.Contains(r.URL.Path, "AP1GczGeoPhoto001") {
				return &http.Response{
					StatusCode: http.StatusPartialContent,
					Header:     http.Header{"Content-Type": []string{"image/heic"}},
					Body:       io.NopCloser(bytes.NewReader(exifPayload)),
				}, nil
			}
			return &http.Response{
				StatusCode: http.StatusPartialContent,
				Header:     http.Header{"Content-Type": []string{"image/jpeg"}},
				Body:       io.NopCloser(bytes.NewBufferString("not-gps-exif-data-padding-01234567890123456789")),
			}, nil
		}),
	}
	geoHTTPClient = &http.Client{
		Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
			return &http.Response{
				StatusCode: http.StatusOK,
				Header:     http.Header{"Content-Type": []string{"application/json"}},
				Body:       io.NopCloser(bytes.NewBufferString(`{"city":"San Jose","principalSubdivision":"California","principalSubdivisionCode":"US-CA","countryCode":"US","countryName":"United States of America"}`)),
			}, nil
		}),
	}
	defer func() {
		photosHTTPClient = origPhotosClient
		geoHTTPClient = origGeoClient
		photosCacheMu.Lock()
		photosCache = map[string]photosCacheEntry{}
		photoBaseURLByID = map[string]string{}
		photoLocationCache = map[string]photoLocationEntry{}
		geoLabelCache = map[string]string{}
		photosCacheMu.Unlock()
	}()

	t.Setenv("PHOTOS_ALBUM_URLS", "")
	t.Setenv("PHOTOS_ALBUM_URL", "https://photos.app.goo.gl/geotest")

	// First fetch album to get IDs
	rec := httptest.NewRecorder()
	PhotosHandler(rec, httptest.NewRequest(http.MethodGet, "/api/photos", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
	var listResp PhotosResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &listResp); err != nil {
		t.Fatalf("invalid json: %v", err)
	}
	if len(listResp.Photos) != 2 {
		t.Fatalf("expected 2 photos, got %d", len(listResp.Photos))
	}

	// Now query ?locate=id1,id2
	locateURL := "/api/photos?locate=" + listResp.Photos[0].ID + "," + listResp.Photos[1].ID
	rec2 := httptest.NewRecorder()
	PhotosHandler(rec2, httptest.NewRequest(http.MethodGet, locateURL, nil))
	if rec2.Code != http.StatusOK {
		t.Fatalf("expected 200 on locate, got %d: %s", rec2.Code, rec2.Body.String())
	}
	if !strings.HasPrefix(rangeSeen, "bytes=0-") {
		t.Fatalf("expected Range header on =d request, got %q", rangeSeen)
	}

	var locResp PhotoLocationsResponse
	if err := json.Unmarshal(rec2.Body.Bytes(), &locResp); err != nil {
		t.Fatalf("invalid locate json: %v", err)
	}
	if got := locResp.Locations[listResp.Photos[0].ID]; got != "San Jose, CA" {
		t.Fatalf("expected San Jose, CA for GPS photo, got %q (all: %+v)", got, locResp.Locations)
	}
	if got := locResp.Locations[listResp.Photos[1].ID]; got != "" {
		t.Fatalf("expected empty location for non-GPS photo, got %q", got)
	}
}
