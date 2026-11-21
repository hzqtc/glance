import { useEffect, useRef, useState } from 'preact/hooks';
import type {
  CityWeather,
  StockCardMetric,
  TempUnit,
  WeatherKind,
  WeatherResponse,
} from './types';
import {
  getCityClock,
  getMoonPhase,
  isNightQuietHours,
  parseMinutesFromHHMM,
} from './utils/time';
import { describeWMO } from './utils/weather';
import { getSkyThemeMode } from './canvas/skyPalettes';
import { AtmosphereCanvas } from './canvas/AtmosphereCanvas';
import { TopControls } from './components/TopControls';
import { HeroSpotlight } from './components/HeroSpotlight';
import { InsightsBand } from './components/InsightsBand';
import { CityCard } from './components/CityCard';
import { STOCKS_STORAGE_KEY, StocksDashboard } from './components/StocksDashboard';
import { CalendarDashboard } from './components/CalendarDashboard';

var WEATHER_STORAGE_KEY = 'glance:lastDashboard:v1';
var ANIM_STORAGE_KEY = 'glance:animEnabled:v1';
var STOCK_METRIC_STORAGE_KEY = 'glance:stockCardMetric:v1';
var TOTAL_SLIDES = 3;

interface DemoOverride {
  weatherKind?: WeatherKind;
  cloudCover?: number;
  windKmh?: number;
  minutesSinceMidnight?: number;
  disableNightQuiet?: boolean;
}

function getDemoOverride(): DemoOverride | null {
  try {
    var search = window.location.search || '';
    var match = search.match(/[?&]demo=([a-z-]+)/i);
    if (!match) return null;
    var mode = match[1].toLowerCase();
    if (mode === 'rain') {
      return { weatherKind: 'rain', cloudCover: 88, windKmh: 22, disableNightQuiet: true };
    }
    if (mode === 'snow') {
      return { weatherKind: 'snow', cloudCover: 78, windKmh: 16, disableNightQuiet: true };
    }
    if (mode === 'storm') {
      return { weatherKind: 'storm', cloudCover: 96, windKmh: 34, disableNightQuiet: true };
    }
    if (mode === 'fog') {
      return { weatherKind: 'fog', cloudCover: 85, windKmh: 10, disableNightQuiet: true };
    }
    if (mode === 'cloudy') {
      return { weatherKind: 'cloudy', cloudCover: 82, windKmh: 18, disableNightQuiet: true };
    }
    if (mode === 'wind') {
      return { weatherKind: 'partly-cloudy', cloudCover: 45, windKmh: 36, disableNightQuiet: true };
    }
    if (mode === 'day') {
      return {
        weatherKind: 'partly-cloudy',
        cloudCover: 38,
        windKmh: 14,
        minutesSinceMidnight: 13 * 60,
        disableNightQuiet: true,
      };
    }
    if (mode === 'sunset') {
      return {
        weatherKind: 'partly-cloudy',
        cloudCover: 48,
        windKmh: 12,
        minutesSinceMidnight: 16 * 60 + 45,
        disableNightQuiet: true,
      };
    }
    if (mode === 'night') {
      return {
        weatherKind: 'clear',
        cloudCover: 18,
        windKmh: 10,
        minutesSinceMidnight: 22 * 60,
        disableNightQuiet: true,
      };
    }
  } catch (_err) {
    // Ignore URL parse errors
  }
  return null;
}

function readCachedWeather(): WeatherResponse | null {
  try {
    var raw = window.localStorage.getItem(WEATHER_STORAGE_KEY);
    if (!raw) return null;
    var parsed = JSON.parse(raw) as WeatherResponse;
    if (parsed && parsed.config && parsed.config.cities && parsed.config.cities.length > 0) {
      return parsed;
    }
  } catch (_err) {
    // Ignore storage errors in restricted Safari modes
  }
  return null;
}

function writeCachedWeather(data: WeatherResponse): void {
  try {
    window.localStorage.setItem(WEATHER_STORAGE_KEY, JSON.stringify(data));
  } catch (_err) {
    // Ignore quota/storage errors
  }
}

