package handler

import (
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"glance/auth"
	"glance/config"
)

type FXQuote struct {
	Symbol        string    `json:"symbol"`
	Base          string    `json:"base"`
	Quote         string    `json:"quote"`
	Label         string    `json:"label"`
	Rate          float64   `json:"rate"`
	PreviousClose float64   `json:"previousClose"`
	Change        float64   `json:"change"`
	ChangePct     float64   `json:"changePct"`
	Sparkline     []float64 `json:"sparkline"`
	Unavailable   bool      `json:"unavailable,omitempty"`
}

type ISSOrbit struct {
	Name                string  `json:"name"`
	EpochMs             int64   `json:"epochMs"`
	InclinationDeg      float64 `json:"inclinationDeg"`
	RAANDeg             float64 `json:"raanDeg"`
	Eccentricity        float64 `json:"eccentricity"`
	ArgPerigeeDeg       float64 `json:"argPerigeeDeg"`
	MeanAnomalyDeg      float64 `json:"meanAnomalyDeg"`
	MeanMotionRevPerDay float64 `json:"meanMotionRevPerDay"`
	MeanMotionDot       float64 `json:"meanMotionDot"`
	FetchedAt           string  `json:"fetchedAt"`
}

type EarthquakeEvent struct {
	ID      string  `json:"id"`
	Mag     float64 `json:"mag"`
	Place   string  `json:"place"`
	TimeMs  int64   `json:"timeMs"`
	Lat     float64 `json:"lat"`
	Lon     float64 `json:"lon"`
	DepthKm float64 `json:"depthKm"`
}

type AuroraStatus struct {
	Kp         float64 `json:"kp"`
	MaxKp24h   float64 `json:"maxKp24h"`
	Scale      string  `json:"scale"`
	ObservedAt string  `json:"observedAt"`
}

type TropicalStorm struct {
	ID         string  `json:"id"`
	Name       string  `json:"name"`
	Category   string  `json:"category"`
	WindKmh    float64 `json:"windKmh"`
	Lat        float64 `json:"lat"`
	Lon        float64 `json:"lon"`
	AlertLevel string  `json:"alertLevel"`
	UpdatedAt  string  `json:"updatedAt"`
}

type WorldResponse struct {
	Version   string            `json:"version"`
	FetchedAt string            `json:"fetchedAt"`
	FX        []FXQuote         `json:"fx"`
	ISS       *ISSOrbit         `json:"iss,omitempty"`
	Quakes    []EarthquakeEvent `json:"quakes,omitempty"`
	Aurora    *AuroraStatus     `json:"aurora,omitempty"`
	Storms    []TropicalStorm   `json:"storms,omitempty"`
}

type fxCacheEntry struct {
	key       string
	quotes    []FXQuote
	fetchedAt time.Time
}

type issCacheEntry struct {
	orbit     *ISSOrbit
	fetchedAt time.Time
}

type quakesCacheEntry struct {
	events    []EarthquakeEvent
	fetchedAt time.Time
}

type auroraCacheEntry struct {
	status    *AuroraStatus
	fetchedAt time.Time
}

type stormsCacheEntry struct {
	storms    []TropicalStorm
	fetchedAt time.Time
}

var (
	fxCacheMu sync.Mutex
	fxCache   fxCacheEntry

	issCacheMu    sync.Mutex
	issCache      issCacheEntry
	issHTTPClient = &http.Client{Timeout: 8 * time.Second}

	quakesCacheMu    sync.Mutex
	quakesCache      quakesCacheEntry
	quakesHTTPClient = &http.Client{Timeout: 8 * time.Second}

	auroraCacheMu    sync.Mutex
	auroraCache      auroraCacheEntry
	auroraHTTPClient = &http.Client{Timeout: 8 * time.Second}

	stormsCacheMu    sync.Mutex
	stormsCache      stormsCacheEntry
	stormsHTTPClient = &http.Client{Timeout: 8 * time.Second}
)

