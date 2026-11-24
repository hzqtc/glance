package handler

import (
	"bytes"
	"crypto/sha1"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net/http"
	"os"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"glance/auth"
)

var (
	photosHTTPClient = &http.Client{Timeout: 12 * time.Second}
	geoHTTPClient    = &http.Client{Timeout: 6 * time.Second}

	photosCacheMu      sync.Mutex
	photosCache        = map[string]photosCacheEntry{}
	photoBaseURLByID   = map[string]string{}
	photoLocationCache = map[string]photoLocationEntry{}
	geoLabelCache      = map[string]string{}

	reverseGeocodeBaseURL = "https://api.bigdatacloud.net/data/reverse-geocode-client"

	// Primary pattern in Google Photos shared album AF_initDataCallback payloads:
	// ["https://lh3.googleusercontent.com/pw/...",4032,3024,...]
	reGooglePhotoPW = regexp.MustCompile(`"(https://lh3\.googleusercontent\.com/pw/[^"\\=]+)(?:=[^"\\]*)?"\s*,\s*(\d{2,5})\s*,\s*(\d{2,5})`)

	// Fallback pattern for older shared albums without /pw/ prefix (excludes /a/ avatars)
	reGooglePhotoLegacy = regexp.MustCompile(`"(https://lh3\.googleusercontent\.com/[A-Za-z0-9_-]{32,})(?:=[^"\\]*)?"\s*,\s*(\d{3,5})\s*,\s*(\d{3,5})`)

	// Strict URL validator for structured AF_initDataCallback photo items
	reValidGooglePhotoURL = regexp.MustCompile(`^https://lh3\.googleusercontent\.com/(?:pw/[^"\\=]+|[A-Za-z0-9_-]{32,})$`)
)

const (
	photosCacheTTL        = 15 * time.Minute
	photoLocationCacheTTL = 24 * time.Hour
	maxPhotosPerRequest   = 500
	maxAlbumHTMLBytes     = 12 * 1024 * 1024
	maxLocateIDsPerReq    = 6
	exifRangeMaxBytes     = 262144 // 256 KB covers JPEG APP1 and HEIC EXIF blocks
	maxLocationCacheSize  = 2000
	minValidPhotoEpochMs  = 315532800000  // 1980-01-01T00:00:00Z
	maxValidPhotoEpochMs  = 4102444800000 // 2100-01-01T00:00:00Z
	maxValidTzOffsetMs    = 14 * 3600 * 1000
)

type photosCacheEntry struct {
	photos    []PhotoItem
	fetchedAt time.Time
}

type photoLocationEntry struct {
	location  string
	fetchedAt time.Time
}

type PhotoItem struct {
	ID        string  `json:"id"`
	FullURL   string  `json:"fullUrl"`
	TileURL   string  `json:"tileUrl"`
	Width     int     `json:"width"`
	Height    int     `json:"height"`
	Aspect    float64 `json:"aspect"`
	TakenAt   int64   `json:"takenAt,omitempty"`
	TakenDate string  `json:"takenDate,omitempty"`
	Location  string  `json:"location,omitempty"`
	baseURL   string
}

type PhotosResponse struct {
	FetchedAt  string      `json:"fetchedAt"`
	Configured bool        `json:"configured"`
	AlbumCount int         `json:"albumCount"`
	PhotoCount int         `json:"photoCount"`
	Photos     []PhotoItem `json:"photos"`
	Warnings   []string    `json:"warnings,omitempty"`
}

type PhotoLocationsResponse struct {
	Locations map[string]string `json:"locations"`
}

