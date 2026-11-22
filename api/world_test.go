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
		fxCacheMu.Lock()
		fxCache = fxCacheEntry{}
		fxCacheMu.Unlock()
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
}
