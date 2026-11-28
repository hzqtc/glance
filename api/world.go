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
	Symbol      string    `json:"symbol"`
	Base        string    `json:"base"`
	Quote       string    `json:"quote"`
	Label       string    `json:"label"`
	Rate        float64   `json:"rate"`
	Change      float64   `json:"change"`
	ChangePct   float64   `json:"changePct"`
	Sparkline   []float64 `json:"sparkline"`
	Unavailable bool      `json:"unavailable,omitempty"`
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
	Kp       float64 `json:"kp"`
	MaxKp24h float64 `json:"maxKp24h"`
	Scale    string  `json:"scale"`
}

type StormTrackPoint struct {
	Lat float64 `json:"lat"`
	Lon float64 `json:"lon"`
}

type TropicalStorm struct {
	ID         string            `json:"id"`
	Name       string            `json:"name"`
	Category   string            `json:"category"`
	WindKmh    float64           `json:"windKmh"`
	Lat        float64           `json:"lat"`
	Lon        float64           `json:"lon"`
	AlertLevel string            `json:"alertLevel"`
	Track      []StormTrackPoint `json:"track,omitempty"`
	Forecast   []StormTrackPoint `json:"forecast,omitempty"`
}

type VolcanoEvent struct {
	ID     string  `json:"id"`
	Name   string  `json:"name"`
	Region string  `json:"region,omitempty"`
	Date   string  `json:"date,omitempty"`
	Lat    float64 `json:"lat"`
	Lon    float64 `json:"lon"`
}

type WorldResponse struct {
	Version   string            `json:"version"`
	FetchedAt string            `json:"fetchedAt"`
	FX        []FXQuote         `json:"fx"`
	ISS       *ISSOrbit         `json:"iss,omitempty"`
	Quakes    []EarthquakeEvent `json:"quakes,omitempty"`
	Aurora    *AuroraStatus     `json:"aurora,omitempty"`
	Storms    []TropicalStorm   `json:"storms,omitempty"`
	Volcanoes []VolcanoEvent    `json:"volcanoes,omitempty"`
}

type fxCacheEntry struct {
	key       string
	quotes    []FXQuote
	fetchedAt time.Time
}

// ttlCache holds a single cached value with stale-on-error fallback.
type ttlCache[T any] struct {
	mu        sync.Mutex
	val       T
	fetchedAt time.Time
}

func (c *ttlCache[T]) reset() {
	c.mu.Lock()
	var zero T
	c.val = zero
	c.fetchedAt = time.Time{}
	c.mu.Unlock()
}

func (c *ttlCache[T]) getOrFetch(ttl time.Duration, force bool, fetch func() (T, error)) T {
	if !force {
		c.mu.Lock()
		if !c.fetchedAt.IsZero() && time.Since(c.fetchedAt) < ttl {
			val := c.val
			c.mu.Unlock()
			return val
		}
		c.mu.Unlock()
	}

	val, err := fetch()
	if err == nil {
		c.mu.Lock()
		c.val = val
		c.fetchedAt = time.Now()
		c.mu.Unlock()
		return val
	}

	c.mu.Lock()
	if !c.fetchedAt.IsZero() {
		stale := c.val
		c.mu.Unlock()
		return stale
	}
	c.mu.Unlock()
	var zero T
	return zero
}

var (
	fxCacheMu sync.Mutex
	fxCache   fxCacheEntry

	issCache      ttlCache[*ISSOrbit]
	issHTTPClient = &http.Client{Timeout: 8 * time.Second}

	quakesCache      ttlCache[[]EarthquakeEvent]
	quakesHTTPClient = &http.Client{Timeout: 8 * time.Second}

	auroraCache      ttlCache[*AuroraStatus]
	auroraHTTPClient = &http.Client{Timeout: 8 * time.Second}

	stormsCache      ttlCache[[]TropicalStorm]
	stormsHTTPClient = &http.Client{Timeout: 8 * time.Second}

	volcanoesCache ttlCache[[]VolcanoEvent]

	stormTitlePrefixes = []string{"tropical cyclone ", "tropical storm ", "typhoon ", "hurricane ", "cyclone "}
)

