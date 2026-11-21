package handler

import (
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net/http"
	"net/http/cookiejar"
	"net/url"
	"strings"
	"sync"
	"time"

	"glance/config"
)

var (
	yahooChartPrimaryURL  = "https://query1.finance.yahoo.com/v8/finance/chart/"
	yahooChartFallbackURL = "https://query2.finance.yahoo.com/v8/finance/chart/"
	yahooSparkPrimaryURL  = "https://query1.finance.yahoo.com/v8/finance/spark"
	yahooSparkFallbackURL = "https://query2.finance.yahoo.com/v8/finance/spark"
	yahooCookieURL        = "https://fc.yahoo.com"
	yahooCrumbURL         = "https://query1.finance.yahoo.com/v1/test/getcrumb"
	yahooQuotePrimaryURL  = "https://query1.finance.yahoo.com/v7/finance/quote"
	yahooQuoteFallbackURL = "https://query2.finance.yahoo.com/v7/finance/quote"
	stocksHTTPClient      = &http.Client{Timeout: 8 * time.Second}
)

var (
	yfSessionMu      sync.Mutex
	yfSessionJar     http.CookieJar
	yfSessionCrumb   string
	yfSessionExpires time.Time

	yfQuoteCacheMu  sync.Mutex
	yfQuoteCache    map[string]yfQuoteMetaItem
	yfQuoteCacheKey string
	yfQuoteCacheExp time.Time
)

type StockPoint struct {
	T int64   `json:"t"` // Unix timestamp in seconds
	V float64 `json:"v"` // Value
}

type StockQuote struct {
	Symbol        string    `json:"symbol"`
	Label         string    `json:"label"`
	Name          string    `json:"name"`
	Format        string    `json:"format"`
	Price         float64   `json:"price"`
	PreviousClose float64   `json:"previousClose"`
	Change        float64   `json:"change"`
	ChangePct     float64   `json:"changePct"`
	MarketCap     float64   `json:"marketCap,omitempty"`
	Sparkline     []float64 `json:"sparkline"`
	Unavailable   bool      `json:"unavailable,omitempty"`
}

type StockHero struct {
	Symbol           string       `json:"symbol"`
	Label            string       `json:"label"`
	Name             string       `json:"name"`
	Format           string       `json:"format"`
	Currency         string       `json:"currency"`
	Exchange          string       `json:"exchange"`
	MarketState       string       `json:"marketState"`
	MarketTime        int64        `json:"marketTime,omitempty"`
	Range             string       `json:"range"`
	Price             float64      `json:"price"`
	PreviousClose     float64      `json:"previousClose"`
	Baseline          float64      `json:"baseline"`
	Change            float64      `json:"change"`
	ChangePct         float64      `json:"changePct"`
	MarketCap         float64      `json:"marketCap,omitempty"`
	ExtendedLabel     string       `json:"extendedLabel,omitempty"`
	ExtendedPrice     float64      `json:"extendedPrice,omitempty"`
	ExtendedChange    float64      `json:"extendedChange,omitempty"`
	ExtendedChangePct float64      `json:"extendedChangePct,omitempty"`
	SessionStart      int64        `json:"sessionStart,omitempty"`
	RegularStart      int64        `json:"regularStart,omitempty"`
	RegularEnd        int64        `json:"regularEnd,omitempty"`
	SessionEnd        int64        `json:"sessionEnd,omitempty"`
	DayHigh           float64      `json:"dayHigh"`
	DayLow           float64      `json:"dayLow"`
	RangeHigh        float64      `json:"rangeHigh"`
	RangeLow         float64      `json:"rangeLow"`
	FiftyTwoWeekHigh float64      `json:"fiftyTwoWeekHigh"`
	FiftyTwoWeekLow  float64      `json:"fiftyTwoWeekLow"`
	Volume           int64        `json:"volume"`
	Points           []StockPoint `json:"points"`
}

type StocksResponse struct {
	Version       string       `json:"version"`
	FetchedAt     string       `json:"fetchedAt"`
	MarketHours   bool         `json:"marketHours"`
	DefaultRange  string       `json:"defaultRange"`
	Hero          *StockHero   `json:"hero"`
	Quotes        []StockQuote `json:"quotes,omitempty"`
}

// Yahoo Finance v8 chart response structures.
type yfChartEnvelope struct {
	Chart struct {
		Result []yfChartResult `json:"result"`
		Error  *struct {
			Code        string `json:"code"`
			Description string `json:"description"`
		} `json:"error"`
	} `json:"chart"`
}

type yfChartResult struct {
	Meta       yfChartMeta `json:"meta"`
	Timestamp  []int64     `json:"timestamp"`
	Indicators struct {
		Quote []struct {
			High  []*float64 `json:"high"`
			Low   []*float64 `json:"low"`
			Close []*float64 `json:"close"`
		} `json:"quote"`
	} `json:"indicators"`
}

type yfTradingPeriod struct {
	Start int64 `json:"start"`
	End   int64 `json:"end"`
}

