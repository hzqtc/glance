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
)

func TestWorldHandlerFXRates(t *testing.T) {
	origClient := stocksHTTPClient
	origISSClient := issHTTPClient
	origQuakesClient := quakesHTTPClient
	origAuroraClient := auroraHTTPClient
	sampleLine1 := "1 25544U 98067A   26326.50000000  .00016717  00000-0  29812-3 0  9995"
	sampleLine2 := "2 25544  51.6416 247.4627 0006703 130.5360 325.0288 15.49815350483021"
	auroraHTTPClient = &http.Client{
		Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
			b, _ := json.Marshal([][]any{
				{"time_tag", "Kp", "a_running", "station_count"},
				{"2026-11-22 06:00:00.000", "2.67", "12", "8"},
				{"2026-11-22 09:00:00.000", "5.33", "56", "8"},
				{"2026-11-22 12:00:00.000", "4.33", "32", "8"},
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
					default:
						price, prev = 0.942, 0.940
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
		fxCacheMu.Lock()
		fxCache = fxCacheEntry{}
		fxCacheMu.Unlock()
		issCacheMu.Lock()
		issCache = issCacheEntry{}
		issCacheMu.Unlock()
		quakesCacheMu.Lock()
		quakesCache = quakesCacheEntry{}
		quakesCacheMu.Unlock()
		auroraCacheMu.Lock()
		auroraCache = auroraCacheEntry{}
		auroraCacheMu.Unlock()
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
	if len(resp.FX) != 3 {
		t.Fatalf("expected 3 FX quotes, got %d: %+v", len(resp.FX), resp.FX)
	}
	if resp.FX[0].Quote != "CNY" || math.Abs(resp.FX[0].Rate-7.245) > 0.0001 || len(resp.FX[0].Sparkline) != 3 {
		t.Fatalf("unexpected CNY quote: %+v", resp.FX[0])
	}
	if resp.FX[1].Quote != "JPY" || math.Abs(resp.FX[1].Rate-154.80) > 0.001 || resp.FX[1].Change >= 0 {
		t.Fatalf("unexpected JPY quote: %+v", resp.FX[1])
	}
	if resp.FX[2].Quote != "EUR" || math.Abs(resp.FX[2].Rate-0.942) > 0.0001 {
		t.Fatalf("unexpected EUR quote: %+v", resp.FX[2])
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
		issCacheMu.Lock()
		issCache = issCacheEntry{}
		issCacheMu.Unlock()
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