// PhotosHandler serves GET /api/photos on Vercel (and locally via cmd/devserver).
func PhotosHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		auth.WriteJSONError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	if !auth.RequireAuth(w, r) {
		return
	}

	if locateRaw := strings.TrimSpace(r.URL.Query().Get("locate")); locateRaw != "" {
		handleLocatePhotos(w, r, locateRaw)
		return
	}

	albumURLs := parsePhotoAlbumURLsFromEnv()
	forceRefresh := r.URL.Query().Get("refresh") == "1"

	var (
		allPhotos []PhotoItem
		warnings  []string
		seenURLs  = make(map[string]bool)
		mu        sync.Mutex
		wg        sync.WaitGroup
	)

	for idx, albumURL := range albumURLs {
		wg.Add(1)
		go func(i int, rawURL string) {
			defer wg.Done()
			items, err := fetchAlbumPhotosCached(rawURL, forceRefresh)
			mu.Lock()
			defer mu.Unlock()
			if err != nil {
				warnings = append(warnings, fmt.Sprintf("Album %d: %v", i+1, err))
				return
			}
			for _, item := range items {
				if len(allPhotos) >= maxPhotosPerRequest {
					break
				}
				if seenURLs[item.ID] {
					continue
				}
				seenURLs[item.ID] = true
				allPhotos = append(allPhotos, item)
			}
		}(idx, albumURL)
	}
	wg.Wait()

	if len(allPhotos) > 0 {
		now := time.Now()
		photosCacheMu.Lock()
		for i := range allPhotos {
			if entry, ok := photoLocationCache[allPhotos[i].baseURL]; ok && entry.location != "" && now.Sub(entry.fetchedAt) < photoLocationCacheTTL {
				allPhotos[i].Location = entry.location
			}
		}
		photosCacheMu.Unlock()
	}

	if allPhotos == nil {
		allPhotos = []PhotoItem{}
	}

	resp := PhotosResponse{
		FetchedAt:  time.Now().UTC().Format(time.RFC3339),
		Configured: len(albumURLs) > 0,
		AlbumCount: len(albumURLs),
		PhotoCount: len(allPhotos),
		Photos:     allPhotos,
		Warnings:   warnings,
	}

	// Private photo album metadata must never be cached publicly on shared CDN edges
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "private, no-store")
	w.WriteHeader(http.StatusOK)
	if r.Method == http.MethodHead {
		return
	}
	_ = json.NewEncoder(w).Encode(resp)
}

func parsePhotoAlbumURLsFromEnv() []string {
	raw := strings.TrimSpace(os.Getenv("PHOTOS_ALBUM_URLS"))
	if raw == "" {
		raw = strings.TrimSpace(os.Getenv("PHOTOS_ALBUM_URL"))
	}
	if raw == "" {
		return nil
	}

	var urls []string
	// Support JSON array ["https://photos.app.goo.gl/...", ...]
	if strings.HasPrefix(raw, "[") {
		var parsed []string
		if err := json.Unmarshal([]byte(raw), &parsed); err == nil {
			for _, u := range parsed {
				if clean := normalizeAlbumURL(u); clean != "" {
					urls = append(urls, clean)
				}
			}
			return urls
		}
	}

	// Otherwise comma or newline separated URLs
	for _, part := range strings.FieldsFunc(raw, func(r rune) bool {
		return r == ',' || r == '\n' || r == '\r'
	}) {
		if clean := normalizeAlbumURL(part); clean != "" {
			urls = append(urls, clean)
		}
	}
	return urls
}

func normalizeAlbumURL(raw string) string {
	u := strings.TrimSpace(strings.Trim(raw, `"'`))
	if u == "" {
		return ""
	}
	lower := strings.ToLower(u)
	if !strings.HasPrefix(lower, "https://") && !strings.HasPrefix(lower, "http://") {
		return ""
	}
	return u
}

func fetchAlbumPhotosCached(albumURL string, forceRefresh bool) ([]PhotoItem, error) {
	if !forceRefresh {
		photosCacheMu.Lock()
		entry, ok := photosCache[albumURL]
		photosCacheMu.Unlock()
		if ok && time.Since(entry.fetchedAt) < photosCacheTTL {
			return entry.photos, nil
		}
	}

	req, err := http.NewRequest(http.MethodGet, albumURL, nil)
	if err != nil {
		return nil, err
	}
	// IMPORTANT: Use a non-browser User-Agent so Firebase Dynamic Links (photos.app.goo.gl)
	// returns a direct HTTP 302 redirect to photos.google.com/share/... instead of an HTML JS stub.
	req.Header.Set("User-Agent", "Glance/1.0")
	req.Header.Set("Accept", "text/html,application/xhtml+xml,*/*;q=0.8")

	resp, err := photosHTTPClient.Do(req)
	if err != nil {
		// Fall back to stale cache if available
		photosCacheMu.Lock()
		entry, ok := photosCache[albumURL]
		photosCacheMu.Unlock()
		if ok && len(entry.photos) > 0 {
			return entry.photos, nil
		}
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("HTTP %d", resp.StatusCode)
	}
	if resp.Request != nil && resp.Request.URL != nil && strings.Contains(strings.ToLower(resp.Request.URL.Host), "accounts.google.") {
		return nil, fmt.Errorf("album requires sign-in — enable link sharing")
	}

	bodyBytes, err := io.ReadAll(io.LimitReader(resp.Body, maxAlbumHTMLBytes))
	if err != nil {
		return nil, err
	}

	items := parseGooglePhotosAlbumHTML(string(bodyBytes))
	if len(items) == 0 {
		return nil, fmt.Errorf("no photos found in shared album page")
	}

	photosCacheMu.Lock()
	photosCache[albumURL] = photosCacheEntry{
		photos:    items,
		fetchedAt: time.Now(),
	}
	for _, it := range items {
		if it.ID != "" && it.baseURL != "" {
			photoBaseURLByID[it.ID] = it.baseURL
		}
	}
	photosCacheMu.Unlock()

	return items, nil
}