type yfChartMeta struct {
	Symbol               string  `json:"symbol"`
	ShortName            string  `json:"shortName"`
	LongName             string  `json:"longName"`
	Currency             string  `json:"currency"`
	ExchangeName         string  `json:"exchangeName"`
	MarketState          string  `json:"marketState"`
	RegularMarketTime    int64   `json:"regularMarketTime"`
	RegularMarketPrice   float64 `json:"regularMarketPrice"`
	ChartPreviousClose   float64 `json:"chartPreviousClose"`
	PreviousClose        float64 `json:"previousClose"`
	RegularMarketHigh    float64 `json:"regularMarketDayHigh"`
	RegularMarketLow     float64 `json:"regularMarketDayLow"`
	FiftyTwoWeekHigh     float64 `json:"fiftyTwoWeekHigh"`
	FiftyTwoWeekLow      float64 `json:"fiftyTwoWeekLow"`
	RegularMarketVol     int64   `json:"regularMarketVolume"`
	CurrentTradingPeriod struct {
		Pre     yfTradingPeriod `json:"pre"`
		Regular yfTradingPeriod `json:"regular"`
		Post    yfTradingPeriod `json:"post"`
	} `json:"currentTradingPeriod"`
}

type yahooRangeSpec struct {
	Range    string
	Interval string
}

func mapStockRange(r string) (string, yahooRangeSpec) {
	switch strings.ToLower(strings.TrimSpace(r)) {
	case "1w", "5d":
		return "1w", yahooRangeSpec{Range: "5d", Interval: "15m"}
	case "1m":
		return "1m", yahooRangeSpec{Range: "1mo", Interval: "1h"}
	case "ytd":
		return "ytd", yahooRangeSpec{Range: "ytd", Interval: "1d"}
	case "1y":
		return "1y", yahooRangeSpec{Range: "1y", Interval: "1d"}
	case "2y":
		return "2y", yahooRangeSpec{Range: "2y", Interval: "1wk"}
	case "5y":
		return "5y", yahooRangeSpec{Range: "5y", Interval: "1wk"}
	case "10y":
		return "10y", yahooRangeSpec{Range: "10y", Interval: "1mo"}
	case "all", "max":
		return "all", yahooRangeSpec{Range: "max", Interval: "1mo"}
	default:
		return "1d", yahooRangeSpec{Range: "1d", Interval: "5m"}
	}
}

func mapCardRangeSpec(normRange string, heroSpec yahooRangeSpec) yahooRangeSpec {
	if normRange == "1d" {
		return yahooRangeSpec{Range: "1d", Interval: "15m"}
	}
	return heroSpec
}

