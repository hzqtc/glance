package handler

import (
	"bytes"
	"encoding/json"
	"io"
	"math"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestWorldHandlerFXRates(t *testing.T) {
	origClient := stocksHTTPClient
	origISSClient := issHTTPClient
	origQuakesClient := quakesHTTPClient
	origAuroraClient := auroraHTTPClient
	origStormsClient := stormsHTTPClient
	sampleLine1 := "1 25544U 98067A   26326.50000000  .00016717  00000-0  29812-3 0  9995"
	sampleLine2 := "2 25544  51.6416 247.4627 0006703 130.5360 325.0288 15.49815350483021"
	stormsHTTPClient = &http.Client{
		Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
			if strings.Contains(r.URL.RawQuery, "category=volcanoes") {
				recentDate := time.Now().UTC().Add(-48 * time.Hour).Format(time.RFC3339)
				staleDate := time.Now().UTC().Add(-30 * 24 * time.Hour).Format(time.RFC3339)
				b, _ := json.Marshal(map[string]any{
					"events": []map[string]any{
						{
							"id":    "EONET_20710",
							"title": "Nevados del Chillan Volcano, Chile",
							"geometry": []map[string]any{
								{
									"date":        recentDate,
									"type":        "Point",
									"coordinates": []float64{-71.378, -36.868},
								},
							},
						},
						{
							"id":    "EONET_20001",
							"title": "Old Dormant Volcano, Peru",
							"geometry": []map[string]any{
								{
									"date":        staleDate,
									"type":        "Point",
									"coordinates": []float64{-71.4, -16.3},
								},
							},
						},
					},
				})
				return &http.Response{
					StatusCode: http.StatusOK,
					Header:     http.Header{"Content-Type": []string{"application/json"}},
					Body:       io.NopCloser(bytes.NewReader(b)),
				}, nil
			}
			b, _ := json.Marshal(map[string]any{
				"events": []map[string]any{
					{
						"id":    "EONET_9001",
						"title": "Hurricane Helena",
						"geometry": []map[string]any{
							{
								"date":           "2026-11-21T12:00:00Z",
								"type":           "Point",
								"coordinates":    []float64{-68.0, 21.0},
								"magnitudeValue": 65.0,
								"magnitudeUnit":  "kts",
							},
							{
								"date":           "2026-11-22T00:00:00Z",
								"type":           "Point",
								"coordinates":    []float64{-70.2, 22.6},
								"magnitudeValue": 80.0,
								"magnitudeUnit":  "kts",
							},
							{
								"date":           "2026-11-22T12:00:00Z",
								"type":           "Point",
								"coordinates":    []float64{-72.5, 24.2},
								"magnitudeValue": 90.0,
								"magnitudeUnit":  "kts",
							},
						},
					},
					{
						"id":    "EONET_9002",
						"title": "Typhoon Man-Yi",
						"geometry": []map[string]any{
							{
								"date":           "2026-11-22T00:00:00Z",
								"type":           "Point",
								"coordinates":    []float64{129.0, 14.2},
								"magnitudeValue": 100.0,
								"magnitudeUnit":  "kts",
							},
							{
								"date":           "2026-11-22T12:00:00Z",
								"type":           "Point",
								"coordinates":    []float64{126.4, 15.8},
								"magnitudeValue": 105.0,
								"magnitudeUnit":  "kts",
							},
						},
					},
				},
			})
			return &http.Response{
				StatusCode: http.StatusOK,
				Header:     http.Header{"Content-Type": []string{"application/json"}},
				Body:       io.NopCloser(bytes.NewReader(b)),
			}, nil
		}),
	}
	auroraHTTPClient = &http.Client{
		Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
			b, _ := json.Marshal([]map[string]any{
				{"time_tag": "2026-11-22T06:00:00", "Kp": 2.67, "a_running": 12, "station_count": 8},
				{"time_tag": "2026-11-22T09:00:00", "Kp": 5.33, "a_running": 56, "station_count": 8},
				{"time_tag": "2026-11-22T12:00:00", "Kp": 4.33, "a_running": 32, "station_count": 8},
			})
			return &http.Response{
				StatusCode: http.StatusOK,
				Header:     http.Header{"Content-Type": []string{"application/json"}},
				Body:       io.NopCloser(bytes.NewReader(b)),
			}, nil
		}),
	}
	quakesHTTPClient = &http.Client{
		Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
			b, _ := json.Marshal(map[string]any{
				"features": []map[string]any{
					{
						"id": "q1",
						"properties": map[string]any{
							"mag":   4.8,
							"place": "35 km E of Sendai, Japan",
							"time":  1732200000000,
						},
						"geometry": map[string]any{
							"coordinates": []float64{141.2, 38.3, 42.5},
						},
					},
					{
						"id": "q2",
						"properties": map[string]any{
							"mag":   6.2,
							"place": "18 km S of Hualien, Taiwan",
							"time":  1732203600000,
						},
						"geometry": map[string]any{
							"coordinates": []float64{121.6, 23.8, 18.0},
						},
					},
					{
						"id": "q3",
						"properties": map[string]any{
							"mag":   3.9,
							"place": "Minor filtered quake",
							"time":  1732205000000,
						},
						"geometry": map[string]any{
							"coordinates": []float64{-122.0, 37.3, 8.0},
						},
					},
				},
			})
			return &http.Response{
				StatusCode: http.StatusOK,
				Header:     http.Header{"Content-Type": []string{"application/json"}},
				Body:       io.NopCloser(bytes.NewReader(b)),
			}, nil
		}),
	}
	issHTTPClient = &http.Client{
		Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
			b, _ := json.Marshal(map[string]any{
				"header": "ISS (ZARYA)",
				"line1":  sampleLine1,
				"line2":  sampleLine2,
			})
			return &http.Response{
				StatusCode: http.StatusOK,
				Header:     http.Header{"Content-Type": []string{"application/json"}},
				Body:       io.NopCloser(bytes.NewReader(b)),
			}, nil
		}),
	}
	stocksHTTPClient = &http.Client{
		Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
			if r.URL.Path == "/v8/finance/spark" {
				syms := strings.Split(r.URL.Query().Get("symbols"), ",")
				payload := make(map[string]any, len(syms))
				for _, sym := range syms {
					var price, prev float64
					switch strings.ToUpper(sym) {
					case "CNY=X":
						price, prev = 7.245, 7.230
					case "JPY=X":
						price, prev = 154.80, 155.10
					case "EUR=X":
						price, prev = 0.942, 0.940
					case "GBP=X":
						price, prev = 0.791, 0.789
					case "AUD=X":
						price, prev = 1.538, 1.541
					case "SGD=X":
						price, prev = 1.342, 1.340
					default:
						price, prev = 1.000, 1.000
					}
					payload[sym] = map[string]any{
						"symbol":             sym,
						"regularMarketPrice": price,
						"chartPreviousClose": prev,
						"timestamp":          []int64{1732113000, 1732114800, 1732116600},
						"close":              []any{prev, (prev + price) / 2, price},
					}
				}
				b, _ := json.Marshal(payload)
				return &http.Response{
					StatusCode: http.StatusOK,
					Header:     http.Header{"Content-Type": []string{"application/json"}},
					Body:       io.NopCloser(bytes.NewReader(b)),
				}, nil
			}
			return &http.Response{
				StatusCode: http.StatusNotFound,
				Body:       io.NopCloser(bytes.NewBufferString("")),
			}, nil
		}),
	}
	defer func() {
		stocksHTTPClient = origClient
		issHTTPClient = origISSClient
		quakesHTTPClient = origQuakesClient
		auroraHTTPClient = origAuroraClient
		stormsHTTPClient = origStormsClient
		fxCacheMu.Lock()
		fxCache = fxCacheEntry{}
		fxCacheMu.Unlock()
		issCache.reset()
		quakesCache.reset()
		auroraCache.reset()
		stormsCache.reset()
	}()

	req := httptest.NewRequest(http.MethodGet, "/api/world", nil)
	rec := httptest.NewRecorder()
	WorldHandler(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	var resp WorldResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("invalid json: %v", err)
	}
	if len(resp.FX) != 6 {
		t.Fatalf("expected 6 FX quotes, got %d: %+v", len(resp.FX), resp.FX)
	}
	// Pairs are derived from the embedded cities' timezones, in city order
	if resp.FX[0].Quote != "EUR" || math.Abs(resp.FX[0].Rate-0.942) > 0.0001 {
		t.Fatalf("unexpected EUR quote: %+v", resp.FX[0])
	}
	if resp.FX[1].Quote != "CNY" || math.Abs(resp.FX[1].Rate-7.245) > 0.0001 || len(resp.FX[1].Sparkline) != 3 {
		t.Fatalf("unexpected CNY quote: %+v", resp.FX[1])
	}
	if resp.FX[2].Quote != "JPY" || math.Abs(resp.FX[2].Rate-154.80) > 0.001 || resp.FX[2].Change >= 0 {
		t.Fatalf("unexpected JPY quote: %+v", resp.FX[2])
	}
	if resp.FX[3].Quote != "GBP" || math.Abs(resp.FX[3].Rate-0.791) > 0.0001 {
		t.Fatalf("unexpected GBP quote: %+v", resp.FX[3])
	}
	if resp.FX[4].Quote != "SGD" || math.Abs(resp.FX[4].Rate-1.342) > 0.0001 {
		t.Fatalf("unexpected SGD quote: %+v", resp.FX[4])
	}
	if resp.FX[5].Quote != "AUD" || math.Abs(resp.FX[5].Rate-1.538) > 0.0001 {
		t.Fatalf("unexpected AUD quote: %+v", resp.FX[5])
	}
	if resp.ISS == nil {
		t.Fatalf("expected ISS orbit in response")
	}
	if math.Abs(resp.ISS.InclinationDeg-51.6416) > 0.0001 || math.Abs(resp.ISS.Eccentricity-0.0006703) > 1e-7 {
		t.Fatalf("unexpected ISS orbit: %+v", resp.ISS)
	}
	if len(resp.Quakes) != 2 {
		t.Fatalf("expected 2 filtered M4.5+ quakes, got %d: %+v", len(resp.Quakes), resp.Quakes)
	}
	if resp.Quakes[0].ID != "q2" || math.Abs(resp.Quakes[0].Mag-6.2) > 0.01 {
		t.Fatalf("expected highest magnitude quake first, got %+v", resp.Quakes[0])
	}
	if resp.Aurora == nil {
		t.Fatalf("expected Aurora Kp status in response")
	}
	if math.Abs(resp.Aurora.Kp-4.3) > 0.05 || math.Abs(resp.Aurora.MaxKp24h-5.3) > 0.05 || resp.Aurora.Scale != "Active" {
		t.Fatalf("unexpected Aurora status: %+v", resp.Aurora)
	}
	if len(resp.Storms) != 2 {
		t.Fatalf("expected 2 active tropical storms, got %d: %+v", len(resp.Storms), resp.Storms)
	}
	if resp.Storms[0].Name != "Man-Yi" || resp.Storms[0].Category != "Cat 3" || len(resp.Storms[0].Track) != 2 || len(resp.Storms[0].Forecast) != 4 {
		t.Fatalf("expected strongest storm Man-Yi Cat 3 with track & forecast first, got %+v", resp.Storms[0])
	}
	if resp.Storms[1].Name != "Helena" || resp.Storms[1].Category != "Cat 2" || len(resp.Storms[1].Track) != 3 || len(resp.Storms[1].Forecast) != 4 {
		t.Fatalf("expected storm Helena Cat 2 with track & forecast second, got %+v", resp.Storms[1])
	}
	if len(resp.Volcanoes) != 1 || resp.Volcanoes[0].Name != "Nevados del Chillan" || resp.Volcanoes[0].Region != "Chile" {
		t.Fatalf("unexpected volcanoes in response: %+v", resp.Volcanoes)
	}
}

