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
		aspect := math.Round((float64(w)/float64(h))*1000) / 1000
		sum := sha1.Sum([]byte(baseURL))
		id := hex.EncodeToString(sum[:8])

		out = append(out, PhotoItem{
			ID:      id,
			FullURL: baseURL + "=w1600-h1200",
			TileURL: baseURL + "=w1000-h1000",
			Width:   w,
			Height:  h,
			Aspect:  aspect,
		})
		if len(out) >= maxPhotosPerRequest {
			break
		}
	}

	return out
}

func writePhotosError(w http.ResponseWriter, status int, message string) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "private, no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]string{
		"error": message,
	})
}