func parseGooglePhotosAlbumHTML(html string) []PhotoItem {
	// Prefer structured AF_initDataCallback JSON parsing so we can reliably
	// inspect per-item metadata and exclude videos (key "76647426").
	if items, found := parseGooglePhotosFromInitData(html); found {
		return items
	}
	return parseGooglePhotosFromRegex(html)
}

func parseGooglePhotosFromInitData(html string) ([]PhotoItem, bool) {
	const marker = "AF_initDataCallback("
	seen := make(map[string]bool)
	var out []PhotoItem
	foundMediaList := false

	searchFrom := 0
	for {
		idx := strings.Index(html[searchFrom:], marker)
		if idx < 0 {
			break
		}
		blockStart := searchFrom + idx + len(marker)
		scriptEndRel := strings.Index(html[blockStart:], "</script>")
		blockEnd := len(html)
		if scriptEndRel >= 0 {
			blockEnd = blockStart + scriptEndRel
		}
		searchFrom = blockStart

		block := html[blockStart:blockEnd]
		dataIdx := strings.Index(block, "data:")
		if dataIdx < 0 {
			continue
		}
		pos := dataIdx + len("data:")
		for pos < len(block) && isASCIIWhitespace(block[pos]) {
			pos++
		}
		// Handle optional `data:function(){return [...]}` wrapper
		if strings.HasPrefix(block[pos:], "function") {
			retIdx := strings.Index(block[pos:], "return")
			if retIdx < 0 {
				continue
			}
			pos += retIdx + len("return")
			for pos < len(block) && isASCIIWhitespace(block[pos]) {
				pos++
			}
		}
		if pos >= len(block) || block[pos] != '[' {
			continue
		}

		var root []any
		dec := json.NewDecoder(strings.NewReader(block[pos:]))
		if err := dec.Decode(&root); err != nil {
			continue
		}
		if len(root) < 2 {
			continue
		}
		rawItems, ok := root[1].([]any)
		if !ok || len(rawItems) == 0 {
			continue
		}

		listMatched := false
		for _, rawEntry := range rawItems {
			entry, ok := rawEntry.([]any)
			if !ok || len(entry) < 2 {
				continue
			}
			mediaTuple, ok := entry[1].([]any)
			if !ok || len(mediaTuple) < 3 {
				continue
			}
			rawURL, ok := mediaTuple[0].(string)
			if !ok || !strings.HasPrefix(rawURL, "https://lh3.googleusercontent.com/") {
				continue
			}
			w, okW := jsonInt(mediaTuple[1])
			h, okH := jsonInt(mediaTuple[2])
			if !okW || !okH {
				continue
			}

			// Confirmed this AF_initDataCallback array is an album media list.
			listMatched = true

			// Filter out videos (Google Photos VideoMetadata extension "76647426"
			// or video-downloads URLs).
			if isGooglePhotosVideoItem(entry) {
				continue
			}

			baseURL := normalizeGooglePhotoBaseURL(rawURL)
			if baseURL == "" || seen[baseURL] {
				continue
			}
			if w < 200 || h < 200 || w > 30000 || h > 30000 {
				continue
			}

			seen[baseURL] = true
			takenAt, takenDate := extractGooglePhotosDate(entry)
			out = append(out, buildPhotoItem(baseURL, w, h, takenAt, takenDate))
			if len(out) >= maxPhotosPerRequest {
				break
			}
		}

		if listMatched {
			foundMediaList = true
			if len(out) >= maxPhotosPerRequest {
				break
			}
		}
	}

	return out, foundMediaList
}