const (
	fxCacheTTL        = 5 * time.Minute
	issCacheTTL       = 3 * time.Hour
	quakesCacheTTL    = 10 * time.Minute
	auroraCacheTTL    = 15 * time.Minute
	stormsCacheTTL    = 15 * time.Minute
	volcanoesCacheTTL = 30 * time.Minute

	whereTheISSTLEURL  = "https://api.wheretheiss.at/v1/satellites/25544/tles"
	celestrakISSTLEURL = "https://celestrak.org/NORAD/elements/gp.php?CATNR=25544&FORMAT=TLE"
	usgsQuakesURL      = "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_day.geojson"
	noaaSWPCKpURL      = "https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json"
	eonetStormsURL     = "https://eonet.gsfc.nasa.gov/api/v3/events?category=severeStorms&status=open&limit=20"
	eonetVolcanoesURL  = "https://eonet.gsfc.nasa.gov/api/v3/events?category=volcanoes&status=open&days=7&limit=20"
	volcanoMaxAge      = 7 * 24 * time.Hour
)

// WorldHandler serves GET /api/world on Vercel (and locally via cmd/devserver).
func WorldHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		auth.WriteJSONError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	if !auth.RequireAuth(w, r) {
		return
	}

	cfg, version, isDevDisk, err := config.LoadNormalizedConfig()
	if err != nil {
		auth.WriteJSONError(w, http.StatusInternalServerError, fmt.Sprintf("invalid config: %v", err))
		return
	}

	forceRefresh := r.URL.Query().Get("refresh") == "1"

	var (
		fxQuotes  []FXQuote
		issOrbit  *ISSOrbit
		quakes    []EarthquakeEvent
		aurora    *AuroraStatus
		storms    []TropicalStorm
		volcanoes []VolcanoEvent
		wg        sync.WaitGroup
	)
	wg.Add(6)
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
	go func() {
		defer wg.Done()
		volcanoes = fetchVolcanoesCached(forceRefresh)
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
		Volcanoes: volcanoes,
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

	results := make([]*yfChartResult, len(pairs))
	var fbWg sync.WaitGroup
	for i, p := range pairs {
		res := sparkMap[strings.ToUpper(p.Symbol)]
		if hasValidPoints(res) {
			results[i] = res
			continue
		}
		fbWg.Add(1)
		go func(idx int, symbol string) {
			defer fbWg.Done()
			if chartRes, err := fetchYahooChart(symbol, spec, false); err == nil {
				results[idx] = chartRes
			}
		}(i, p.Symbol)
	}
	fbWg.Wait()

	out := make([]FXQuote, len(pairs))
	anyValid := false

	for i, p := range pairs {
		res := results[i]
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
			Symbol:    p.Symbol,
			Base:      p.Base,
			Quote:     p.Quote,
			Label:     p.Label,
			Rate:      sq.Price,
			Change:    sq.Change,
			ChangePct: sq.ChangePct,
			Sparkline: sq.Sparkline,
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

func worldHTTPGet(client *http.Client, reqURL string, maxBytes int64, label string) ([]byte, error) {
	req, err := http.NewRequest(http.MethodGet, reqURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "GlanceDashboard/1.0")

	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 4096))
		return nil, fmt.Errorf("%s HTTP %d", label, resp.StatusCode)
	}
	return io.ReadAll(io.LimitReader(resp.Body, maxBytes))
}

func fetchISSOrbitCached(forceRefresh bool) *ISSOrbit {
	return issCache.getOrFetch(issCacheTTL, forceRefresh, func() (*ISSOrbit, error) {
		orbit, err := fetchISSFromWhereTheISS()
		if err != nil || orbit == nil {
			orbit, err = fetchISSFromCelesTrak()
		}
		if err == nil && orbit == nil {
			return nil, fmt.Errorf("empty ISS orbit")
		}
		return orbit, err
	})
}

type whereTheISSTLEResp struct {
	Header string `json:"header"`
	Line1  string `json:"line1"`
	Line2  string `json:"line2"`
}

func fetchISSFromWhereTheISS() (*ISSOrbit, error) {
	body, err := worldHTTPGet(issHTTPClient, whereTheISSTLEURL, 16*1024, "wheretheiss")
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
	body, err := worldHTTPGet(issHTTPClient, celestrakISSTLEURL, 16*1024, "celestrak")
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
	return quakesCache.getOrFetch(quakesCacheTTL, forceRefresh, fetchUSGSQuakes)
}