function readStoredAnimEnabled(): boolean {
  try {
    var saved = window.localStorage.getItem(ANIM_STORAGE_KEY);
    if (saved === '0') return false;
    if (saved === '1') return true;
  } catch (_err) {
    // Ignore storage errors
  }
  return true;
}

function writeStoredAnimEnabled(enabled: boolean): void {
  try {
    window.localStorage.setItem(ANIM_STORAGE_KEY, enabled ? '1' : '0');
  } catch (_err) {
    // Ignore storage errors
  }
}

function readStoredStockMetric(): StockCardMetric {
  try {
    var saved = window.localStorage.getItem(STOCK_METRIC_STORAGE_KEY);
    if (saved === 'abs' || saved === 'pct' || saved === 'mcap') {
      return saved;
    }
  } catch (_err) {
    // Ignore storage errors
  }
  return 'pct';
}

function writeStoredStockMetric(metric: StockCardMetric): void {
  try {
    window.localStorage.setItem(STOCK_METRIC_STORAGE_KEY, metric);
  } catch (_err) {
    // Ignore storage errors
  }
}

/** Safari 12-safe ancestor class check so touches inside horizontally scrollable strips don't trigger carousel swipes. */
function isInsideClass(target: EventTarget | null, className: string): boolean {
  var node = target as HTMLElement | null;
  while (node && node !== document.body) {
    if (node.classList && node.classList.contains(className)) {
      return true;
    }
    node = node.parentElement;
  }
  return false;
}