const (
	fxCacheTTL     = 5 * time.Minute
	issCacheTTL    = 3 * time.Hour
	quakesCacheTTL = 10 * time.Minute
	auroraCacheTTL = 15 * time.Minute
	stormsCacheTTL = 15 * time.Minute

	whereTheISSTLEURL  = "https://api.wheretheiss.at/v1/satellites/25544/tles"
	celestrakISSTLEURL = "https://celestrak.org/NORAD/elements/gp.php?CATNR=25544&FORMAT=TLE"
	usgsQuakesURL      = "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_day.geojson"
	noaaSWPCKpURL      = "https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json"
	nhcCurrentStorms   = "https://www.nhc.noaa.gov/CurrentStorms.json"
	gdacsMapFeedURL    = "https://www.gdacs.org/gdacsapi/api/events/geteventlist/MAP"
)

// WorldHandler serves GET /api/world on Vercel (and locally via cmd/devserver).
func WorldHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		writeWorldError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	if !auth.RequireAuth(w, r) {
		return
	}

	cfg, version, isDevDisk, err := config.LoadNormalizedConfig()
	if err != nil {
		writeWorldError(w, http.StatusInternalServerError, fmt.Sprintf("invalid config: %v", err))
		return
	}

	forceRefresh := r.URL.Query().Get("refresh") == "1"

	var (
		fxQuotes []FXQuote
		issOrbit *ISSOrbit
		quakes   []EarthquakeEvent
		aurora   *AuroraStatus
		storms   []TropicalStorm
		wg       sync.WaitGroup
	)
	wg.Add(5)
	go func() {
		defer wg.Done()
		fxQuotes = fetchFXQuotesCached(cfg.World.FXPairs, forceRefresh)
	}()
	go func() {
		defer wg.Done()
		issOrbit = fetchISSOrbitCached(forceRefresh)
	}()
	go func() {
		defer wg.Done()
		quakes = fetchQuakesCached(forceRefresh)
	}()
	go func() {
		defer wg.Done()
		aurora = fetchAuroraCached(forceRefresh)
	}()
	go func() {
		defer wg.Done()
		storms = fetchStormsCached(forceRefresh)
	}()
	wg.Wait()

	resp := WorldResponse{
		Version:   version,
		FetchedAt: time.Now().UTC().Format(time.RFC3339),
		FX:        fxQuotes,
		ISS:       issOrbit,
		Quakes:    quakes,
		Aurora:    aurora,
		Storms:    storms,
	}

	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	if isDevDisk || auth.IsRequired() {
		w.Header().Set("Cache-Control", "private, no-store")
	} else {
		w.Header().Set("Cache-Control", "public, s-maxage=300, stale-while-revalidate=300")
	}
	w.WriteHeader(http.StatusOK)
	if r.Method == http.MethodHead {
		return
	}
	_ = json.NewEncoder(w).Encode(resp)
}

func fetchFXQuotesCached(pairs []config.FXPairConfig, forceRefresh bool) []FXQuote {
	if len(pairs) == 0 {
		return []FXQuote{}
	}

	syms := make([]string, len(pairs))
	for i, p := range pairs {
		syms[i] = p.Symbol
	}
	cacheKey := strings.ToUpper(strings.Join(syms, ","))

	if !forceRefresh {
		fxCacheMu.Lock()
		if fxCache.key == cacheKey && len(fxCache.quotes) == len(pairs) && time.Since(fxCache.fetchedAt) < fxCacheTTL {
			cached := make([]FXQuote, len(fxCache.quotes))
			copy(cached, fxCache.quotes)
			fxCacheMu.Unlock()
			return cached
		}
		fxCacheMu.Unlock()
	}

	spec := yahooRangeSpec{Range: "1d", Interval: "30m"}
	sparkMap := fetchYahooSparkBatched(syms, spec)

	out := make([]FXQuote, len(pairs))
	anyValid := false

	for i, p := range pairs {
		res := sparkMap[strings.ToUpper(p.Symbol)]
		if res == nil || len(extractValidPoints(res)) == 0 {
			if chartRes, err := fetchYahooChart(p.Symbol, spec, false); err == nil {
				res = chartRes
			}
		}
		if res == nil {
			out[i] = FXQuote{
				Symbol:      p.Symbol,
				Base:        p.Base,
				Quote:       p.Quote,
				Label:       p.Label,
				Sparkline:   []float64{},
				Unavailable: true,
			}
			continue
		}

		sq := buildStockQuote(config.StockSymbolConfig{
			Symbol: p.Symbol,
			Label:  p.Label,
			Name:   p.Label,
			Format: "currency",
		}, "1d", res)
		if sq.Price <= 0 {
			out[i] = FXQuote{
				Symbol:      p.Symbol,
				Base:        p.Base,
				Quote:       p.Quote,
				Label:       p.Label,
				Sparkline:   []float64{},
				Unavailable: true,
			}
			continue
		}

		anyValid = true
		out[i] = FXQuote{
			Symbol:        p.Symbol,
			Base:          p.Base,
			Quote:         p.Quote,
			Label:         p.Label,
			Rate:          sq.Price,
			PreviousClose: sq.PreviousClose,
			Change:        sq.Change,
			ChangePct:     sq.ChangePct,
			Sparkline:     sq.Sparkline,
		}
	}

	if anyValid {
		fxCacheMu.Lock()
		cachedCopy := make([]FXQuote, len(out))
		copy(cachedCopy, out)
		fxCache = fxCacheEntry{
			key:       cacheKey,
			quotes:    cachedCopy,
			fetchedAt: time.Now(),
		}
		fxCacheMu.Unlock()
		return out
	}

	// Fall back to stale cache if upstream failed completely
	fxCacheMu.Lock()
	if fxCache.key == cacheKey && len(fxCache.quotes) == len(pairs) {
		stale := make([]FXQuote, len(fxCache.quotes))
		copy(stale, fxCache.quotes)
		fxCacheMu.Unlock()
		return stale
	}
	fxCacheMu.Unlock()

	return out
}

