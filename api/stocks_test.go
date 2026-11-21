package handler

import (
	"bytes"
	"encoding/json"
	"io"
	"math"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestMapStockRange(t *testing.T) {
	cases := []struct {
		in           string
		wantNorm     string
		wantYahooRng string
	}{
		{"1d", "1d", "1d"},
		{"1w", "1w", "5d"},
		{"1m", "1m", "1mo"},
		{"ytd", "ytd", "ytd"},
		{"1y", "1y", "1y"},
		{"2y", "2y", "2y"},
		{"5y", "5y", "5y"},
		{"10y", "10y", "10y"},
		{"all", "all", "max"},
		{"unknown", "1d", "1d"},
	}
	for _, tc := range cases {
		norm, spec := mapStockRange(tc.in)
		if norm != tc.wantNorm || spec.Range != tc.wantYahooRng {
			t.Fatalf("mapStockRange(%q) = (%q, %+v), want (%q, %q)", tc.in, norm, spec, tc.wantNorm, tc.wantYahooRng)
		}
	}
}

func TestDownsamplePointsPreservesEnds(t *testing.T) {
	pts := make([]StockPoint, 300)
	for i := range pts {
		pts[i] = StockPoint{T: int64(1000 + i*60), V: float64(100 + i)}
	}
	out := downsamplePoints(pts, 140)
	if len(out) != 140 {
		t.Fatalf("expected 140 points, got %d", len(out))
	}
	if out[0] != pts[0] || out[len(out)-1] != pts[len(pts)-1] {
		t.Fatalf("endpoints not preserved: first=%+v last=%+v", out[0], out[len(out)-1])
	}
}

func TestStocksHandlerEndToEndAndChartOnly(t *testing.T) {
	mockChart := `{
		"chart": {
			"result": [{
				"meta": {
					"symbol": "^GSPC",
					"shortName": "S&P 500",
					"currency": "USD",
					"exchangeName": "SNP",
					"marketState": "REGULAR",
					"regularMarketPrice": 5920.5,
					"chartPreviousClose": 5880.0,
					"regularMarketDayHigh": 5930.0,
					"regularMarketDayLow": 5875.0,
					"fiftyTwoWeekHigh": 6010.0,
					"fiftyTwoWeekLow": 4800.0,
					"regularMarketVolume": 2150000000
				},
				"timestamp": [1732113000, 1732113300, 1732113600, 1732113900],
				"indicators": {
					"quote": [{
						"high": [5902.0, null, 5918.0, 5928.0],
						"low": [5882.0, null, 5900.0, 5912.0],
						"close": [5890.0, null, 5910.0, 5920.5]
					}]
				}
			}],
			"error": null
		}
	}`

	origClient := stocksHTTPClient
	stocksHTTPClient = &http.Client{
		Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
			return &http.Response{
				StatusCode: http.StatusOK,
				Header:     http.Header{"Content-Type": []string{"application/json"}},
				Body:       io.NopCloser(bytes.NewBufferString(mockChart)),
			}, nil
		}),
	}
	defer func() { stocksHTTPClient = origClient }()

	// Full load (hero + 10 watchlist quotes)
	req := httptest.NewRequest(http.MethodGet, "/api/stocks?symbol=%5EGSPC&range=1d", nil)
	rec := httptest.NewRecorder()
	StocksHandler(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	var full StocksResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &full); err != nil {
		t.Fatalf("invalid json: %v", err)
	}
	if full.Hero == nil || full.Hero.Label != "S&P 500" || full.Hero.Format != "points" {
		t.Fatalf("unexpected hero: %+v", full.Hero)
	}
	if len(full.Hero.Points) != 3 {
		t.Fatalf("expected 3 non-null points, got %d", len(full.Hero.Points))
	}
	if math.Abs(full.Hero.Change-40.5) > 0.01 {
		t.Fatalf("expected 1D change 40.5, got %v", full.Hero.Change)
	}
	if full.Hero.RangeHigh != 5930.0 || full.Hero.RangeLow != 5875.0 {
		t.Fatalf("expected 1D range 5875..5930, got %v..%v", full.Hero.RangeLow, full.Hero.RangeHigh)
	}
	if len(full.Quotes) != 20 {
		t.Fatalf("expected 20 watchlist quotes, got %d", len(full.Quotes))
	}

	// chartOnly=1 for 1y timeframe switching
	req2 := httptest.NewRequest(http.MethodGet, "/api/stocks?symbol=NVDA&range=1y&chartOnly=1", nil)
	rec2 := httptest.NewRecorder()
	StocksHandler(rec2, req2)

	if rec2.Code != http.StatusOK {
		t.Fatalf("expected 200 for chartOnly, got %d", rec2.Code)
	}
	var chartResp StocksResponse
	if err := json.Unmarshal(rec2.Body.Bytes(), &chartResp); err != nil {
		t.Fatalf("invalid chartOnly json: %v", err)
	}
	if chartResp.Hero == nil || chartResp.Hero.Range != "1y" || len(chartResp.Quotes) != 0 {
		t.Fatalf("unexpected chartOnly response: %+v", chartResp)
	}
	// Multi-day change should compare against first point (5920.5 - 5890.0 = 30.5)
	if math.Abs(chartResp.Hero.Change-30.5) > 0.01 {
		t.Fatalf("expected 1y change 30.5, got %v", chartResp.Hero.Change)
	}
	if chartResp.Hero.RangeHigh != 5928.0 || chartResp.Hero.RangeLow != 5882.0 {
		t.Fatalf("expected 1y range 5882..5928, got %v..%v", chartResp.Hero.RangeLow, chartResp.Hero.RangeHigh)
	}
}