func TestFetchISSCelesTrakFallback(t *testing.T) {
	origISSClient := issHTTPClient
	issHTTPClient = &http.Client{
		Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
			if strings.Contains(r.URL.Host, "wheretheiss") {
				return &http.Response{
					StatusCode: http.StatusServiceUnavailable,
					Body:       io.NopCloser(bytes.NewBufferString("unavailable")),
				}, nil
			}
			tle := "ISS (ZARYA)\r\n" +
				"1 25544U 98067A   26326.50000000 -.00005123  00000-0  29812-3 0  9995\r\n" +
				"2 25544  51.6410 120.1234 0005123  85.4321 274.5678 15.50123456123456\r\n"
			return &http.Response{
				StatusCode: http.StatusOK,
				Body:       io.NopCloser(bytes.NewBufferString(tle)),
			}, nil
		}),
	}
	defer func() {
		issHTTPClient = origISSClient
		issCache.reset()
	}()

	orbit := fetchISSOrbitCached(true)
	if orbit == nil {
		t.Fatalf("expected fallback CelesTrak orbit, got nil")
	}
	if orbit.Name != "ISS (ZARYA)" || math.Abs(orbit.MeanMotionDot-(-0.00005123)) > 1e-9 {
		t.Fatalf("unexpected fallback orbit: %+v", orbit)
	}
	if math.Abs(orbit.MeanMotionRevPerDay-15.50123456) > 1e-6 {
		t.Fatalf("unexpected mean motion: %+v", orbit)
	}
}