func fetchISSOrbitCached(forceRefresh bool) *ISSOrbit {
	if !forceRefresh {
		issCacheMu.Lock()
		if issCache.orbit != nil && time.Since(issCache.fetchedAt) < issCacheTTL {
			copyOrbit := *issCache.orbit
			issCacheMu.Unlock()
			return &copyOrbit
		}
		issCacheMu.Unlock()
	}

	orbit, err := fetchISSFromWhereTheISS()
	if err != nil || orbit == nil {
		orbit, err = fetchISSFromCelesTrak()
	}
	if err == nil && orbit != nil {
		issCacheMu.Lock()
		stored := *orbit
		issCache = issCacheEntry{
			orbit:     &stored,
			fetchedAt: time.Now(),
		}
		issCacheMu.Unlock()
		return orbit
	}

	// Serve stale cached TLE if both upstream endpoints failed
	issCacheMu.Lock()
	if issCache.orbit != nil {
		stale := *issCache.orbit
		issCacheMu.Unlock()
		return &stale
	}
	issCacheMu.Unlock()
	return nil
}

type whereTheISSTLEResp struct {
	Header string `json:"header"`
	Line1  string `json:"line1"`
	Line2  string `json:"line2"`
}

func fetchISSFromWhereTheISS() (*ISSOrbit, error) {
	req, err := http.NewRequest(http.MethodGet, whereTheISSTLEURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "GlanceDashboard/1.0")

	resp, err := issHTTPClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("wheretheiss HTTP %d", resp.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, 16*1024))
	if err != nil {
		return nil, err
	}

	var raw whereTheISSTLEResp
	if err := json.Unmarshal(body, &raw); err != nil {
		return nil, err
	}
	name := strings.TrimSpace(raw.Header)
	if name == "" {
		name = "ISS (ZARYA)"
	}
	return parseISSTLE(name, raw.Line1, raw.Line2)
}

func fetchISSFromCelesTrak() (*ISSOrbit, error) {
	req, err := http.NewRequest(http.MethodGet, celestrakISSTLEURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "GlanceDashboard/1.0")

	resp, err := issHTTPClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("celestrak HTTP %d", resp.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, 16*1024))
	if err != nil {
		return nil, err
	}

	lines := strings.Split(strings.ReplaceAll(string(body), "\r\n", "\n"), "\n")
	var name, line1, line2 string
	for _, rawLine := range lines {
		trimmed := strings.TrimSpace(rawLine)
		if trimmed == "" {
			continue
		}
		if strings.HasPrefix(trimmed, "1 ") && len(trimmed) >= 68 {
			line1 = trimmed
		} else if strings.HasPrefix(trimmed, "2 ") && len(trimmed) >= 68 {
			line2 = trimmed
		} else if name == "" {
			name = trimmed
		}
	}
	if name == "" {
		name = "ISS (ZARYA)"
	}
	return parseISSTLE(name, line1, line2)
}