// StocksHandler serves GET /api/stocks on Vercel (and locally via cmd/devserver).
func StocksHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		writeStocksError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	rawConfig, isDevDisk, err := config.LoadRawConfig()
	if err != nil {
		writeStocksError(w, http.StatusInternalServerError, fmt.Sprintf("failed to load config: %v", err))
		return
	}

	cfg, err := config.ParseAndNormalizeConfig(rawConfig)
	if err != nil {
		writeStocksError(w, http.StatusInternalServerError, fmt.Sprintf("invalid config: %v", err))
		return
	}

	if len(cfg.Stocks.Symbols) == 0 {
		writeStocksError(w, http.StatusInternalServerError, "no stock symbols configured")
		return
	}

	q := r.URL.Query()
	reqSymbol := strings.TrimSpace(q.Get("symbol"))
	reqRange := strings.TrimSpace(q.Get("range"))
	if reqRange == "" {
		reqRange = cfg.Stocks.DefaultRange
	}
	normRange, spec := mapStockRange(reqRange)
	chartOnly := q.Get("chartOnly") == "1" || strings.EqualFold(q.Get("chartOnly"), "true")

	// Resolve hero symbol metadata from configured watchlist (or allow ad-hoc symbol)
	heroCfg := cfg.Stocks.Symbols[0]
	if reqSymbol != "" {
		found := false
		for _, s := range cfg.Stocks.Symbols {
			if strings.EqualFold(s.Symbol, reqSymbol) {
				heroCfg = s
				found = true
				break
			}
		}
		if !found {
			heroCfg = config.StockSymbolConfig{
				Symbol: strings.ToUpper(reqSymbol),
				Label:  strings.ToUpper(reqSymbol),
				Name:   strings.ToUpper(reqSymbol),
				Format: "currency",
			}
		}
	}

	var (
		hero    *StockHero
		heroErr error
		quotes  []StockQuote
		wg      sync.WaitGroup
	)

	includeHeroPrePost := normRange == "1d"

	// Fetch hero series (and reuse if chartOnly or non-1d)
	if chartOnly {
		heroRes, err := fetchYahooChart(heroCfg.Symbol, spec, includeHeroPrePost)
		if err != nil {
			writeStocksError(w, http.StatusBadGateway, fmt.Sprintf("failed to fetch stock chart: %v", err))
			return
		}
		h := buildStockHero(heroCfg, normRange, heroRes)
		if cached, ok := lookupCachedQuoteMeta(h.Symbol); ok {
			applyQuoteMetaToHero(&h, cached)
		}
		hero = &h
	} else {
		symbols := cfg.Stocks.Symbols
		quotes = make([]StockQuote, len(symbols))
		cardSpec := mapCardRangeSpec(normRange, spec)

		allSyms := make([]string, len(symbols))
		heroInWatchlistIdx := -1
		for i, sc := range symbols {
			allSyms[i] = sc.Symbol
			if strings.EqualFold(sc.Symbol, heroCfg.Symbol) {
				heroInWatchlistIdx = i
			}
		}

		// Launch up to 3 concurrent batched RPCs:
		// 1) /v8/finance/spark for all 20 watchlist cards in a single call
		// 2) /v8/finance/chart/{hero} for high-res hero chart (+ after-hours on 1D) + range high/low
		// 3) /v7/finance/quote for batched marketCap + extended-hours (cached in memory so range switches use 0 RPCs)
		var (
			sparkMap  map[string]*yfChartResult
			quoteMeta map[string]yfQuoteMetaItem
		)

		wg.Add(1)
		go func() {
			defer wg.Done()
			sparkMap = fetchYahooSparkBatched(allSyms, cardSpec)
		}()

		wg.Add(1)
		go func() {
			defer wg.Done()
			res, err := fetchYahooChart(heroCfg.Symbol, spec, includeHeroPrePost)
			if err != nil {
				heroErr = err
				return
			}
			h := buildStockHero(heroCfg, normRange, res)
			hero = &h
		}()

		wg.Add(1)
		go func() {
			defer wg.Done()
			quoteMeta = fetchYahooQuoteMetaCached(allSyms)
		}()

		wg.Wait()

		// Populate quotes from batched spark response; collect any missing symbols for chart fallback
		var missingIdx []int
		for i, sc := range symbols {
			if res, ok := sparkMap[strings.ToUpper(sc.Symbol)]; ok && res != nil && len(extractValidPoints(res)) > 0 {
				quotes[i] = buildStockQuote(sc, normRange, res)
			} else {
				missingIdx = append(missingIdx, i)
			}
		}

		// Automatic per-symbol fallback ONLY for symbols missing from batched spark response
		if len(missingIdx) > 0 {
			var fbWg sync.WaitGroup
			sem := make(chan struct{}, 8)
			for _, idx := range missingIdx {
				fbWg.Add(1)
				go func(i int, item config.StockSymbolConfig) {
					defer fbWg.Done()
					sem <- struct{}{}
					defer func() { <-sem }()

					res, err := fetchYahooChart(item.Symbol, cardSpec, false)
					if err != nil {
						quotes[i] = StockQuote{
							Symbol:      item.Symbol,
							Label:       item.Label,
							Name:        item.Name,
							Format:      item.Format,
							Sparkline:   []float64{},
							Unavailable: true,
						}
						return
					}
					quotes[i] = buildStockQuote(item, normRange, res)
				}(idx, symbols[idx])
			}
			fbWg.Wait()
		}

		// Fallback hero from spark if dedicated chart call failed
		if hero == nil && heroInWatchlistIdx >= 0 {
			if res, ok := sparkMap[strings.ToUpper(heroCfg.Symbol)]; ok && res != nil {
				h := buildStockHero(heroCfg, normRange, res)
				hero = &h
				heroErr = nil
			}
		}

		// Keep the selected hero's matching card 100% consistent with hero price/change
		if hero != nil && heroInWatchlistIdx >= 0 && !quotes[heroInWatchlistIdx].Unavailable {
			quotes[heroInWatchlistIdx].Price = hero.Price
			quotes[heroInWatchlistIdx].Change = hero.Change
			quotes[heroInWatchlistIdx].ChangePct = hero.ChangePct
		}

		// Attach cached/fetched market caps & extended hours to quotes and hero
		if len(quoteMeta) > 0 {
			for i := range quotes {
				if meta, ok := quoteMeta[strings.ToUpper(quotes[i].Symbol)]; ok && meta.MarketCap > 0 {
					quotes[i].MarketCap = meta.MarketCap
				}
			}
			if hero != nil {
				if meta, ok := quoteMeta[strings.ToUpper(hero.Symbol)]; ok {
					applyQuoteMetaToHero(hero, meta)
				}
			}
		}

		if hero == nil && heroErr != nil {
			writeStocksError(w, http.StatusBadGateway, fmt.Sprintf("failed to fetch stocks: %v", heroErr))
			return
		}
	}

	marketHours := isUSMarketHoursNow(time.Now().UTC())
	resp := StocksResponse{
		Version:      config.ComputeVersion(rawConfig),
		FetchedAt:    time.Now().UTC().Format(time.RFC3339),
		MarketHours:  marketHours,
		DefaultRange: cfg.Stocks.DefaultRange,
		Hero:         hero,
		Quotes:       quotes,
	}

	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	if isDevDisk {
		w.Header().Set("Cache-Control", "no-store")
	} else {
		maxAge := 300
		if chartOnly && normRange != "1d" && normRange != "1w" {
			maxAge = 600
		} else if marketHours {
			maxAge = 60
		}
		w.Header().Set("Cache-Control", fmt.Sprintf("public, s-maxage=%d, stale-while-revalidate=%d", maxAge, maxAge))
	}
	w.WriteHeader(http.StatusOK)
	if r.Method == http.MethodHead {
		return
	}
	_ = json.NewEncoder(w).Encode(resp)
}

