import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import type {
  StockHero,
  StockQuote,
  StockRange,
  StocksResponse,
  TimeFormat,
} from '../types';
import {
  STOCK_RANGES,
  formatMarketState,
  formatStockDelta,
  formatStockPct,
  formatStockValue,
} from '../utils/stocks';
import { StockChart } from './StockChart';
import { StockCard } from './StockCard';

export var STOCKS_STORAGE_KEY = 'glance:lastStocks:v1';

interface StocksDashboardProps {
  isActive: boolean;
  timeFormat: TimeFormat;
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
    return cached && cached.hero ? cached.hero.symbol : '^GSPC';
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
    setSelectedSymbol(sym);
    fetchStocks(sym, selectedRange, true);
  }

  function handleSelectRange(rng: StockRange) {
    if (rng === selectedRange) return;
    setSelectedRange(rng);
    fetchStocks(selectedSymbol, rng, true);
  }

  var isPositive = hero ? hero.change >= 0 : true;
  var marketInfo = hero ? formatMarketState(hero.marketState) : null;
  var row1 = quotes.slice(0, 5);
  var row2 = quotes.slice(5, 10);

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
                    <span class="stocks-exchange-tag">{hero.exchange}</span>
                  ) : null}
                </div>

                <div class="stocks-title-row">
                  <span class="stocks-hero-ticker">{hero.label}</span>
                  {hero.label !== hero.symbol ? (
                    <span class="stocks-hero-symbol-sub">{hero.symbol}</span>
                  ) : null}
                </div>
                <div class="stocks-hero-name">{hero.name}</div>
              </div>

              <div class="stocks-hero-right">
                <div class="stocks-hero-price">
                  {formatStockValue(hero.price, hero.format)}
                </div>
                <div
                  class={
                    isPositive
                      ? 'stocks-hero-change stocks-up'
                      : 'stocks-hero-change stocks-down'
                  }
                >
                  <span>{formatStockDelta(hero.change, hero.format)}</span>
                  <span class="stocks-hero-pct">
                    ({formatStockPct(hero.changePct)})
                  </span>
                  <span class="stocks-hero-range-tag">
                    {hero.range.toUpperCase()}
                  </span>
                </div>
                <div class="stocks-hero-meta">
                  {hero.dayHigh > 0 && hero.dayLow > 0 ? (
                    <span>
                      Day {formatStockValue(hero.dayLow, hero.format)} –{' '}
                      {formatStockValue(hero.dayHigh, hero.format)}
                    </span>
                  ) : null}
                  {hero.fiftyTwoWeekHigh > 0 && hero.fiftyTwoWeekLow > 0 ? (
                    <span>
                      {hero.dayHigh > 0 ? <span class="hero-meta-sep">·</span> : null}
                      52W {formatStockValue(hero.fiftyTwoWeekLow, hero.format)} –{' '}
                      {formatStockValue(hero.fiftyTwoWeekHigh, hero.format)}
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

        {quotes.length > 0 ? (
          <section class="stocks-grid" aria-label="Stock watchlist">
            <div class="stocks-row">
              {row1.map(function (q) {
                return (
                  <StockCard
                    key={q.symbol}
                    quote={q}
                    isSelected={q.symbol === selectedSymbol}
                    onSelect={handleSelectSymbol}
                  />
                );
              })}
            </div>
            {row2.length > 0 ? (
              <div class="stocks-row stocks-row-second">
                {row2.map(function (q) {
                  return (
                    <StockCard
                      key={q.symbol}
                      quote={q}
                      isSelected={q.symbol === selectedSymbol}
                      onSelect={handleSelectSymbol}
                    />
                  );
                })}
              </div>
            ) : null}
          </section>
        ) : null}
      </div>
    </div>
  );
}