func parseISSTLE(name, line1, line2 string) (*ISSOrbit, error) {
	l1 := strings.TrimRight(line1, "\r\n")
	l2 := strings.TrimRight(line2, "\r\n")
	if len(l1) < 43 || len(l2) < 63 || !strings.HasPrefix(l1, "1 ") || !strings.HasPrefix(l2, "2 ") {
		return nil, fmt.Errorf("invalid TLE format")
	}

	year2, err := strconv.Atoi(strings.TrimSpace(l1[18:20]))
	if err != nil {
		return nil, fmt.Errorf("invalid TLE epoch year: %w", err)
	}
	fullYear := 2000 + year2
	if year2 >= 57 {
		fullYear = 1900 + year2
	}
	dayOfYear, err := strconv.ParseFloat(strings.TrimSpace(l1[20:32]), 64)
	if err != nil || math.IsNaN(dayOfYear) || dayOfYear < 1 || dayOfYear > 367 {
		return nil, fmt.Errorf("invalid TLE epoch day")
	}
	jan1 := time.Date(fullYear, time.January, 1, 0, 0, 0, 0, time.UTC)
	epochMs := jan1.UnixMilli() + int64(math.Round((dayOfYear-1.0)*86400000.0))

	ndot, _ := strconv.ParseFloat(strings.TrimSpace(l1[33:43]), 64)
	if math.IsNaN(ndot) {
		ndot = 0
	}

	inc, err := strconv.ParseFloat(strings.TrimSpace(l2[8:16]), 64)
	if err != nil {
		return nil, fmt.Errorf("invalid inclination: %w", err)
	}
	raan, err := strconv.ParseFloat(strings.TrimSpace(l2[17:25]), 64)
	if err != nil {
		return nil, fmt.Errorf("invalid RAAN: %w", err)
	}
	eccStr := "0." + strings.TrimSpace(l2[26:33])
	ecc, err := strconv.ParseFloat(eccStr, 64)
	if err != nil || ecc < 0 || ecc >= 1 {
		return nil, fmt.Errorf("invalid eccentricity")
	}
	argP, err := strconv.ParseFloat(strings.TrimSpace(l2[34:42]), 64)
	if err != nil {
		return nil, fmt.Errorf("invalid arg of perigee: %w", err)
	}
	meanAnom, err := strconv.ParseFloat(strings.TrimSpace(l2[43:51]), 64)
	if err != nil {
		return nil, fmt.Errorf("invalid mean anomaly: %w", err)
	}
	meanMot, err := strconv.ParseFloat(strings.TrimSpace(l2[52:63]), 64)
	if err != nil || meanMot <= 0 {
		return nil, fmt.Errorf("invalid mean motion")
	}

	return &ISSOrbit{
		Name:                name,
		EpochMs:             epochMs,
		InclinationDeg:      inc,
		RAANDeg:             raan,
		Eccentricity:        ecc,
		ArgPerigeeDeg:       argP,
		MeanAnomalyDeg:      meanAnom,
		MeanMotionRevPerDay: meanMot,
		MeanMotionDot:       ndot,
		FetchedAt:           time.Now().UTC().Format(time.RFC3339),
	}, nil
}

type usgsGeoJSON struct {
	Features []struct {
		ID         string `json:"id"`
		Properties struct {
			Mag   *float64 `json:"mag"`
			Place string   `json:"place"`
			Time  int64    `json:"time"`
		} `json:"properties"`
		Geometry struct {
			Coordinates []float64 `json:"coordinates"`
		} `json:"geometry"`
	} `json:"features"`
}