func fetchYahooChart(symbol string, spec yahooRangeSpec, includePrePost bool) (*yfChartResult, error) {
	escaped := url.PathEscape(symbol)
	params := url.Values{}
	params.Set("range", spec.Range)
	params.Set("interval", spec.Interval)
	if includePrePost {
		params.Set("includePrePost", "true")
	} else {
		params.Set("includePrePost", "false")
	}
	qs := params.Encode()

	urls := []string{
		yahooChartPrimaryURL + escaped + "?" + qs,
		yahooChartFallbackURL + escaped + "?" + qs,
	}

	var lastErr error
	for _, u := range urls {
		res, err := fetchYahooChartFromURL(u)
		if err == nil {
			return res, nil
		}
		lastErr = err
	}
	return nil, lastErr
}

func fetchYahooChartFromURL(reqURL string) (*yfChartResult, error) {
	req, err := http.NewRequest(http.MethodGet, reqURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15")
	req.Header.Set("Accept", "application/json")

	resp, err := stocksHTTPClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("yahoo chart returned status %d", resp.StatusCode)
	}

	var env yfChartEnvelope
	if err := json.Unmarshal(body, &env); err != nil {
		return nil, err
	}
	if env.Chart.Error != nil {
		return nil, fmt.Errorf("yahoo chart error: %s", env.Chart.Error.Description)
	}
	if len(env.Chart.Result) == 0 {
		return nil, fmt.Errorf("empty yahoo chart result")
	}
	return &env.Chart.Result[0], nil
}

// fetchYahooSparkBatched fetches close-price sparklines for up to 20 symbols per HTTP request
// via Yahoo Finance's /v8/finance/spark endpoint (chunking automatically if >20 symbols).
func fetchYahooSparkBatched(symbols []string, spec yahooRangeSpec) map[string]*yfChartResult {
	out := make(map[string]*yfChartResult, len(symbols))
	if len(symbols) == 0 {
		return out
	}

	const batchSize = 20
	for start := 0; start < len(symbols); start += batchSize {
		end := start + batchSize
		if end > len(symbols) {
			end = len(symbols)
		}
		chunk := symbols[start:end]
		partial := fetchYahooSparkChunk(chunk, spec)
		for k, v := range partial {
			out[k] = v
		}
	}
	return out
}

func fetchYahooSparkChunk(symbols []string, spec yahooRangeSpec) map[string]*yfChartResult {
	params := url.Values{}
	params.Set("symbols", strings.Join(symbols, ","))
	params.Set("range", spec.Range)
	params.Set("interval", spec.Interval)
	params.Set("includePrePost", "false")
	qs := params.Encode()

	urls := []string{
		yahooSparkPrimaryURL + "?" + qs,
		yahooSparkFallbackURL + "?" + qs,
	}

	const ua = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15"

	for _, u := range urls {
		req, err := http.NewRequest(http.MethodGet, u, nil)
		if err != nil {
			continue
		}
		req.Header.Set("User-Agent", ua)
		req.Header.Set("Accept", "application/json")

		resp, err := stocksHTTPClient.Do(req)
		if err != nil {
			continue
		}
		body, readErr := io.ReadAll(resp.Body)
		_ = resp.Body.Close()
		if readErr != nil || resp.StatusCode != http.StatusOK {
			continue
		}

		parsed := decodeYahooSparkBody(body)
		if len(parsed) > 0 {
			return parsed
		}
	}
	return nil
}