func parseGooglePhotosFromRegex(html string) []PhotoItem {
	matches := reGooglePhotoPW.FindAllStringSubmatch(html, -1)
	if len(matches) == 0 {
		matches = reGooglePhotoLegacy.FindAllStringSubmatch(html, -1)
	}
	if len(matches) == 0 {
		return nil
	}

	seen := make(map[string]bool, len(matches))
	out := make([]PhotoItem, 0, len(matches))

	for _, m := range matches {
		if len(m) < 4 {
			continue
		}
		baseURL := strings.TrimSpace(m[1])
		if baseURL == "" || seen[baseURL] {
			continue
		}
		w, errW := strconv.Atoi(m[2])
		h, errH := strconv.Atoi(m[3])
		if errW != nil || errH != nil || w < 200 || h < 200 {
			continue
		}
		// Guard against absurd non-dimension timestamps accidentally matching digits
		if w > 30000 || h > 30000 {
			continue
		}

		seen[baseURL] = true
		out = append(out, buildPhotoItem(baseURL, w, h, 0, ""))
		if len(out) >= maxPhotosPerRequest {
			break
		}
	}

	return out
}

func buildPhotoItem(baseURL string, w, h int, takenAt int64, takenDate string) PhotoItem {
	aspect := math.Round((float64(w)/float64(h))*1000) / 1000
	sum := sha1.Sum([]byte(baseURL))
	id := hex.EncodeToString(sum[:8])
	return PhotoItem{
		ID:        id,
		FullURL:   baseURL + "=w1600-h1200",
		TileURL:   baseURL + "=w1000-h1000",
		Width:     w,
		Height:    h,
		Aspect:    aspect,
		TakenAt:   takenAt,
		TakenDate: takenDate,
		baseURL:   baseURL,
	}
}

// extractGooglePhotosDate parses capture timestamp (entry[2], UTC ms) and local
// timezone offset (entry[4], ms) from a Google Photos AF_initDataCallback item.
func extractGooglePhotosDate(entry []any) (int64, string) {
	if len(entry) < 3 {
		return 0, ""
	}
	takenAtMs, ok := jsonInt64(entry[2])
	if !ok || takenAtMs < minValidPhotoEpochMs || takenAtMs > maxValidPhotoEpochMs {
		return 0, ""
	}
	var tzOffsetMs int64
	if len(entry) >= 5 {
		if tz, okTz := jsonInt64(entry[4]); okTz && tz >= -maxValidTzOffsetMs && tz <= maxValidTzOffsetMs {
			tzOffsetMs = tz
		}
	}
	localTime := time.UnixMilli(takenAtMs + tzOffsetMs).UTC()
	return takenAtMs, localTime.Format("Jan 2, 2006")
}

func handleLocatePhotos(w http.ResponseWriter, r *http.Request, locateRaw string) {
	rawParts := strings.Split(locateRaw, ",")
	ids := make([]string, 0, maxLocateIDsPerReq)
	seen := make(map[string]bool, maxLocateIDsPerReq)
	for _, part := range rawParts {
		id := strings.TrimSpace(part)
		if id == "" || len(id) > 32 || seen[id] {
			continue
		}
		seen[id] = true
		ids = append(ids, id)
		if len(ids) >= maxLocateIDsPerReq {
			break
		}
	}

	resolved := resolvePhotoBaseURLs(ids)
	locations := make(map[string]string, len(resolved))
	var (
		mu sync.Mutex
		wg sync.WaitGroup
	)
	for id, baseURL := range resolved {
		wg.Add(1)
		go func(photoID, photoBaseURL string) {
			defer wg.Done()
			loc := fetchPhotoLocation(photoBaseURL)
			if loc != "" {
				mu.Lock()
				locations[photoID] = loc
				mu.Unlock()
			}
		}(id, baseURL)
	}
	wg.Wait()

	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "private, no-store")
	w.WriteHeader(http.StatusOK)
	if r.Method == http.MethodHead {
		return
	}
	_ = json.NewEncoder(w).Encode(PhotoLocationsResponse{Locations: locations})
}