func fetchQuakesCached(forceRefresh bool) []EarthquakeEvent {
	if !forceRefresh {
		quakesCacheMu.Lock()
		if !quakesCache.fetchedAt.IsZero() && time.Since(quakesCache.fetchedAt) < quakesCacheTTL {
			out := make([]EarthquakeEvent, len(quakesCache.events))
			copy(out, quakesCache.events)
			quakesCacheMu.Unlock()
			return out
		}
		quakesCacheMu.Unlock()
	}

	events, err := fetchUSGSQuakes()
	if err == nil {
		quakesCacheMu.Lock()
		stored := make([]EarthquakeEvent, len(events))
		copy(stored, events)
		quakesCache = quakesCacheEntry{
			events:    stored,
			fetchedAt: time.Now(),
		}
		quakesCacheMu.Unlock()
		return events
	}

	quakesCacheMu.Lock()
	if !quakesCache.fetchedAt.IsZero() {
		stale := make([]EarthquakeEvent, len(quakesCache.events))
		copy(stale, quakesCache.events)
		quakesCacheMu.Unlock()
		return stale
	}
	quakesCacheMu.Unlock()
	return nil
}

func fetchUSGSQuakes() ([]EarthquakeEvent, error) {
	req, err := http.NewRequest(http.MethodGet, usgsQuakesURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "GlanceDashboard/1.0")

	resp, err := quakesHTTPClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("usgs HTTP %d", resp.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, 512*1024))
	if err != nil {
		return nil, err
	}

	var raw usgsGeoJSON
	if err := json.Unmarshal(body, &raw); err != nil {
		return nil, err
	}

	out := make([]EarthquakeEvent, 0, len(raw.Features))
	for _, f := range raw.Features {
		if f.Properties.Mag == nil || len(f.Geometry.Coordinates) < 2 {
			continue
		}
		mag := *f.Properties.Mag
		if math.IsNaN(mag) || mag < 4.5 {
			continue
		}
		lon := f.Geometry.Coordinates[0]
		lat := f.Geometry.Coordinates[1]
		if math.IsNaN(lat) || math.IsNaN(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180 {
			continue
		}
		depthKm := 0.0
		if len(f.Geometry.Coordinates) >= 3 && !math.IsNaN(f.Geometry.Coordinates[2]) {
			depthKm = math.Max(0, f.Geometry.Coordinates[2])
		}
		out = append(out, EarthquakeEvent{
			ID:      f.ID,
			Mag:     math.Round(mag*10) / 10,
			Place:   strings.TrimSpace(f.Properties.Place),
			TimeMs:  f.Properties.Time,
			Lat:     math.Round(lat*1000) / 1000,
			Lon:     math.Round(lon*1000) / 1000,
			DepthKm: math.Round(depthKm*10) / 10,
		})
	}

	sort.Slice(out, func(i, j int) bool {
		if out[i].Mag != out[j].Mag {
			return out[i].Mag > out[j].Mag
		}
		return out[i].TimeMs > out[j].TimeMs
	})
	if len(out) > 40 {
		out = out[:40]
	}
	return out, nil
}

func fetchAuroraCached(forceRefresh bool) *AuroraStatus {
	if !forceRefresh {
		auroraCacheMu.Lock()
		if auroraCache.status != nil && time.Since(auroraCache.fetchedAt) < auroraCacheTTL {
			copyStatus := *auroraCache.status
			auroraCacheMu.Unlock()
			return &copyStatus
		}
		auroraCacheMu.Unlock()
	}

	status, err := fetchNOAASWPCKp()
	if err == nil && status != nil {
		auroraCacheMu.Lock()
		stored := *status
		auroraCache = auroraCacheEntry{
			status:    &stored,
			fetchedAt: time.Now(),
		}
		auroraCacheMu.Unlock()
		return status
	}

	auroraCacheMu.Lock()
	if auroraCache.status != nil {
		stale := *auroraCache.status
		auroraCacheMu.Unlock()
		return &stale
	}
	auroraCacheMu.Unlock()
	return nil
}

func describeKpScale(kp float64) string {
	switch {
	case kp >= 9.0:
		return "G5 Extreme"
	case kp >= 8.0:
		return "G4 Severe"
	case kp >= 7.0:
		return "G3 Strong"
	case kp >= 6.0:
		return "G2 Moderate"
	case kp >= 5.0:
		return "G1 Minor"
	case kp >= 4.0:
		return "Active"
	case kp >= 3.0:
		return "Unsettled"
	default:
		return "Quiet"
	}
}

