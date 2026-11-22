package handler

import (
	"encoding/json"
	"fmt"
	"net/http"
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

type WorldResponse struct {
	Version   string    `json:"version"`
	FetchedAt string    `json:"fetchedAt"`
	FX        []FXQuote `json:"fx"`
}

type fxCacheEntry struct {
	key       string
	quotes    []FXQuote
	fetchedAt time.Time
}

var (
	fxCacheMu sync.Mutex
	fxCache   fxCacheEntry
)

const fxCacheTTL = 5 * time.Minute

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
	fxQuotes := fetchFXQuotesCached(cfg.World.FXPairs, forceRefresh)

	resp := WorldResponse{
		Version:   version,
		FetchedAt: time.Now().UTC().Format(time.RFC3339),
		FX:        fxQuotes,
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

func writeWorldError(w http.ResponseWriter, status int, message string) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]string{
		"error": message,
	})
}
