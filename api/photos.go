package handler

import (
	"crypto/sha1"
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

	photosCacheMu sync.Mutex
	photosCache   = map[string]photosCacheEntry{}

	// Primary pattern in Google Photos shared album AF_initDataCallback payloads:
	// ["https://lh3.googleusercontent.com/pw/...",4032,3024,...]
	reGooglePhotoPW = regexp.MustCompile(`"(https://lh3\.googleusercontent\.com/pw/[^"\\=]+)(?:=[^"\\]*)?"\s*,\s*(\d{2,5})\s*,\s*(\d{2,5})`)

	// Fallback pattern for older shared albums without /pw/ prefix (excludes /a/ avatars)
	reGooglePhotoLegacy = regexp.MustCompile(`"(https://lh3\.googleusercontent\.com/[A-Za-z0-9_-]{32,})(?:=[^"\\]*)?"\s*,\s*(\d{3,5})\s*,\s*(\d{3,5})`)

	// Strict URL validator for structured AF_initDataCallback photo items
	reValidGooglePhotoURL = regexp.MustCompile(`^https://lh3\.googleusercontent\.com/(?:pw/[^"\\=]+|[A-Za-z0-9_-]{32,})$`)
)

const (
	photosCacheTTL      = 15 * time.Minute
	maxPhotosPerRequest = 500
	maxAlbumHTMLBytes   = 12 * 1024 * 1024
)

type photosCacheEntry struct {
	photos    []PhotoItem
	fetchedAt time.Time
}

type PhotoItem struct {
	ID      string  `json:"id"`
	FullURL string  `json:"fullUrl"`
	TileURL string  `json:"tileUrl"`
	Width   int     `json:"width"`
	Height  int     `json:"height"`
	Aspect  float64 `json:"aspect"`
}

type PhotosResponse struct {
	FetchedAt  string      `json:"fetchedAt"`
	Configured bool        `json:"configured"`
	AlbumCount int         `json:"albumCount"`
	PhotoCount int         `json:"photoCount"`
	Photos     []PhotoItem `json:"photos"`
	Warnings   []string    `json:"warnings,omitempty"`
}

// PhotosHandler serves GET /api/photos on Vercel (and locally via cmd/devserver).
func PhotosHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		writePhotosError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	if !auth.RequireAuth(w, r) {
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
				if seenURLs[item.ID] {
					continue
				}
				seenURLs[item.ID] = true
				allPhotos = append(allPhotos, item)
				if len(allPhotos) >= maxPhotosPerRequest {
					break
				}
			}
		}(idx, albumURL)
	}
	wg.Wait()

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
			out = append(out, buildPhotoItem(baseURL, w, h))
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
		out = append(out, buildPhotoItem(baseURL, w, h))
		if len(out) >= maxPhotosPerRequest {
			break
		}
	}

	return out
}

func buildPhotoItem(baseURL string, w, h int) PhotoItem {
	aspect := math.Round((float64(w)/float64(h))*1000) / 1000
	sum := sha1.Sum([]byte(baseURL))
	id := hex.EncodeToString(sum[:8])
	return PhotoItem{
		ID:      id,
		FullURL: baseURL + "=w1600-h1200",
		TileURL: baseURL + "=w1000-h1000",
		Width:   w,
		Height:  h,
		Aspect:  aspect,
	}
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
	f, ok := v.(float64)
	if !ok || math.IsNaN(f) || math.IsInf(f, 0) || f != math.Trunc(f) {
		return 0, false
	}
	return int(f), true
}

func isASCIIWhitespace(b byte) bool {
	return b == ' ' || b == '\t' || b == '\n' || b == '\r'
}

func writePhotosError(w http.ResponseWriter, status int, message string) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "private, no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]string{
		"error": message,
	})
}