func parseFlexibleFloat(raw json.RawMessage) (float64, bool) {
	trimmed := strings.TrimSpace(string(raw))
	if trimmed == "" || trimmed == "null" {
		return 0, false
	}
	trimmed = strings.Trim(trimmed, "\"")
	v, err := strconv.ParseFloat(trimmed, 64)
	if err != nil || math.IsNaN(v) || math.IsInf(v, 0) {
		return 0, false
	}
	return v, true
}

func fetchNOAASWPCKp() (*AuroraStatus, error) {
	req, err := http.NewRequest(http.MethodGet, noaaSWPCKpURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "GlanceDashboard/1.0")

	resp, err := auroraHTTPClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("noaa swpc HTTP %d", resp.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, 128*1024))
	if err != nil {
		return nil, err
	}

	var rows [][]json.RawMessage
	if err := json.Unmarshal(body, &rows); err != nil {
		return nil, err
	}
	if len(rows) < 2 {
		return nil, fmt.Errorf("empty kp table")
	}

	type kpEntry struct {
		observedAt string
		kp         float64
	}
	entries := make([]kpEntry, 0, len(rows)-1)
	for i := 1; i < len(rows); i++ {
		if len(rows[i]) < 2 {
			continue
		}
		kp, ok := parseFlexibleFloat(rows[i][1])
		if !ok || kp < 0 || kp > 9.5 {
			continue
		}
		obs := strings.Trim(strings.TrimSpace(string(rows[i][0])), "\"")
		entries = append(entries, kpEntry{
			observedAt: obs,
			kp:         math.Round(kp*10) / 10,
		})
	}
	if len(entries) == 0 {
		return nil, fmt.Errorf("no valid kp rows")
	}

	latest := entries[len(entries)-1]
	startIdx := len(entries) - 8 // last 24h (8 x 3-hour windows)
	if startIdx < 0 {
		startIdx = 0
	}
	max24 := latest.kp
	for i := startIdx; i < len(entries); i++ {
		if entries[i].kp > max24 {
			max24 = entries[i].kp
		}
	}

	return &AuroraStatus{
		Kp:         latest.kp,
		MaxKp24h:   max24,
		Scale:      describeKpScale(latest.kp),
		ObservedAt: latest.observedAt,
	}, nil
}

func fetchStormsCached(forceRefresh bool) []TropicalStorm {
	if !forceRefresh {
		stormsCacheMu.Lock()
		if !stormsCache.fetchedAt.IsZero() && time.Since(stormsCache.fetchedAt) < stormsCacheTTL {
			out := make([]TropicalStorm, len(stormsCache.storms))
			copy(out, stormsCache.storms)
			stormsCacheMu.Unlock()
			return out
		}
		stormsCacheMu.Unlock()
	}

	var (
		nhcStorms   []TropicalStorm
		gdacsStorms []TropicalStorm
		nhcErr      error
		gdacsErr    error
		wg          sync.WaitGroup
	)
	wg.Add(2)
	go func() {
		defer wg.Done()
		nhcStorms, nhcErr = fetchNHCStorms()
	}()
	go func() {
		defer wg.Done()
		gdacsStorms, gdacsErr = fetchGDACSStorms()
	}()
	wg.Wait()

	if nhcErr == nil || gdacsErr == nil {
		merged := mergeTropicalStorms(nhcStorms, gdacsStorms)
		stormsCacheMu.Lock()
		stored := make([]TropicalStorm, len(merged))
		copy(stored, merged)
		stormsCache = stormsCacheEntry{
			storms:    stored,
			fetchedAt: time.Now(),
		}
		stormsCacheMu.Unlock()
		return merged
	}

	stormsCacheMu.Lock()
	if !stormsCache.fetchedAt.IsZero() {
		stale := make([]TropicalStorm, len(stormsCache.storms))
		copy(stale, stormsCache.storms)
		stormsCacheMu.Unlock()
		return stale
	}
	stormsCacheMu.Unlock()
	return nil
}

func classifyStormWind(windKmh float64) string {
	switch {
	case windKmh >= 252:
		return "Cat 5"
	case windKmh >= 209:
		return "Cat 4"
	case windKmh >= 178:
		return "Cat 3"
	case windKmh >= 154:
		return "Cat 2"
	case windKmh >= 119:
		return "Cat 1"
	case windKmh >= 63:
		return "Tropical Storm"
	default:
		return "Depression"
	}
}