func resolvePhotoBaseURLs(ids []string) map[string]string {
	out := make(map[string]string, len(ids))
	missing := false

	photosCacheMu.Lock()
	for _, id := range ids {
		if u, ok := photoBaseURLByID[id]; ok && u != "" {
			out[id] = u
		} else {
			missing = true
		}
	}
	photosCacheMu.Unlock()

	if !missing {
		return out
	}

	// Warm photoBaseURLByID from configured albums on cold serverless starts.
	albumURLs := parsePhotoAlbumURLsFromEnv()
	var wg sync.WaitGroup
	for _, albumURL := range albumURLs {
		wg.Add(1)
		go func(rawURL string) {
			defer wg.Done()
			_, _ = fetchAlbumPhotosCached(rawURL, false)
		}(albumURL)
	}
	wg.Wait()

	photosCacheMu.Lock()
	for _, id := range ids {
		if _, already := out[id]; already {
			continue
		}
		if u, ok := photoBaseURLByID[id]; ok && u != "" {
			out[id] = u
		}
	}
	photosCacheMu.Unlock()

	return out
}

func getCachedPhotoLocation(baseURL string) (string, bool) {
	if baseURL == "" {
		return "", false
	}
	photosCacheMu.Lock()
	entry, ok := photoLocationCache[baseURL]
	photosCacheMu.Unlock()
	if !ok || time.Since(entry.fetchedAt) >= photoLocationCacheTTL {
		return "", false
	}
	return entry.location, true
}

func setCachedPhotoLocation(baseURL, location string) {
	if baseURL == "" {
		return
	}
	photosCacheMu.Lock()
	if len(photoLocationCache) >= maxLocationCacheSize {
		photoLocationCache = map[string]photoLocationEntry{}
	}
	photoLocationCache[baseURL] = photoLocationEntry{
		location:  location,
		fetchedAt: time.Now(),
	}
	photosCacheMu.Unlock()
}