// decodeYahooSparkBody supports both Yahoo /v8/finance/spark response shapes:
// 1) {"spark":{"result":[{"symbol":"NVDA","response":[{meta,timestamp,indicators}]}]}}
// 2) {"NVDA":{"symbol":"NVDA","chartPreviousClose":...,"timestamp":[...],"close":[...]}}
func decodeYahooSparkBody(body []byte) map[string]*yfChartResult {
	out := make(map[string]*yfChartResult)

	// Format 1: {"spark": {"result": [...]}}
	var wrapped struct {
		Spark *struct {
			Result []struct {
				Symbol   string          `json:"symbol"`
				Response []yfChartResult `json:"response"`
			} `json:"result"`
		} `json:"spark"`
	}
	if err := json.Unmarshal(body, &wrapped); err == nil && wrapped.Spark != nil && len(wrapped.Spark.Result) > 0 {
		for _, item := range wrapped.Spark.Result {
			if len(item.Response) == 0 {
				continue
			}
			r := item.Response[0]
			sym := item.Symbol
			if sym == "" {
				sym = r.Meta.Symbol
			}
			if sym != "" {
				copyR := r
				out[strings.ToUpper(sym)] = &copyR
			}
		}
		if len(out) > 0 {
			return out
		}
	}

	// Format 2: Root-keyed {"NVDA": {...}, "AAPL": {...}}
	var root map[string]json.RawMessage
	if err := json.Unmarshal(body, &root); err != nil {
		return out
	}

	type flatSparkEntry struct {
		Symbol             string          `json:"symbol"`
		RegularMarketPrice float64         `json:"regularMarketPrice"`
		ChartPreviousClose float64         `json:"chartPreviousClose"`
		PreviousClose      float64         `json:"previousClose"`
		Timestamp          []int64         `json:"timestamp"`
		Close              []*float64      `json:"close"`
		Response           []yfChartResult `json:"response"`
		Meta               *yfChartMeta    `json:"meta"`
		Indicators         *struct {
			Quote []struct {
				High  []*float64 `json:"high"`
				Low   []*float64 `json:"low"`
				Close []*float64 `json:"close"`
			} `json:"quote"`
		} `json:"indicators"`
	}

	for key, raw := range root {
		lowerKey := strings.ToLower(key)
		if lowerKey == "spark" || lowerKey == "error" || lowerKey == "finance" {
			continue
		}
		var entry flatSparkEntry
		if err := json.Unmarshal(raw, &entry); err != nil {
			continue
		}
		sym := entry.Symbol
		if sym == "" {
			sym = key
		}
		if len(entry.Response) > 0 {
			copyR := entry.Response[0]
			out[strings.ToUpper(sym)] = &copyR
			continue
		}
		if entry.Indicators != nil && len(entry.Indicators.Quote) > 0 {
			r := yfChartResult{
				Timestamp: entry.Timestamp,
			}
			if entry.Meta != nil {
				r.Meta = *entry.Meta
			} else {
				r.Meta = yfChartMeta{
					Symbol:             sym,
					RegularMarketPrice: entry.RegularMarketPrice,
					ChartPreviousClose: entry.ChartPreviousClose,
					PreviousClose:      entry.PreviousClose,
				}
			}
			r.Indicators.Quote = entry.Indicators.Quote
			out[strings.ToUpper(sym)] = &r
			continue
		}
		if len(entry.Close) > 0 && len(entry.Timestamp) > 0 {
			r := yfChartResult{
				Meta: yfChartMeta{
					Symbol:             sym,
					RegularMarketPrice: entry.RegularMarketPrice,
					ChartPreviousClose: entry.ChartPreviousClose,
					PreviousClose:      entry.PreviousClose,
				},
				Timestamp: entry.Timestamp,
			}
			r.Indicators.Quote = []struct {
				High  []*float64 `json:"high"`
				Low   []*float64 `json:"low"`
				Close []*float64 `json:"close"`
			}{{Close: entry.Close}}
			out[strings.ToUpper(sym)] = &r
		}
	}

	return out
}

func extractValidPoints(res *yfChartResult) []StockPoint {
	if res == nil || len(res.Timestamp) == 0 || len(res.Indicators.Quote) == 0 {
		return []StockPoint{}
	}
	closes := res.Indicators.Quote[0].Close
	n := len(res.Timestamp)
	if len(closes) < n {
		n = len(closes)
	}
	pts := make([]StockPoint, 0, n)
	for i := 0; i < n; i++ {
		if closes[i] == nil {
			continue
		}
		v := *closes[i]
		if math.IsNaN(v) || math.IsInf(v, 0) {
			continue
		}
		pts = append(pts, StockPoint{T: res.Timestamp[i], V: v})
	}
	return pts
}

func downsamplePoints(pts []StockPoint, maxPoints int) []StockPoint {
	n := len(pts)
	if n <= maxPoints || maxPoints < 2 {
		return pts
	}
	out := make([]StockPoint, 0, maxPoints)
	step := float64(n-1) / float64(maxPoints-1)
	for i := 0; i < maxPoints-1; i++ {
		idx := int(math.Round(float64(i) * step))
		if idx >= n {
			idx = n - 1
		}
		out = append(out, pts[idx])
	}
	out = append(out, pts[n-1])
	return out
}

func resolvePrevClose(meta yfChartMeta, pts []StockPoint) float64 {
	if meta.PreviousClose > 0 {
		return meta.PreviousClose
	}
	if meta.ChartPreviousClose > 0 {
		return meta.ChartPreviousClose
	}
	if len(pts) > 0 {
		return pts[0].V
	}
	return meta.RegularMarketPrice
}

func resolvePrice(meta yfChartMeta, pts []StockPoint) float64 {
	if meta.RegularMarketPrice > 0 {
		return meta.RegularMarketPrice
	}
	if len(pts) > 0 {
		return pts[len(pts)-1].V
	}
	return 0
}

func buildStockQuote(cfg config.StockSymbolConfig, normRange string, res *yfChartResult) StockQuote {
	pts := extractValidPoints(res)
	price := resolvePrice(res.Meta, pts)
	prevClose := resolvePrevClose(res.Meta, pts)

	baseline := prevClose
	if normRange != "1d" && len(pts) > 0 {
		baseline = pts[0].V
	} else if baseline <= 0 && len(pts) > 0 {
		baseline = pts[0].V
	}

	change := price - baseline
	var changePct float64
	if baseline > 0 {
		changePct = (change / baseline) * 100
	}

	sparkPts := downsamplePoints(pts, 24)
	spark := make([]float64, len(sparkPts))
	for i, p := range sparkPts {
		spark[i] = p.V
	}

	name := cfg.Name
	if name == "" {
		if res.Meta.ShortName != "" {
			name = res.Meta.ShortName
		} else {
			name = cfg.Label
		}
	}

	return StockQuote{
		Symbol:        cfg.Symbol,
		Label:         cfg.Label,
		Name:          name,
		Format:        cfg.Format,
		Price:         price,
		PreviousClose: prevClose,
		Change:        change,
		ChangePct:     changePct,
		Sparkline:     spark,
	}
}