func stormAlertFromWind(windKmh float64) string {
	if windKmh >= 178 {
		return "Red"
	}
	if windKmh >= 119 {
		return "Orange"
	}
	return "Green"
}

type nhcStormsPayload struct {
	ActiveStorms []struct {
		ID               string          `json:"id"`
		Name             string          `json:"name"`
		Classification   string          `json:"classification"`
		Intensity        json.RawMessage `json:"intensity"`
		LatitudeNumeric  *float64        `json:"latitudeNumeric"`
		LongitudeNumeric *float64        `json:"longitudeNumeric"`
		LastUpdate       string          `json:"lastUpdate"`
	} `json:"activeStorms"`
}

func fetchNHCStorms() ([]TropicalStorm, error) {
	req, err := http.NewRequest(http.MethodGet, nhcCurrentStorms, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "GlanceDashboard/1.0")

	resp, err := stormsHTTPClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("nhc HTTP %d", resp.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, 256*1024))
	if err != nil {
		return nil, err
	}

	var payload nhcStormsPayload
	if err := json.Unmarshal(body, &payload); err != nil {
		return nil, err
	}

	out := make([]TropicalStorm, 0, len(payload.ActiveStorms))
	for _, s := range payload.ActiveStorms {
		if s.LatitudeNumeric == nil || s.LongitudeNumeric == nil {
			continue
		}
		lat := *s.LatitudeNumeric
		lon := *s.LongitudeNumeric
		if math.IsNaN(lat) || math.IsNaN(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180 {
			continue
		}
		knots, _ := parseFlexibleFloat(s.Intensity)
		windKmh := math.Round(knots * 1.852)
		name := strings.TrimSpace(s.Name)
		if name == "" {
			name = strings.TrimSpace(s.ID)
		}
		if name == "" {
			continue
		}
		out = append(out, TropicalStorm{
			ID:         "nhc-" + strings.ToLower(strings.TrimSpace(s.ID)),
			Name:       name,
			Category:   classifyStormWind(windKmh),
			WindKmh:    windKmh,
			Lat:        math.Round(lat*100) / 100,
			Lon:        math.Round(lon*100) / 100,
			AlertLevel: stormAlertFromWind(windKmh),
			UpdatedAt:  strings.TrimSpace(s.LastUpdate),
		})
	}
	return out, nil
}

type gdacsGeoJSON struct {
	Features []struct {
		Properties struct {
			EventID      json.RawMessage `json:"eventid"`
			EventType    string          `json:"eventtype"`
			Name         string          `json:"name"`
			EventName    string          `json:"eventname"`
			AlertLevel   string          `json:"alertlevel"`
			IsCurrent    string          `json:"iscurrent"`
			ToDate       string          `json:"todate"`
			SeverityData struct {
				Severity     float64 `json:"severity"`
				SeverityUnit string  `json:"severityunit"`
			} `json:"severitydata"`
		} `json:"properties"`
		Geometry struct {
			Type        string          `json:"type"`
			Coordinates json.RawMessage `json:"coordinates"`
		} `json:"geometry"`
	} `json:"features"`
}

func cleanGDACSStormName(eventName, fullName string) string {
	n := strings.TrimSpace(eventName)
	if n == "" {
		n = strings.TrimSpace(fullName)
	}
	// Strip verbose prefixes like "Tropical Cyclone " or "Hurricane "
	for _, prefix := range []string{"Tropical Cyclone ", "Tropical Storm ", "Typhoon ", "Hurricane ", "Cyclone "} {
		if strings.HasPrefix(strings.ToLower(n), strings.ToLower(prefix)) {
			n = strings.TrimSpace(n[len(prefix):])
			break
		}
	}
	// Strip trailing "-26" year suffix if present (e.g., "MAN-YI-26")
	if idx := strings.LastIndex(n, "-"); idx > 0 && len(n)-idx == 3 {
		if _, err := strconv.Atoi(n[idx+1:]); err == nil {
			n = strings.TrimSpace(n[:idx])
		}
	}
	if n == "" {
		return "Cyclone"
	}
	// Title-case ALL CAPS names like "MAN-YI" -> "Man-Yi"
	if n == strings.ToUpper(n) && len(n) > 1 {
		lower := strings.ToLower(n)
		var b strings.Builder
		capNext := true
		for _, r := range lower {
			if capNext && r >= 'a' && r <= 'z' {
				b.WriteRune(r - 'a' + 'A')
				capNext = false
			} else {
				b.WriteRune(r)
				capNext = r == ' ' || r == '-'
			}
		}
		return b.String()
	}
	return n
}