func fetchUSGSQuakes() ([]EarthquakeEvent, error) {
	body, err := worldHTTPGet(quakesHTTPClient, usgsQuakesURL, 512*1024, "usgs")
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
	return auroraCache.getOrFetch(auroraCacheTTL, forceRefresh, func() (*AuroraStatus, error) {
		status, err := fetchNOAASWPCKp()
		if err == nil && status == nil {
			return nil, fmt.Errorf("empty aurora status")
		}
		return status, err
	})
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
	body, err := worldHTTPGet(auroraHTTPClient, noaaSWPCKpURL, 128*1024, "noaa swpc")
	if err != nil {
		return nil, err
	}

	kps := make([]float64, 0, 64)

	// Current NOAA SWPC schema: array of objects [{"time_tag":..., "Kp": 2.33, ...}]
	var objRows []struct {
		Kp    json.RawMessage `json:"Kp"`
		KpLow json.RawMessage `json:"kp"`
	}
	if err := json.Unmarshal(body, &objRows); err == nil && len(objRows) > 0 {
		for _, row := range objRows {
			raw := row.Kp
			if len(raw) == 0 {
				raw = row.KpLow
			}
			if len(raw) == 0 {
				continue
			}
			kp, ok := parseFlexibleFloat(raw)
			if !ok || kp < 0 || kp > 9.5 {
				continue
			}
			kps = append(kps, math.Round(kp*10)/10)
		}
	} else {
		// Legacy NOAA SWPC schema: array of string arrays [["time_tag","Kp",...], ...]
		var rows [][]json.RawMessage
		if err := json.Unmarshal(body, &rows); err != nil {
			return nil, err
		}
		if len(rows) < 2 {
			return nil, fmt.Errorf("empty kp table")
		}
		for i := 1; i < len(rows); i++ {
			if len(rows[i]) < 2 {
				continue
			}
			kp, ok := parseFlexibleFloat(rows[i][1])
			if !ok || kp < 0 || kp > 9.5 {
				continue
			}
			kps = append(kps, math.Round(kp*10)/10)
		}
	}
	if len(kps) == 0 {
		return nil, fmt.Errorf("no valid kp rows")
	}

	latest := kps[len(kps)-1]
	startIdx := len(kps) - 8 // last 24h (8 x 3-hour windows)
	if startIdx < 0 {
		startIdx = 0
	}
	max24 := latest
	for i := startIdx; i < len(kps); i++ {
		if kps[i] > max24 {
			max24 = kps[i]
		}
	}

	return &AuroraStatus{
		Kp:       latest,
		MaxKp24h: max24,
		Scale:    describeKpScale(latest),
	}, nil
}