export function App() {
  var _dataState = useState<WeatherResponse | null>(function () {
    return readCachedWeather();
  });
  var data = _dataState[0];
  var setData = _dataState[1];

  var _nowState = useState<number>(function () {
    return Date.now();
  });
  var nowMs = _nowState[0];
  var setNowMs = _nowState[1];

  var _slideState = useState<number>(0);
  var activeSlide = _slideState[0];
  var setActiveSlide = _slideState[1];

  var _selectedState = useState<string | null>(null);
  var selectedCityId = _selectedState[0];
  var setSelectedCityId = _selectedState[1];

  var _unitOverrideState = useState<TempUnit | null>(null);
  var unitOverride = _unitOverrideState[0];
  var setUnitOverride = _unitOverrideState[1];

  var _animState = useState<boolean>(function () {
    return readStoredAnimEnabled();
  });
  var animEnabled = _animState[0];
  var setAnimEnabled = _animState[1];

  var _stockMetricState = useState<StockCardMetric>(function () {
    return readStoredStockMetric();
  });
  var stockMetric = _stockMetricState[0];
  var setStockMetric = _stockMetricState[1];

  var _refreshState = useState<boolean>(false);
  var isRefreshing = _refreshState[0];
  var setIsRefreshing = _refreshState[1];

  var _staleState = useState<boolean>(false);
  var isStale = _staleState[0];
  var setIsStale = _staleState[1];

  var _errorState = useState<string | null>(null);
  var loadError = _errorState[0];
  var setLoadError = _errorState[1];

  var _readyState = useState<boolean>(false);
  var isReady = _readyState[0];
  var setIsReady = _readyState[1];

  var bootTimeRef = useRef<number>(Date.now());
  var pollTimerRef = useRef<number | null>(null);
  var reloadTriggeredRef = useRef<boolean>(false);
  var deployedVersionRef = useRef<string | null>(null);
  var touchStartRef = useRef<{ x: number; y: number; ignore: boolean } | null>(null);

  // Entrance transition trigger
  useEffect(function () {
    var id = window.setTimeout(function () {
      setIsReady(true);
    }, 60);
    return function () {
      window.clearTimeout(id);
    };
  }, []);

  // Desktop keyboard left/right arrow navigation between dashboards
  useEffect(function () {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'ArrowRight') {
        setActiveSlide(function (prev) {
          return prev < TOTAL_SLIDES - 1 ? prev + 1 : prev;
        });
      } else if (e.key === 'ArrowLeft') {
        setActiveSlide(function (prev) {
          return prev > 0 ? prev - 1 : prev;
        });
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return function () {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  // Minute-aligned clock heartbeat (avoids 60x/min full-tree re-renders on iPad mini 2)
  useEffect(function () {
    var timerId: number | null = null;

    function scheduleNextMinute() {
      var now = Date.now();
      setNowMs(now);
      var msUntilNext = 60000 - (now % 60000) + 80;
      timerId = window.setTimeout(scheduleNextMinute, msUntilNext);
    }

    function handleVisibility() {
      if (!document.hidden) {
        if (timerId !== null) {
          window.clearTimeout(timerId);
        }
        scheduleNextMinute();
      }
    }

    var initialDelay = 60000 - (Date.now() % 60000) + 80;
    timerId = window.setTimeout(scheduleNextMinute, initialDelay);
    document.addEventListener('visibilitychange', handleVisibility);

    return function () {
      if (timerId !== null) {
        window.clearTimeout(timerId);
      }
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, []);

  // Poll /api/weather with graceful retry & caching
  useEffect(function () {
    var cancelled = false;

    function scheduleNext(ms: number) {
      if (pollTimerRef.current !== null) {
        window.clearTimeout(pollTimerRef.current);
      }
      pollTimerRef.current = window.setTimeout(fetchWeather, ms);
    }

    function fetchWeather() {
      fetch('/api/weather', { cache: 'no-cache' })
        .then(function (resp) {
          if (!resp.ok) {
            throw new Error('HTTP ' + String(resp.status));
          }
          return resp.json();
        })
        .then(function (json: WeatherResponse) {
          if (cancelled) return;

          // Zero-touch auto-update in production when a new Vercel deploy lands
          if (import.meta.env.PROD && json.version) {
            if (deployedVersionRef.current === null) {
              deployedVersionRef.current = json.version;
            } else if (deployedVersionRef.current !== json.version) {
              writeCachedWeather(json);
              window.location.reload();
              return;
            }
          }

          setData(json);
          setNowMs(Date.now());
          setIsStale(false);
          setLoadError(null);
          writeCachedWeather(json);

          var pollMin =
            json.config && json.config.refresh && json.config.refresh.pollMinutes > 0
              ? json.config.refresh.pollMinutes
              : 10;
          scheduleNext(pollMin * 60 * 1000);
        })
        .catch(function (err) {
          if (cancelled) return;
          setIsStale(true);
          setLoadError(err && err.message ? String(err.message) : 'Network error');
          scheduleNext(60 * 1000);
        });
    }

    fetchWeather();

    return function () {
      cancelled = true;
      if (pollTimerRef.current !== null) {
        window.clearTimeout(pollTimerRef.current);
      }
    };
  }, []);

  var cities = data && data.config ? data.config.cities : [];
  var configUnits: TempUnit = data && data.config ? data.config.units : 'F';
  var units: TempUnit = unitOverride || configUnits;
  var timeFormat = data && data.config ? data.config.timeFormat : '12h';
  var nightMode = data && data.config ? data.config.nightMode : null;
  var trips =
    data && data.config && data.config.widgets && data.config.widgets.trips
      ? data.config.widgets.trips
      : [];
  var dailyReloadHour =
    data && data.config && data.config.refresh
      ? data.config.refresh.dailyReloadHour
      : 3;

  var weatherById: { [id: string]: CityWeather } = {};
  if (data && data.weather) {
    for (var i = 0; i < data.weather.length; i++) {
      weatherById[data.weather[i].cityId] = data.weather[i];
    }
  }

  var homeCity = cities.length > 0 ? cities[0] : null;
  var homeWeather = homeCity ? weatherById[homeCity.id] : undefined;
  var homeClock = getCityClock(
    nowMs,
    homeWeather ? homeWeather.utcOffsetSeconds : undefined,
    timeFormat
  );

  var activeCity = homeCity;
  if (selectedCityId && cities.length > 0) {
    for (var j = 0; j < cities.length; j++) {
      if (cities[j].id === selectedCityId) {
        activeCity = cities[j];
        break;
      }
    }
  }
  var activeWeather = activeCity ? weatherById[activeCity.id] : undefined;
  var activeClock = getCityClock(
    nowMs,
    activeWeather ? activeWeather.utcOffsetSeconds : undefined,
    timeFormat
  );

  var demo = getDemoOverride();
  var isNightQuiet = Boolean(
    !(demo && demo.disableNightQuiet) &&
      nightMode &&
      nightMode.enabled &&
      isNightQuietHours(homeClock.hour24, nightMode.startHour, nightMode.endHour)
  );

  // Daily silent reload for long-term 1 GB RAM Safari 12 stability
  useEffect(
    function () {
      if (reloadTriggeredRef.current) return;
      var uptimeMs = nowMs - bootTimeRef.current;
      if (
        uptimeMs > 2 * 60 * 60 * 1000 &&
        homeClock.hour24 === dailyReloadHour &&
        homeClock.minute === 30
      ) {
        reloadTriggeredRef.current = true;
        window.location.reload();
      }
    },
    [nowMs, homeClock.hour24, homeClock.minute, dailyReloadHour]
  );

  var activeDesc = activeWeather ? describeWMO(activeWeather.weatherCode) : null;
  var sunriseMin = activeWeather
    ? parseMinutesFromHHMM(activeWeather.sunrise, 390)
    : 390;
  var sunsetMin = activeWeather
    ? parseMinutesFromHHMM(activeWeather.sunset, 1110)
    : 1110;

  var canvasMinutes =
    demo && typeof demo.minutesSinceMidnight === 'number'
      ? demo.minutesSinceMidnight
      : activeClock.minutesSinceMidnight;
  var canvasWeatherKind: WeatherKind =
    demo && demo.weatherKind
      ? demo.weatherKind
      : activeDesc
        ? activeDesc.kind
        : 'clear';
  var canvasCloudCover =
    demo && typeof demo.cloudCover === 'number'
      ? demo.cloudCover
      : activeWeather
        ? activeWeather.cloudCover
        : 20;
  var canvasWindKmh =
    demo && typeof demo.windKmh === 'number'
      ? demo.windKmh
      : activeWeather
        ? activeWeather.windKmh
        : 8;

  var dimOpacity = isNightQuiet && nightMode ? nightMode.dimOpacity : 0;
  var themeMode = getSkyThemeMode(canvasMinutes, sunriseMin, sunsetMin);
  var moonPhase = getMoonPhase(nowMs);

  function handleSelectCity(cityId: string) {
    setSelectedCityId(cityId);
  }

  function handleToggleAnim() {
    var next = !animEnabled;
    setAnimEnabled(next);
    writeStoredAnimEnabled(next);
  }

  function handleSelectStockMetric(metric: StockCardMetric) {
    setStockMetric(metric);
    writeStoredStockMetric(metric);
  }

  function handleToggleUnits() {
    var nextUnit: TempUnit = units === 'F' ? 'C' : 'F';
    setUnitOverride(nextUnit === configUnits ? null : nextUnit);
  }

  function handleRefresh() {
    if (isRefreshing) return;
    setIsRefreshing(true);

    var reloaded = false;
    function triggerHardReload() {
      if (reloaded) return;
      reloaded = true;
      try {
        var search = (window.location.search || '')
          .replace(/([?&])_r=\d+(&?)/g, function (_m, p1, p2) {
            return p1 === '?' && p2 ? '?' : p2 ? p1 : '';
          })
          .replace(/\?$/, '');
        var sep = search ? '&' : '?';
        var nextUrl =
          window.location.pathname + search + sep + '_r=' + String(Date.now());
        window.location.replace(nextUrl);
      } catch (_err) {
        window.location.reload();
      }
    }

    try {
      window.localStorage.removeItem(WEATHER_STORAGE_KEY);
      window.localStorage.removeItem(STOCKS_STORAGE_KEY);
    } catch (_err) {
      // Ignore storage errors
    }

    var tasks: Promise<unknown>[] = [];

    if ('serviceWorker' in navigator) {
      try {
        tasks.push(
          navigator.serviceWorker
            .getRegistrations()
            .then(function (regs) {
              return Promise.all(
                regs.map(function (reg) {
                  return reg.unregister();
                })
              );
            })
            .catch(function () {})
        );
      } catch (_err) {
        // Ignore SW errors
      }
    }

    if ('caches' in window) {
      try {
        tasks.push(
          window.caches
            .keys()
            .then(function (keys) {
              return Promise.all(
                keys.map(function (key) {
                  return window.caches.delete(key);
                })
              );
            })
            .catch(function () {})
        );
      } catch (_err) {
        // Ignore Cache Storage errors
      }
    }

    window.setTimeout(triggerHardReload, 1200);
    Promise.all(tasks).then(triggerHardReload, triggerHardReload);
  }

  function handleTouchStart(e: TouchEvent) {
    if (!e.touches || e.touches.length !== 1) return;
    var ignore =
      isInsideClass(e.target, 'hourly-ribbon') ||
      isInsideClass(e.target, 'stock-chart-wrap') ||
      isInsideClass(e.target, 'cal-filter-bar');
    touchStartRef.current = {
      x: e.touches[0].clientX,
      y: e.touches[0].clientY,
      ignore: ignore,
    };
  }

  function handleTouchEnd(e: TouchEvent) {
    var start = touchStartRef.current;
    touchStartRef.current = null;
    if (!start || start.ignore || !e.changedTouches || e.changedTouches.length === 0) {
      return;
    }
    var dx = e.changedTouches[0].clientX - start.x;
    var dy = e.changedTouches[0].clientY - start.y;
    if (Math.abs(dx) < 55 || Math.abs(dx) < Math.abs(dy) * 1.3) {
      return;
    }
    if (dx < 0 && activeSlide < TOTAL_SLIDES - 1) {
      setActiveSlide(activeSlide + 1);
    } else if (dx > 0 && activeSlide > 0) {
      setActiveSlide(activeSlide - 1);
    }
  }

  var rootClass = 'dashboard-root';
  if (isReady) {
    rootClass += ' dashboard-ready';
  }
  if (!animEnabled) {
    rootClass += ' anim-paused';
  }

  var trackOffsetPct = -(activeSlide * (100 / TOTAL_SLIDES));

  return (
    <div
      class={rootClass}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      <div
        class="carousel-track"
        style={{
          transform: 'translate3d(' + trackOffsetPct.toFixed(4) + '%, 0, 0)',
        }}
      >
        {/* Slide 0: Weather Dashboard */}
        <section
          class={'carousel-slide weather-slide theme-' + themeMode}
          aria-hidden={activeSlide !== 0}
        >
          <AtmosphereCanvas
            minutesSinceMidnight={canvasMinutes}
            sunriseMinutes={sunriseMin}
            sunsetMinutes={sunsetMin}
            weatherKind={canvasWeatherKind}
            cloudCover={canvasCloudCover}
            windKmh={canvasWindKmh}
            moonPhase={moonPhase}
            isNightQuiet={isNightQuiet}
            animated={animEnabled && activeSlide === 0}
          />

          <main class="dashboard-content">
            {activeCity ? (
              <div class="active-stage" key={activeCity.id}>
                <HeroSpotlight
                  city={activeCity}
                  weather={activeWeather}
                  clock={activeClock}
                  units={units}
                  timeFormat={timeFormat}
                  isStale={isStale}
                  controls={
                    <TopControls
                      animEnabled={animEnabled}
                      units={units}
                      isRefreshing={isRefreshing}
                      onToggleAnim={handleToggleAnim}
                      onToggleUnits={handleToggleUnits}
                      onRefresh={handleRefresh}
                    />
                  }
                />
                <InsightsBand
                  weather={activeWeather}
                  clock={activeClock}
                  units={units}
                  timeFormat={timeFormat}
                  trips={trips}
                />
              </div>
            ) : (
              <div class="boot-state">
                <div class="boot-title">Glance</div>
                <div class="boot-sub">
                  {loadError
                    ? 'Waiting for connection (' + loadError + ')…'
                    : 'Loading atmospheric data…'}
                </div>
              </div>
            )}

            {cities.length > 0 ? (
              <section
                class={
                  cities.length >= 4 ? 'cities-row cities-row-compact' : 'cities-row'
                }
                aria-label="Cities"
              >
                {cities.map(function (city, idx) {
                  var cityWeather = weatherById[city.id];
                  var cityClock = getCityClock(
                    nowMs,
                    cityWeather ? cityWeather.utcOffsetSeconds : undefined,
                    timeFormat
                  );
                  var isSelected = Boolean(activeCity && activeCity.id === city.id);
                  return (
                    <CityCard
                      key={city.id}
                      city={city}
                      weather={cityWeather}
                      clock={cityClock}
                      homeDaySerial={homeClock.daySerial}
                      homeOffsetSeconds={
                        homeWeather ? homeWeather.utcOffsetSeconds : 0
                      }
                      units={units}
                      isHome={idx === 0}
                      isSelected={isSelected}
                      compact={cities.length >= 4}
                      onSelect={handleSelectCity}
                    />
                  );
                })}
              </section>
            ) : null}
          </main>
        </section>

        {/* Slide 1: Stocks Dashboard */}
        <section class="carousel-slide" aria-hidden={activeSlide !== 1}>
          <StocksDashboard
            isActive={activeSlide === 1}
            timeFormat={timeFormat}
            cardMetric={stockMetric}
            controls={
              <TopControls
                animEnabled={animEnabled}
                units={units}
                isRefreshing={isRefreshing}
                showAnim={false}
                showUnits={false}
                stockMetric={stockMetric}
                onSelectStockMetric={handleSelectStockMetric}
                onToggleAnim={handleToggleAnim}
                onToggleUnits={handleToggleUnits}
                onRefresh={handleRefresh}
              />
            }
          />
        </section>
        {/* Slide 2: Calendar Dashboard */}
        <section class="carousel-slide" aria-hidden={activeSlide !== 2}>
          <CalendarDashboard
            isActive={activeSlide === 2}
            nowMs={nowMs}
            timeFormat={timeFormat}
            controls={
              <TopControls
                animEnabled={animEnabled}
                units={units}
                isRefreshing={isRefreshing}
                showAnim={false}
                showUnits={false}
                onToggleAnim={handleToggleAnim}
                onToggleUnits={handleToggleUnits}
                onRefresh={handleRefresh}
              />
            }
          />
        </section>
      </div>

      {/* Subtle carousel pagination dots (tappable on touch & Mac) */}
      <nav class="carousel-dots" aria-label="Switch dashboard">
        <button
          type="button"
          class={activeSlide === 0 ? 'carousel-dot carousel-dot-active' : 'carousel-dot'}
          onClick={function () {
            setActiveSlide(0);
          }}
          aria-label="Weather dashboard"
          aria-current={activeSlide === 0 ? 'page' : undefined}
        />
        <button
          type="button"
          class={activeSlide === 1 ? 'carousel-dot carousel-dot-active' : 'carousel-dot'}
          onClick={function () {
            setActiveSlide(1);
          }}
          aria-label="Stocks dashboard"
          aria-current={activeSlide === 1 ? 'page' : undefined}
        />
        <button
          type="button"
          class={activeSlide === 2 ? 'carousel-dot carousel-dot-active' : 'carousel-dot'}
          onClick={function () {
            setActiveSlide(2);
          }}
          aria-label="Calendar dashboard"
          aria-current={activeSlide === 2 ? 'page' : undefined}
        />
      </nav>

      <div
        class="night-veil"
        style={{ opacity: dimOpacity }}
        aria-hidden="true"
      />
    </div>
  );
}
