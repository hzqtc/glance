import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import type {
  StockCardMetric,
  StockHero,
  StockPoint,
  StockQuote,
  StockRange,
  StocksResponse,
  TimeFormat,
} from '../types';
import {
  STOCK_RANGES,
  formatChartTooltipTime,
  formatExchangeName,
  formatMarketCap,
  formatMarketState,
  formatStockDelta,
  formatStockPct,
  formatStockValue,
} from '../utils/stocks';
import { StockChart } from './StockChart';
import { StockCard } from './StockCard';
import { StockLogo } from './StockLogo';

export var STOCKS_STORAGE_KEY = 'glance:lastStocks:v1';

interface StocksDashboardProps {
  isActive: boolean;
  timeFormat: TimeFormat;
  cardMetric: StockCardMetric;
  controls?: ComponentChildren;
}

function readCachedStocks(): StocksResponse | null {
  try {
    var raw = window.localStorage.getItem(STOCKS_STORAGE_KEY);
    if (!raw) return null;
    var parsed = JSON.parse(raw) as StocksResponse;
    if (parsed && parsed.hero && parsed.quotes && parsed.quotes.length > 0) {
      return parsed;
    }
  } catch (_err) {
    // Ignore storage errors
  }
  return null;
}

function writeCachedStocks(data: StocksResponse): void {
  try {
    window.localStorage.setItem(STOCKS_STORAGE_KEY, JSON.stringify(data));
  } catch (_err) {
    // Ignore storage errors
  }
}