func computeRangeHighLow(normRange string, res *yfChartResult, pts []StockPoint, price float64, minTimestamp int64) (float64, float64) {
	hasVal := false
	minV := 0.0
	maxV := 0.0

	consider := func(v float64) {
		if math.IsNaN(v) || math.IsInf(v, 0) || v <= 0 {
			return
		}
		if !hasVal {
			minV = v
			maxV = v
			hasVal = true
			return
		}
		if v < minV {
			minV = v
		}
		if v > maxV {
			maxV = v
		}
	}

	if res != nil && len(res.Indicators.Quote) > 0 {
		q := res.Indicators.Quote[0]
		ts := res.Timestamp
		for i, h := range q.High {
			if minTimestamp > 0 && i < len(ts) && ts[i] < minTimestamp {
				continue
			}
			if h != nil {
				consider(*h)
			}
		}
		for i, l := range q.Low {
			if minTimestamp > 0 && i < len(ts) && ts[i] < minTimestamp {
				continue
			}
			if l != nil {
				consider(*l)
			}
		}
	}

	// Fallback / merge with valid close points
	for _, p := range pts {
		consider(p.V)
	}
	consider(price)

	if normRange == "1d" && res != nil {
		if res.Meta.RegularMarketHigh > 0 {
			consider(res.Meta.RegularMarketHigh)
		}
		if res.Meta.RegularMarketLow > 0 {
			consider(res.Meta.RegularMarketLow)
		}
	}

	if !hasVal {
		return 0, 0
	}
	return maxV, minV
}

func buildStockHero(cfg config.StockSymbolConfig, normRange string, res *yfChartResult) StockHero {
	allPts := extractValidPoints(res)
	price := resolvePrice(res.Meta, allPts)
	prevClose := resolvePrevClose(res.Meta, allPts)

	marketState := res.Meta.MarketState
	if marketState == "" {
		if isUSMarketHoursNow(time.Now().UTC()) {
			marketState = "REGULAR"
		} else {
			marketState = "CLOSED"
		}
	}

	var (
		pts               = allPts
		sessionStart      int64
		regularStart      int64
		regularEnd        int64
		sessionEnd        int64
		extendedLabel     string
		extendedPrice     float64
		extendedChange    float64
		extendedChangePct float64
		minRangeTs        int64
	)

	// On 1D hero chart:
	// - Frame regular session proportionally (e.g. 6:30 AM - 1:00 PM PT)
	// - Include after-hours points seamlessly after regular close (extending axis to post.end)
	// - Filter out pre-market points unless currently in PRE-market so regular hours stay wide & clean
	if normRange == "1d" && res != nil {
		tp := res.Meta.CurrentTradingPeriod
		if tp.Regular.Start > 0 && tp.Regular.End > tp.Regular.Start {
			regularStart = tp.Regular.Start
			regularEnd = tp.Regular.End

			upperState := strings.ToUpper(marketState)
			hasPrePoints := false
			hasPostPoints := false
			for _, p := range allPts {
				if p.T < regularStart {
					hasPrePoints = true
				}
				if p.T > regularEnd {
					hasPostPoints = true
				}
			}

			if upperState == "PRE" && hasPrePoints && tp.Pre.Start > 0 {
				sessionStart = tp.Pre.Start
				sessionEnd = regularEnd
				minRangeTs = sessionStart
			} else {
				// Filter to Regular + After-Hours (>= regularStart) when regular/post points exist
				filtered := make([]StockPoint, 0, len(allPts))
				for _, p := range allPts {
					if p.T >= regularStart {
						filtered = append(filtered, p)
					}
				}
				if len(filtered) >= 2 {
					pts = filtered
					minRangeTs = regularStart
				}
				sessionStart = regularStart
				if hasPostPoints {
					lastT := pts[len(pts)-1].T
					sessionEnd = tp.Post.End
					if lastT > sessionEnd {
						sessionEnd = lastT
					}
				} else {
					sessionEnd = regularEnd
				}
			}

			// Fallback after-hours summary from 1D chart tail (overridden if /v7/quote provides official postMarket*)
			if hasPostPoints && len(pts) > 0 && price > 0 {
				lastPt := pts[len(pts)-1]
				if lastPt.T > regularEnd && lastPt.V > 0 {
					extendedLabel = "AH"
					extendedPrice = lastPt.V
					extendedChange = lastPt.V - price
					extendedChangePct = (extendedChange / price) * 100
				}
			}
		}
	}

	rangeHigh, rangeLow := computeRangeHighLow(normRange, res, pts, price, minRangeTs)

	baseline := prevClose
	if normRange != "1d" && len(pts) > 0 {
		baseline = pts[0].V
	} else if baseline <= 0 && len(pts) > 0 {
		baseline = pts[0].V
	}

	change := price - baseline
	var changePct float64
	if baseline > 0 {
		changePct = (change / baseline) * 100
	}

	name := cfg.Name
	if name == "" {
		if res.Meta.ShortName != "" {
			name = res.Meta.ShortName
		} else if res.Meta.LongName != "" {
			name = res.Meta.LongName
		} else {
			name = cfg.Label
		}
	}

	marketTime := res.Meta.RegularMarketTime
	if marketTime <= 0 && len(pts) > 0 {
		marketTime = pts[len(pts)-1].T
	}

	return StockHero{
		Symbol:            cfg.Symbol,
		Label:             cfg.Label,
		Name:              name,
		Format:            cfg.Format,
		Currency:          res.Meta.Currency,
		Exchange:          res.Meta.ExchangeName,
		MarketState:       marketState,
		MarketTime:        marketTime,
		Range:             normRange,
		Price:             price,
		PreviousClose:     prevClose,
		Baseline:          baseline,
		Change:            change,
		ChangePct:         changePct,
		ExtendedLabel:     extendedLabel,
		ExtendedPrice:     extendedPrice,
		ExtendedChange:    extendedChange,
		ExtendedChangePct: extendedChangePct,
		SessionStart:      sessionStart,
		RegularStart:      regularStart,
		RegularEnd:        regularEnd,
		SessionEnd:        sessionEnd,
		DayHigh:           res.Meta.RegularMarketHigh,
		DayLow:            res.Meta.RegularMarketLow,
		RangeHigh:         rangeHigh,
		RangeLow:          rangeLow,
		FiftyTwoWeekHigh:  res.Meta.FiftyTwoWeekHigh,
		FiftyTwoWeekLow:   res.Meta.FiftyTwoWeekLow,
		Volume:            res.Meta.RegularMarketVol,
		Points:            downsamplePoints(pts, 160),
	}
}

