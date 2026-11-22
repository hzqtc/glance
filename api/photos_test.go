package handler

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
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
	if items[1].FullURL != "https://lh3.googleusercontent.com/pw/AP1GczStillPhoto002=w1600-h1200" {
		t.Fatalf("unexpected second photo: %+v", items[1])
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