func fetchPhotoLocation(baseURL string) string {
	if loc, ok := getCachedPhotoLocation(baseURL); ok {
		return loc
	}

	req, err := http.NewRequest(http.MethodGet, baseURL+"=d", nil)
	if err != nil {
		return ""
	}
	req.Header.Set("User-Agent", "Glance/1.0")
	req.Header.Set("Range", fmt.Sprintf("bytes=0-%d", exifRangeMaxBytes-1))

	resp, err := photosHTTPClient.Do(req)
	if err != nil {
		return ""
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusPartialContent {
		return ""
	}
	headBytes, err := io.ReadAll(io.LimitReader(resp.Body, exifRangeMaxBytes))
	if err != nil || len(headBytes) < 32 {
		return ""
	}

	lat, lon, ok := extractEXIFGPS(headBytes)
	if !ok {
		// Cache negative result so non-GPS camera photos aren't re-fetched repeatedly.
		setCachedPhotoLocation(baseURL, "")
		return ""
	}

	loc, err := reverseGeocodeLocation(lat, lon)
	if err != nil {
		return ""
	}
	setCachedPhotoLocation(baseURL, loc)
	return loc
}

var exifSignatures = []struct {
	magic []byte
	order binary.ByteOrder
}{
	{magic: []byte{'E', 'x', 'i', 'f', 0, 0, 'I', 'I', 0x2a, 0x00}, order: binary.LittleEndian},
	{magic: []byte{'E', 'x', 'i', 'f', 0, 0, 'M', 'M', 0x00, 0x2a}, order: binary.BigEndian},
}

// extractEXIFGPS scans a JPEG or HEIC header prefix for an EXIF TIFF payload
// containing a valid GPS IFD (tag 0x8825) and returns decimal (lat, lon).
func extractEXIFGPS(data []byte) (float64, float64, bool) {
	for _, sig := range exifSignatures {
		offset := 0
		for {
			rel := bytes.Index(data[offset:], sig.magic)
			if rel < 0 {
				break
			}
			tiffStart := offset + rel + 6
			offset = tiffStart + 4
			if lat, lon, ok := parseTIFFGPS(data[tiffStart:], sig.order); ok {
				return lat, lon, true
			}
		}
	}
	return 0, 0, false
}

func parseTIFFGPS(tiff []byte, order binary.ByteOrder) (float64, float64, bool) {
	if len(tiff) < 8 {
		return 0, 0, false
	}
	ifd0 := int(order.Uint32(tiff[4:8]))
	if ifd0 < 8 || ifd0+2 > len(tiff) {
		return 0, 0, false
	}

	numEntries := int(order.Uint16(tiff[ifd0 : ifd0+2]))
	gpsOffset := -1
	for i := 0; i < numEntries; i++ {
		e := ifd0 + 2 + i*12
		if e+12 > len(tiff) {
			break
		}
		if order.Uint16(tiff[e:e+2]) == 0x8825 {
			gpsOffset = int(order.Uint32(tiff[e+8 : e+12]))
			break
		}
	}
	if gpsOffset < 8 || gpsOffset+2 > len(tiff) {
		return 0, 0, false
	}

	gpsEntries := int(order.Uint16(tiff[gpsOffset : gpsOffset+2]))
	var (
		latRef string
		lonRef string
		lat    float64
		lon    float64
		hasLat bool
		hasLon bool
	)

	for i := 0; i < gpsEntries; i++ {
		e := gpsOffset + 2 + i*12
		if e+12 > len(tiff) {
			break
		}
		tag := order.Uint16(tiff[e : e+2])
		typ := order.Uint16(tiff[e+2 : e+4])
		cnt := int(order.Uint32(tiff[e+4 : e+8]))

		switch tag {
		case 0x0001, 0x0003: // GPSLatitudeRef / GPSLongitudeRef (ASCII)
			if typ != 2 || cnt <= 0 {
				continue
			}
			var raw []byte
			if cnt <= 4 {
				raw = tiff[e+8 : e+8+cnt]
			} else {
				valOff := int(order.Uint32(tiff[e+8 : e+12]))
				if valOff < 0 || valOff+cnt > len(tiff) {
					continue
				}
				raw = tiff[valOff : valOff+cnt]
			}
			ref := strings.ToUpper(strings.TrimRight(string(raw), "\x00 "))
			if tag == 0x0001 {
				latRef = ref
			} else {
				lonRef = ref
			}
		case 0x0002, 0x0004: // GPSLatitude / GPSLongitude (3 RATIONALs: D, M, S)
			if typ != 5 || cnt < 3 {
				continue
			}
			valOff := int(order.Uint32(tiff[e+8 : e+12]))
			if valOff < 0 || valOff+24 > len(tiff) {
				continue
			}
			deg, ok1 := readTIFFRational(tiff[valOff:valOff+8], order)
			min, ok2 := readTIFFRational(tiff[valOff+8:valOff+16], order)
			sec, ok3 := readTIFFRational(tiff[valOff+16:valOff+24], order)
			if !ok1 || !ok2 || !ok3 {
				continue
			}
			val := deg + min/60.0 + sec/3600.0
			if tag == 0x0002 {
				lat = val
				hasLat = true
			} else {
				lon = val
				hasLon = true
			}
		}
	}

	if !hasLat || !hasLon {
		return 0, 0, false
	}
	if latRef == "S" {
		lat = -lat
	}
	if lonRef == "W" {
		lon = -lon
	}
	if math.IsNaN(lat) || math.IsNaN(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180 {
		return 0, 0, false
	}
	// Reject Null Island (0, 0) placeholders sometimes emitted by cameras without GPS lock.
	if math.Abs(lat) < 0.0001 && math.Abs(lon) < 0.0001 {
		return 0, 0, false
	}
	return lat, lon, true
}

func readTIFFRational(b []byte, order binary.ByteOrder) (float64, bool) {
	if len(b) < 8 {
		return 0, false
	}
	num := order.Uint32(b[0:4])
	den := order.Uint32(b[4:8])
	if den == 0 {
		return 0, false
	}
	return float64(num) / float64(den), true
}

type bigDataCloudReverseResp struct {
	City                     string `json:"city"`
	Locality                 string `json:"locality"`
	PrincipalSubdivision     string `json:"principalSubdivision"`
	PrincipalSubdivisionCode string `json:"principalSubdivisionCode"`
	CountryName              string `json:"countryName"`
	CountryCode              string `json:"countryCode"`
}

func reverseGeocodeLocation(lat, lon float64) (string, error) {
	geoKey := fmt.Sprintf("%.2f,%.2f", lat, lon)
	photosCacheMu.Lock()
	cached, ok := geoLabelCache[geoKey]
	photosCacheMu.Unlock()
	if ok {
		return cached, nil
	}

	endpoint := fmt.Sprintf(
		"%s?latitude=%.4f&longitude=%.4f&localityLanguage=en",
		reverseGeocodeBaseURL, lat, lon,
	)
	req, err := http.NewRequest(http.MethodGet, endpoint, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("User-Agent", "Glance/1.0")
	req.Header.Set("Accept", "application/json")

	resp, err := geoHTTPClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", fmt.Errorf("reverse geocode HTTP %d", resp.StatusCode)
	}

	var payload bigDataCloudReverseResp
	if err := json.NewDecoder(io.LimitReader(resp.Body, 64*1024)).Decode(&payload); err != nil {
		return "", err
	}

	label := formatReverseGeocodeLabel(payload)
	photosCacheMu.Lock()
	if len(geoLabelCache) >= maxLocationCacheSize {
		geoLabelCache = map[string]string{}
	}
	geoLabelCache[geoKey] = label
	photosCacheMu.Unlock()

	return label, nil
}

func formatReverseGeocodeLabel(p bigDataCloudReverseResp) string {
	place := strings.TrimSpace(p.City)
	if place == "" {
		place = strings.TrimSpace(p.Locality)
	}
	if place == "" {
		place = strings.TrimSpace(p.PrincipalSubdivision)
	}

	cc := strings.ToUpper(strings.TrimSpace(p.CountryCode))
	var region string
	if cc == "US" || cc == "CA" {
		code := strings.TrimSpace(p.PrincipalSubdivisionCode)
		if dash := strings.IndexByte(code, '-'); dash >= 0 && dash+1 < len(code) {
			region = strings.ToUpper(code[dash+1:])
		}
		if region == "" {
			region = strings.TrimSpace(p.PrincipalSubdivision)
		}
	} else {
		region = cleanCountryName(cc, p.CountryName)
	}

	if place == "" {
		return region
	}
	if region == "" || strings.EqualFold(place, region) {
		return place
	}
	return place + ", " + region
}

func cleanCountryName(countryCode, rawName string) string {
	switch countryCode {
	case "GB":
		return "UK"
	case "KR":
		return "South Korea"
	case "TW":
		return "Taiwan"
	case "HK":
		return "Hong Kong"
	case "MO":
		return "Macau"
	case "AE":
		return "UAE"
	}
	name := strings.TrimSpace(rawName)
	if idx := strings.Index(name, " ("); idx > 0 {
		name = strings.TrimSpace(name[:idx])
	}
	return name
}

func normalizeGooglePhotoBaseURL(rawURL string) string {
	u := strings.TrimSpace(rawURL)
	if eq := strings.IndexByte(u, '='); eq >= 0 {
		u = u[:eq]
	}
	if !reValidGooglePhotoURL.MatchString(u) {
		return ""
	}
	return u
}

func isGooglePhotosVideoItem(entry []any) bool {
	for i := 2; i < len(entry); i++ {
		if containsVideoMetadata(entry[i], 0) {
			return true
		}
	}
	return false
}

func containsVideoMetadata(node any, depth int) bool {
	if node == nil || depth > 6 {
		return false
	}
	switch v := node.(type) {
	case map[string]any:
		// 76647426 is Google Photos' VideoMetadata extension key (duration, streams, poster)
		if meta, ok := v["76647426"]; ok && meta != nil {
			return true
		}
		for _, val := range v {
			if containsVideoMetadata(val, depth+1) {
				return true
			}
		}
	case []any:
		for _, elem := range v {
			if containsVideoMetadata(elem, depth+1) {
				return true
			}
		}
	case string:
		if strings.Contains(v, "video-downloads.googleusercontent.com") {
			return true
		}
	}
	return false
}

func jsonInt(v any) (int, bool) {
	n, ok := jsonInt64(v)
	return int(n), ok
}

func jsonInt64(v any) (int64, bool) {
	f, ok := v.(float64)
	if !ok || math.IsNaN(f) || math.IsInf(f, 0) || f != math.Trunc(f) {
		return 0, false
	}
	return int64(f), true
}

func isASCIIWhitespace(b byte) bool {
	return b == ' ' || b == '\t' || b == '\n' || b == '\r'
}