func applyQuoteMetaToHero(hero *StockHero, meta yfQuoteMetaItem) {
	if hero == nil {
		return
	}
	if meta.MarketCap > 0 {
		hero.MarketCap = meta.MarketCap
	}
	if hero.MarketTime <= 0 && meta.RegularMarketTime > 0 {
		hero.MarketTime = meta.RegularMarketTime
	}
	state := strings.ToUpper(hero.MarketState)
	if state == "" {
		state = strings.ToUpper(meta.MarketState)
	}
	if state == "PRE" && meta.PreMarketPrice > 0 {
		hero.ExtendedLabel = "PM"
		hero.ExtendedPrice = meta.PreMarketPrice
		hero.ExtendedChange = meta.PreMarketChange
		hero.ExtendedChangePct = meta.PreMarketChangePercent
	} else if state != "REGULAR" && meta.PostMarketPrice > 0 {
		hero.ExtendedLabel = "AH"
		hero.ExtendedPrice = meta.PostMarketPrice
		hero.ExtendedChange = meta.PostMarketChange
		hero.ExtendedChangePct = meta.PostMarketChangePercent
	}
}

// isUSMarketHoursNow approximates US regular + brief buffer hours (Mon-Fri 9:25-16:30 ET)
// without requiring OS tzdata in minimal serverless containers.
func isUSMarketHoursNow(nowUTC time.Time) bool {
	loc, err := time.LoadLocation("America/New_York")
	var et time.Time
	if err == nil {
		et = nowUTC.In(loc)
	} else {
		// Fallback to EST (UTC-5) if tzdata is missing
		et = nowUTC.Add(-5 * time.Hour)
	}
	wd := et.Weekday()
	if wd == time.Saturday || wd == time.Sunday {
		return false
	}
	mins := et.Hour()*60 + et.Minute()
	return mins >= 9*60+25 && mins <= 16*60+30
}

func writeStocksError(w http.ResponseWriter, status int, message string) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]string{
		"error": message,
	})
}

type yfQuoteMetaItem struct {
	Symbol                 string  `json:"symbol"`
	MarketState            string  `json:"marketState"`
	MarketCap              float64 `json:"marketCap"`
	RegularMarketTime      int64   `json:"regularMarketTime"`
	PreMarketPrice         float64 `json:"preMarketPrice"`
	PreMarketChange        float64 `json:"preMarketChange"`
	PreMarketChangePercent float64 `json:"preMarketChangePercent"`
	PostMarketPrice        float64 `json:"postMarketPrice"`
	PostMarketChange       float64 `json:"postMarketChange"`
	PostMarketChangePercent float64 `json:"postMarketChangePercent"`
}

type yfQuoteEnvelope struct {
	QuoteResponse struct {
		Result []yfQuoteMetaItem `json:"result"`
	} `json:"quoteResponse"`
}

func lookupCachedQuoteMeta(symbol string) (yfQuoteMetaItem, bool) {
	yfQuoteCacheMu.Lock()
	defer yfQuoteCacheMu.Unlock()
	if yfQuoteCache == nil || time.Now().After(yfQuoteCacheExp) {
		return yfQuoteMetaItem{}, false
	}
	item, ok := yfQuoteCache[strings.ToUpper(symbol)]
	return item, ok
}