func fetchStormsCached(forceRefresh bool) []TropicalStorm {
	return stormsCache.getOrFetch(stormsCacheTTL, forceRefresh, fetchEONETStorms)
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

func cleanStormTitle(title string) string {
	n := strings.TrimSpace(title)
	lowerN := strings.ToLower(n)
	for _, prefix := range stormTitlePrefixes {
		if strings.HasPrefix(lowerN, prefix) {
			n = strings.TrimSpace(n[len(prefix):])
			break
		}
	}
	if n == "" {
		return "Cyclone"
	}
	return n
}

type eonetEventsPayload struct {
	Events []struct {
		ID       string `json:"id"`
		Title    string `json:"title"`
		Geometry []struct {
			Date           string          `json:"date"`
			Type           string          `json:"type"`
			Coordinates    json.RawMessage `json:"coordinates"`
			MagnitudeValue *float64        `json:"magnitudeValue"`
			MagnitudeUnit  string          `json:"magnitudeUnit"`
		} `json:"geometry"`
	} `json:"events"`
}

func wrapLonDelta(dLon float64) float64 {
	for dLon > 180 {
		dLon -= 360
	}
	for dLon < -180 {
		dLon += 360
	}
	return dLon
}

func wrapLon180(lon float64) float64 {
	for lon > 180 {
		lon -= 360
	}
	for lon < -180 {
		lon += 360
	}
	return lon
}

func projectStormForecast(fixes []struct {
	t   time.Time
	lat float64
	lon float64
}) []StormTrackPoint {
	n := len(fixes)
	if n < 2 {
		return nil
	}
	last := fixes[n-1]
	ref := fixes[n-2]
	// Prefer a reference point 6..24h before the latest fix for smoother heading
	for i := n - 2; i >= 0; i-- {
		dt := last.t.Sub(fixes[i].t).Hours()
		if dt >= 6 {
			ref = fixes[i]
			if dt <= 24 {
				break
			}
		}
	}
	dtHours := last.t.Sub(ref.t).Hours()
	if dtHours < 1 || dtHours > 72 {
		return nil
	}
	vLat := (last.lat - ref.lat) / dtHours
	vLon := wrapLonDelta(last.lon-ref.lon) / dtHours
	speedDegPerHr := math.Hypot(vLat, vLon)
	if speedDegPerHr < 0.03 {
		return nil
	}
	if speedDegPerHr > 0.65 {
		scale := 0.65 / speedDegPerHr
		vLat *= scale
		vLon *= scale
	}

	out := make([]StormTrackPoint, 0, 4)
	out = append(out, StormTrackPoint{
		Lat: math.Round(last.lat*100) / 100,
		Lon: math.Round(last.lon*100) / 100,
	})
	for _, hrs := range []float64{12, 24, 36} {
		fLat := last.lat + vLat*hrs
		if fLat > 75 {
			fLat = 75
		} else if fLat < -75 {
			fLat = -75
		}
		fLon := wrapLon180(last.lon + vLon*hrs)
		out = append(out, StormTrackPoint{
			Lat: math.Round(fLat*100) / 100,
			Lon: math.Round(fLon*100) / 100,
		})
	}
	return out
}

func fetchEONETStorms() ([]TropicalStorm, error) {
	body, err := worldHTTPGet(stormsHTTPClient, eonetStormsURL, 512*1024, "eonet storms")
	if err != nil {
		return nil, err
	}

	var payload eonetEventsPayload
	if err := json.Unmarshal(body, &payload); err != nil {
		return nil, err
	}

	out := make([]TropicalStorm, 0, len(payload.Events))
	for _, ev := range payload.Events {
		if len(ev.Geometry) == 0 {
			continue
		}
		type stormFix struct {
			t       time.Time
			lat     float64
			lon     float64
			windKmh float64
		}
		fixes := make([]stormFix, 0, len(ev.Geometry))
		for _, g := range ev.Geometry {
			if strings.ToLower(strings.TrimSpace(g.Type)) != "point" {
				continue
			}
			var coords []float64
			if err := json.Unmarshal(g.Coordinates, &coords); err != nil || len(coords) < 2 {
				continue
			}
			lon, lat := coords[0], coords[1]
			if math.IsNaN(lat) || math.IsNaN(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180 {
				continue
			}
			t, _ := time.Parse(time.RFC3339, strings.TrimSpace(g.Date))
			windKmh := 0.0
			if g.MagnitudeValue != nil && !math.IsNaN(*g.MagnitudeValue) && *g.MagnitudeValue > 0 {
				val := *g.MagnitudeValue
				unit := strings.ToLower(strings.TrimSpace(g.MagnitudeUnit))
				if unit == "kt" || unit == "kts" || unit == "knots" {
					windKmh = val * 1.852
				} else if unit == "mph" {
					windKmh = val * 1.60934
				} else {
					windKmh = val
				}
			}
			fixes = append(fixes, stormFix{t: t, lat: lat, lon: lon, windKmh: math.Round(windKmh)})
		}
		if len(fixes) == 0 {
			continue
		}
		// Ensure chronological order
		sort.SliceStable(fixes, func(i, j int) bool {
			return fixes[i].t.Before(fixes[j].t)
		})

		// Keep at most the latest 40 track points, deduplicating identical consecutive fixes
		track := make([]StormTrackPoint, 0, len(fixes))
		projFixes := make([]struct {
			t   time.Time
			lat float64
			lon float64
		}, 0, len(fixes))
		for _, fx := range fixes {
			pt := StormTrackPoint{
				Lat: math.Round(fx.lat*100) / 100,
				Lon: math.Round(fx.lon*100) / 100,
			}
			if len(track) > 0 && track[len(track)-1] == pt {
				continue
			}
			track = append(track, pt)
			projFixes = append(projFixes, struct {
				t   time.Time
				lat float64
				lon float64
			}{t: fx.t, lat: fx.lat, lon: fx.lon})
		}
		if len(track) > 40 {
			track = track[len(track)-40:]
		}

		last := fixes[len(fixes)-1]
		windKmh := last.windKmh
		if windKmh == 0 {
			for i := len(fixes) - 1; i >= 0; i-- {
				if fixes[i].windKmh > 0 {
					windKmh = fixes[i].windKmh
					break
				}
			}
		}

		name := cleanStormTitle(ev.Title)
		idStr := strings.ToLower(strings.TrimSpace(ev.ID))
		if idStr == "" {
			idStr = fmt.Sprintf("%.1f-%.1f", last.lat, last.lon)
		}
		out = append(out, TropicalStorm{
			ID:         "eonet-" + idStr,
			Name:       name,
			Category:   classifyStormWind(windKmh),
			WindKmh:    windKmh,
			Lat:        math.Round(last.lat*100) / 100,
			Lon:        math.Round(last.lon*100) / 100,
			AlertLevel: stormAlertFromWind(windKmh),
			Track:      track,
			Forecast:   projectStormForecast(projFixes),
		})
	}

	sort.Slice(out, func(i, j int) bool {
		if out[i].WindKmh != out[j].WindKmh {
			return out[i].WindKmh > out[j].WindKmh
		}
		return out[i].Name < out[j].Name
	})
	if len(out) > 15 {
		out = out[:15]
	}
	return out, nil
}

func fetchVolcanoesCached(forceRefresh bool) []VolcanoEvent {
	return volcanoesCache.getOrFetch(volcanoesCacheTTL, forceRefresh, fetchEONETVolcanoes)
}

func parseVolcanoTitle(title string) (string, string) {
	t := strings.TrimSpace(title)
	name := t
	region := ""
	if idx := strings.LastIndex(t, ","); idx > 0 {
		name = strings.TrimSpace(t[:idx])
		region = strings.TrimSpace(t[idx+1:])
	}
	// Trim redundant trailing "Volcano" so map labels stay concise
	if strings.HasSuffix(strings.ToLower(name), " volcano") {
		name = strings.TrimSpace(name[:len(name)-len(" volcano")])
	}
	if name == "" {
		name = t
	}
	return name, region
}

func fetchEONETVolcanoes() ([]VolcanoEvent, error) {
	body, err := worldHTTPGet(stormsHTTPClient, eonetVolcanoesURL, 512*1024, "eonet volcanoes")
	if err != nil {
		return nil, err
	}

	var payload eonetEventsPayload
	if err := json.Unmarshal(body, &payload); err != nil {
		return nil, err
	}

	cutoff := time.Now().UTC().Add(-volcanoMaxAge)
	out := make([]VolcanoEvent, 0, len(payload.Events))
	for _, ev := range payload.Events {
		if len(ev.Geometry) == 0 {
			continue
		}
		// Pick latest valid Point geometry
		var bestLat, bestLon float64
		var bestDate string
		var bestTime time.Time
		found := false
		for _, g := range ev.Geometry {
			if strings.ToLower(strings.TrimSpace(g.Type)) != "point" {
				continue
			}
			var coords []float64
			if err := json.Unmarshal(g.Coordinates, &coords); err != nil || len(coords) < 2 {
				continue
			}
			lon, lat := coords[0], coords[1]
			if math.IsNaN(lat) || math.IsNaN(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180 {
				continue
			}
			t, _ := time.Parse(time.RFC3339, strings.TrimSpace(g.Date))
			if !found || t.After(bestTime) {
				found = true
				bestTime = t
				bestLat = lat
				bestLon = lon
				if len(g.Date) >= 10 {
					bestDate = g.Date[:10]
				}
			}
		}
		if !found || bestTime.IsZero() || bestTime.Before(cutoff) {
			continue
		}
		name, region := parseVolcanoTitle(ev.Title)
		if name == "" {
			continue
		}
		idStr := strings.ToLower(strings.TrimSpace(ev.ID))
		if idStr == "" {
			idStr = fmt.Sprintf("%.2f-%.2f", bestLat, bestLon)
		}
		out = append(out, VolcanoEvent{
			ID:     "volc-" + idStr,
			Name:   name,
			Region: region,
			Date:   bestDate,
			Lat:    math.Round(bestLat*100) / 100,
			Lon:    math.Round(bestLon*100) / 100,
		})
	}

	sort.Slice(out, func(i, j int) bool {
		if out[i].Date != out[j].Date {
			return out[i].Date > out[j].Date
		}
		return out[i].Name < out[j].Name
	})
	if len(out) > 15 {
		out = out[:15]
	}
	return out, nil
}