export function StocksDashboard(props: StocksDashboardProps) {
  var _heroState = useState<StockHero | null>(function () {
    var cached = readCachedStocks();
    return cached ? cached.hero : null;
  });
  var hero = _heroState[0];
  var setHero = _heroState[1];

  var _quotesState = useState<StockQuote[]>(function () {
    var cached = readCachedStocks();
    return cached && cached.quotes ? cached.quotes : [];
  });
  var quotes = _quotesState[0];
  var setQuotes = _quotesState[1];

  var _symbolState = useState<string>(function () {
    var cached = readCachedStocks();
    return cached && cached.hero ? cached.hero.symbol : 'NVDA';
  });
  var selectedSymbol = _symbolState[0];
  var setSelectedSymbol = _symbolState[1];

  var _rangeState = useState<StockRange>('1d');
  var selectedRange = _rangeState[0];
  var setSelectedRange = _rangeState[1];

  var _chartLoadingState = useState<boolean>(false);
  var isChartLoading = _chartLoadingState[0];
  var setIsChartLoading = _chartLoadingState[1];

  var _staleState = useState<boolean>(false);
  var isStale = _staleState[0];
  var setIsStale = _staleState[1];

  var _errorState = useState<string | null>(null);
  var loadError = _errorState[0];
  var setLoadError = _errorState[1];

  var _scrubState = useState<StockPoint | null>(null);
  var scrubPoint = _scrubState[0];
  var setScrubPoint = _scrubState[1];

  var pollTimerRef = useRef<number | null>(null);
  var reqSeqRef = useRef<number>(0);
  var hasLoadedOnceRef = useRef<boolean>(false);
  var selectedSymbolRef = useRef<string>(selectedSymbol);
  var selectedRangeRef = useRef<StockRange>(selectedRange);
  selectedSymbolRef.current = selectedSymbol;
  selectedRangeRef.current = selectedRange;

  function fetchStocks(symbol: string, range: StockRange, chartOnly: boolean) {
    var seq = ++reqSeqRef.current;
    if (chartOnly) {
      setIsChartLoading(true);
    }

    var qs =
      '?symbol=' +
      encodeURIComponent(symbol) +
      '&range=' +
      encodeURIComponent(range) +
      (chartOnly ? '&chartOnly=1' : '');

    return fetch('/api/stocks' + qs, { cache: 'no-cache' })
      .then(function (resp) {
        if (!resp.ok) {
          throw new Error('HTTP ' + String(resp.status));
        }
        return resp.json();
      })
      .then(function (json: StocksResponse) {
        if (seq !== reqSeqRef.current) return json;
        if (json.hero) {
          setHero(json.hero);
        }
        if (!chartOnly && json.quotes && json.quotes.length > 0) {
          setQuotes(json.quotes);
          writeCachedStocks(json);
        }
        setIsStale(false);
        setLoadError(null);
        setIsChartLoading(false);
        return json;
      })
      .catch(function (err) {
        if (seq !== reqSeqRef.current) return null;
        setIsStale(true);
        setLoadError(err && err.message ? String(err.message) : 'Network error');
        setIsChartLoading(false);
        return null;
      });
  }

  // Fetch on first visit to Stocks slide and poll while active (2m market hours / 15m off-hours)
  useEffect(
    function () {
      if (!props.isActive) {
        if (pollTimerRef.current !== null) {
          window.clearTimeout(pollTimerRef.current);
          pollTimerRef.current = null;
        }
        return;
      }

      var cancelled = false;

      function scheduleNext(marketHours: boolean, hadError: boolean) {
        if (cancelled) return;
        if (pollTimerRef.current !== null) {
          window.clearTimeout(pollTimerRef.current);
        }
        var delayMs = hadError
          ? 60 * 1000
          : marketHours
            ? 2 * 60 * 1000
            : 15 * 60 * 1000;
        pollTimerRef.current = window.setTimeout(runPoll, delayMs);
      }

      function runPoll() {
        fetchStocks(selectedSymbolRef.current, selectedRangeRef.current, false).then(
          function (res) {
            if (cancelled) return;
            hasLoadedOnceRef.current = true;
            scheduleNext(Boolean(res && res.marketHours), !res);
          }
        );
      }

      runPoll();

      return function () {
        cancelled = true;
        if (pollTimerRef.current !== null) {
          window.clearTimeout(pollTimerRef.current);
          pollTimerRef.current = null;
        }
      };
    },
    [props.isActive]
  );

  function handleSelectSymbol(sym: string) {
    if (sym === selectedSymbol && hero && hero.symbol === sym) return;
    setScrubPoint(null);
    setSelectedSymbol(sym);
    fetchStocks(sym, selectedRange, true);
  }

  function handleSelectRange(rng: StockRange) {
    if (rng === selectedRange) return;
    setScrubPoint(null);
    setSelectedRange(rng);
    fetchStocks(selectedSymbol, rng, true);
  }

  var displayPrice = hero ? (scrubPoint ? scrubPoint.v : hero.price) : 0;
  var displayChange = hero
    ? scrubPoint
      ? scrubPoint.v - hero.baseline
      : hero.change
    : 0;
  var displayChangePct = hero
    ? scrubPoint
      ? hero.baseline > 0
        ? ((scrubPoint.v - hero.baseline) / hero.baseline) * 100
        : 0
      : hero.changePct
    : 0;
  var isPositive = hero ? hero.change >= 0 : true;
  var isDisplayPositive = displayChange >= 0;
  var marketInfo = hero ? formatMarketState(hero.marketState) : null;

  // Dynamic Low / High for the selected timeframe (uses backend full-series bounds, with points fallback)
  var rangeLow = hero && hero.rangeLow && hero.rangeLow > 0 ? hero.rangeLow : 0;
  var rangeHigh = hero && hero.rangeHigh && hero.rangeHigh > 0 ? hero.rangeHigh : 0;
  if (hero && (rangeLow <= 0 || rangeHigh <= 0) && hero.points && hero.points.length > 0) {
    var minP = hero.points[0].v;
    var maxP = hero.points[0].v;
    for (var k = 1; k < hero.points.length; k++) {
      if (hero.points[k].v < minP) minP = hero.points[k].v;
      if (hero.points[k].v > maxP) maxP = hero.points[k].v;
    }
    rangeLow = minP;
    rangeHigh = maxP;
  }

  // Partition watchlist into rows of 5 (4 rows x 5 cards = 20 symbols)
  var quoteRows: StockQuote[][] = [];
  for (var r = 0; r < quotes.length && quoteRows.length < 4; r += 5) {
    quoteRows.push(quotes.slice(r, r + 5));
  }

  // Resolve hero marketCap (either from hero payload or matching cached watchlist quote)
  var heroMarketCap = hero && hero.marketCap && hero.marketCap > 0 ? hero.marketCap : 0;
  if (hero && heroMarketCap <= 0 && quotes.length > 0) {
    for (var m = 0; m < quotes.length; m++) {
      if (quotes[m].symbol === hero.symbol && quotes[m].marketCap && (quotes[m].marketCap as number) > 0) {
        heroMarketCap = quotes[m].marketCap as number;
        break;
      }
    }
  }

  return (
    <div
      class={
        isPositive
          ? 'stocks-slide stocks-mood-up'
          : 'stocks-slide stocks-mood-down'
      }
    >
      <div class="stocks-backdrop" aria-hidden="true">
        <div class="stocks-glow stocks-glow-up" />
        <div class="stocks-glow stocks-glow-down" />
      </div>

      <div class="dashboard-content stocks-content">
        {hero ? (
          <div class="stocks-hero-stage">
            <section class="stocks-hero-top">
              {props.controls ? (
                <div class="hero-top-center">{props.controls}</div>
              ) : null}

              <div class="stocks-hero-left">
                <div class="hero-location-row">
                  <span
                    class={
                      isStale
                        ? 'status-dot status-dot-stale'
                        : marketInfo && marketInfo.isOpen
                          ? 'status-dot'
                          : 'status-dot status-dot-closed'
                    }
                  />
                  <span class="hero-location-label">
                    {marketInfo ? marketInfo.label : 'Markets'}
                  </span>
                  {hero.exchange ? (
                    <span class="stocks-exchange-tag">
                      {formatExchangeName(hero.exchange)}
                    </span>
                  ) : null}
                </div>

                <div class="stocks-title-row">
                  <StockLogo symbol={hero.symbol} label={hero.label} size="hero" />
                  <span class="stocks-hero-ticker">{hero.label}</span>
                  {hero.label !== hero.symbol ? (
                    <span class="stocks-hero-symbol-sub">{hero.symbol}</span>
                  ) : null}
                </div>
                <div class="stocks-hero-name">{hero.name}</div>
              </div>

              <div class="stocks-hero-right">
                <div class="stocks-hero-price">
                  {formatStockValue(displayPrice, hero.format)}
                </div>
                <div
                  class={
                    isDisplayPositive
                      ? 'stocks-hero-change stocks-up'
                      : 'stocks-hero-change stocks-down'
                  }
                >
                  <span>{formatStockDelta(displayChange, hero.format)}</span>
                  <span class="stocks-hero-pct">
                    ({formatStockPct(displayChangePct)})
                  </span>
                  <span class="stocks-hero-range-tag">
                    {scrubPoint
                      ? formatChartTooltipTime(scrubPoint.t, hero.range, props.timeFormat)
                      : hero.range.toUpperCase()}
                  </span>
                </div>
                <div class="stocks-hero-meta">
                  {rangeHigh > 0 && rangeLow > 0 ? (
                    <span>
                      {hero.range.toUpperCase()} Low{' '}
                      <span class="stocks-meta-val">
                        {formatStockValue(rangeLow, hero.format)}
                      </span>
                      <span class="hero-meta-sep">·</span>
                      High{' '}
                      <span class="stocks-meta-val">
                        {formatStockValue(rangeHigh, hero.format)}
                      </span>
                    </span>
                  ) : null}
                  {heroMarketCap > 0 ? (
                    <span>
                      {rangeHigh > 0 && rangeLow > 0 ? (
                        <span class="hero-meta-sep">·</span>
                      ) : null}
                      Cap{' '}
                      <span class="stocks-meta-val">
                        {formatMarketCap(heroMarketCap)}
                      </span>
                    </span>
                  ) : null}
                </div>
              </div>
            </section>

            <section class="stocks-chart-card">
              <div class="stocks-range-bar" role="tablist" aria-label="Chart timeframe">
                {STOCK_RANGES.map(function (opt) {
                  var active = opt.id === selectedRange;
                  return (
                    <button
                      type="button"
                      role="tab"
                      key={opt.id}
                      aria-selected={active}
                      class={
                        active
                          ? 'range-btn range-btn-active'
                          : 'range-btn'
                      }
                      onClick={function () {
                        handleSelectRange(opt.id);
                      }}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>

              <StockChart
                points={hero.points}
                baseline={hero.baseline}
                format={hero.format}
                range={hero.range}
                timeFormat={props.timeFormat}
                isPositive={isPositive}
                isLoading={isChartLoading}
                onScrub={setScrubPoint}
              />
            </section>
          </div>
        ) : (
          <div class="boot-state">
            {props.controls ? (
              <div class="hero-top-center stocks-boot-controls">{props.controls}</div>
            ) : null}
            <div class="boot-title">Markets</div>
            <div class="boot-sub">
              {loadError
                ? 'Unable to load market data (' + loadError + ')…'
                : 'Loading live quotes…'}
            </div>
          </div>
        )}

        {quoteRows.length > 0 ? (
          <section class="stocks-grid" aria-label="Stock watchlist">
            {quoteRows.map(function (row, rowIdx) {
              return (
                <div
                  key={rowIdx}
                  class={rowIdx === 0 ? 'stocks-row' : 'stocks-row stocks-row-next'}
                >
                  {row.map(function (q) {
                    return (
                      <StockCard
                        key={q.symbol}
                        quote={q}
                        metric={props.cardMetric}
                        isSelected={q.symbol === selectedSymbol}
                        onSelect={handleSelectSymbol}
                      />
                    );
                  })}
                </div>
              );
            })}
          </section>
        ) : null}
      </div>
    </div>
  );
}