func fetchGDACSStorms() ([]TropicalStorm, error) {
	req, err := http.NewRequest(http.MethodGet, gdacsMapFeedURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "GlanceDashboard/1.0")

	resp, err := stormsHTTPClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("gdacs HTTP %d", resp.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, 1024*1024))
	if err != nil {
		return nil, err
	}

	var raw gdacsGeoJSON
	if err := json.Unmarshal(body, &raw); err != nil {
		return nil, err
	}

	out := make([]TropicalStorm, 0)
	for _, f := range raw.Features {
		if strings.ToUpper(strings.TrimSpace(f.Properties.EventType)) != "TC" {
			continue
		}
		if strings.ToLower(strings.TrimSpace(f.Properties.IsCurrent)) != "true" {
			continue
		}
		if strings.ToLower(strings.TrimSpace(f.Geometry.Type)) != "point" {
			continue
		}
		var coords []float64
		if err := json.Unmarshal(f.Geometry.Coordinates, &coords); err != nil || len(coords) < 2 {
			continue
		}
		lon := coords[0]
		lat := coords[1]
		if math.IsNaN(lat) || math.IsNaN(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180 {
			continue
		}

		windKmh := f.Properties.SeverityData.Severity
		unit := strings.ToLower(strings.TrimSpace(f.Properties.SeverityData.SeverityUnit))
		if unit == "kt" || unit == "kts" || unit == "knots" {
			windKmh = windKmh * 1.852
		} else if unit == "mph" {
			windKmh = windKmh * 1.60934
		}
		if math.IsNaN(windKmh) || windKmh < 0 {
			windKmh = 0
		}
		windKmh = math.Round(windKmh)

		idStr := strings.Trim(strings.TrimSpace(string(f.Properties.EventID)), "\"")
		if idStr == "" {
			idStr = fmt.Sprintf("%.1f-%.1f", lat, lon)
		}
		alert := strings.TrimSpace(f.Properties.AlertLevel)
		if alert == "" {
			alert = stormAlertFromWind(windKmh)
		}
		out = append(out, TropicalStorm{
			ID:         "gdacs-" + idStr,
			Name:       cleanGDACSStormName(f.Properties.EventName, f.Properties.Name),
			Category:   classifyStormWind(windKmh),
			WindKmh:    windKmh,
			Lat:        math.Round(lat*100) / 100,
			Lon:        math.Round(lon*100) / 100,
			AlertLevel: alert,
			UpdatedAt:  strings.TrimSpace(f.Properties.ToDate),
		})
	}
	return out, nil
}

func mergeTropicalStorms(nhc, gdacs []TropicalStorm) []TropicalStorm {
	merged := make([]TropicalStorm, 0, len(nhc)+len(gdacs))
	merged = append(merged, nhc...)

	for _, g := range gdacs {
		gNorm := strings.ToLower(strings.TrimSpace(g.Name))
		dup := false
		for _, existing := range merged {
			if strings.ToLower(strings.TrimSpace(existing.Name)) == gNorm {
				dup = true
				break
			}
			if math.Abs(existing.Lat-g.Lat) < 4.0 && math.Abs(existing.Lon-g.Lon) < 4.0 {
				dup = true
				break
			}
		}
		if !dup {
			merged = append(merged, g)
		}
	}

	sort.Slice(merged, func(i, j int) bool {
		if merged[i].WindKmh != merged[j].WindKmh {
			return merged[i].WindKmh > merged[j].WindKmh
		}
		return merged[i].Name < merged[j].Name
	})
	if len(merged) > 15 {
		merged = merged[:15]
	}
	return merged
}

func writeWorldError(w http.ResponseWriter, status int, message string) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]string{
		"error": message,
	})
}