func isUSExtendedHoursNow(nowUTC time.Time) bool {
	loc, err := time.LoadLocation("America/New_York")
	var et time.Time
	if err == nil {
		et = nowUTC.In(loc)
	} else {
		et = nowUTC.Add(-5 * time.Hour)
	}
	wd := et.Weekday()
	if wd == time.Saturday || wd == time.Sunday {
		return false
	}
	mins := et.Hour()*60 + et.Minute()
	return mins >= 4*60 && mins <= 20*60+15
}

func getYahooSession(forceRefresh bool) (http.CookieJar, string, error) {
	yfSessionMu.Lock()
	defer yfSessionMu.Unlock()

	if !forceRefresh && yfSessionJar != nil && yfSessionCrumb != "" && time.Now().Before(yfSessionExpires) {
		return yfSessionJar, yfSessionCrumb, nil
	}

	jar, err := cookiejar.New(nil)
	if err != nil {
		return nil, "", err
	}
	client := &http.Client{
		Timeout:   6 * time.Second,
		Jar:       jar,
		Transport: stocksHTTPClient.Transport,
	}

	const ua = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15"

	// 1. Grab Yahoo consent/session cookie
	cookieReq, err := http.NewRequest(http.MethodGet, yahooCookieURL, nil)
	if err != nil {
		return nil, "", err
	}
	cookieReq.Header.Set("User-Agent", ua)
	if resp, err := client.Do(cookieReq); err == nil {
		_, _ = io.Copy(io.Discard, resp.Body)
		_ = resp.Body.Close()
	}

	// 2. Fetch crumb token using session cookie
	crumbReq, err := http.NewRequest(http.MethodGet, yahooCrumbURL, nil)
	if err != nil {
		return nil, "", err
	}
	crumbReq.Header.Set("User-Agent", ua)
	crumbResp, err := client.Do(crumbReq)
	if err != nil {
		return nil, "", err
	}
	defer crumbResp.Body.Close()

	crumbBytes, err := io.ReadAll(crumbResp.Body)
	if err != nil {
		return nil, "", err
	}
	crumb := strings.TrimSpace(string(crumbBytes))
	if crumbResp.StatusCode != http.StatusOK || crumb == "" || strings.HasPrefix(crumb, "{") {
		return nil, "", fmt.Errorf("failed to get yahoo crumb (status %d)", crumbResp.StatusCode)
	}

	yfSessionJar = jar
	yfSessionCrumb = crumb
	yfSessionExpires = time.Now().Add(30 * time.Minute)
	return jar, crumb, nil
}

func fetchYahooQuoteMetaCached(symbols []string) map[string]yfQuoteMetaItem {
	if len(symbols) == 0 {
		return nil
	}
	cacheKey := strings.ToUpper(strings.Join(symbols, ","))

	yfQuoteCacheMu.Lock()
	if yfQuoteCache != nil && yfQuoteCacheKey == cacheKey && time.Now().Before(yfQuoteCacheExp) {
		cached := yfQuoteCache
		yfQuoteCacheMu.Unlock()
		return cached
	}
	yfQuoteCacheMu.Unlock()

	const ua = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15"

	for attempt := 0; attempt < 2; attempt++ {
		jar, crumb, err := getYahooSession(attempt > 0)
		if err != nil {
			continue
		}

		client := &http.Client{
			Timeout:   6 * time.Second,
			Jar:       jar,
			Transport: stocksHTTPClient.Transport,
		}

		params := url.Values{}
		params.Set("symbols", strings.Join(symbols, ","))
		params.Set("fields", "marketCap,marketState,regularMarketTime,preMarketPrice,preMarketChange,preMarketChangePercent,postMarketPrice,postMarketChange,postMarketChangePercent")
		params.Set("crumb", crumb)
		qs := params.Encode()

		urls := []string{
			yahooQuotePrimaryURL + "?" + qs,
			yahooQuoteFallbackURL + "?" + qs,
		}

		needRefresh := false
		for _, u := range urls {
			req, err := http.NewRequest(http.MethodGet, u, nil)
			if err != nil {
				continue
			}
			req.Header.Set("User-Agent", ua)
			req.Header.Set("Accept", "application/json")

			resp, err := client.Do(req)
			if err != nil {
				continue
			}
			body, readErr := io.ReadAll(resp.Body)
			_ = resp.Body.Close()
			if readErr != nil {
				continue
			}
			if resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == http.StatusForbidden {
				needRefresh = true
				break
			}
			if resp.StatusCode != http.StatusOK {
				continue
			}

			var env yfQuoteEnvelope
			if err := json.Unmarshal(body, &env); err != nil {
				continue
			}
			out := make(map[string]yfQuoteMetaItem, len(env.QuoteResponse.Result))
			for _, item := range env.QuoteResponse.Result {
				if item.Symbol != "" {
					out[strings.ToUpper(item.Symbol)] = item
				}
			}

			ttl := 15 * time.Minute
			if isUSExtendedHoursNow(time.Now().UTC()) {
				ttl = 60 * time.Second
			}
			yfQuoteCacheMu.Lock()
			yfQuoteCache = out
			yfQuoteCacheKey = cacheKey
			yfQuoteCacheExp = time.Now().Add(ttl)
			yfQuoteCacheMu.Unlock()
			return out
		}

		if !needRefresh {
			break
		}
	}
	return nil
}
