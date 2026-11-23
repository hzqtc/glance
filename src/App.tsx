import { useEffect, useRef, useState } from 'preact/hooks';
import type {
  CarouselScheduleStep,
  CityConfig,
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
import { computeTargetSky, getSkyThemeMode } from './canvas/skyPalettes';
import { AtmosphereCanvas } from './canvas/AtmosphereCanvas';
import { TopControls } from './components/TopControls';
import { HeroSpotlight } from './components/HeroSpotlight';
import { InsightsBand } from './components/InsightsBand';
import { CityCard } from './components/CityCard';
import { STOCKS_STORAGE_KEY, StocksDashboard } from './components/StocksDashboard';
import { CalendarDashboard } from './components/CalendarDashboard';
import { NEWS_STORAGE_KEY, NewsDashboard } from './components/NewsDashboard';
import { PhotosDashboard } from './components/PhotosDashboard';
import { WORLD_STORAGE_KEY, WorldDashboard } from './components/WorldDashboard';
import { PasscodeGate } from './components/PasscodeGate';
import { RotateCountdown } from './components/RotateCountdown';
import { AmbientScreen } from './components/AmbientScreen';

var WEATHER_STORAGE_KEY = 'glance:lastDashboard:v1';
var ANIM_STORAGE_KEY = 'glance:animEnabled:v1';
var STOCK_METRIC_STORAGE_KEY = 'glance:stockCardMetric:v1';
var ACTIVE_SLIDE_STORAGE_KEY = 'glance:activeSlide:v1';
var UNITS_STORAGE_KEY = 'glance:units:v1';
// Slide order (top to bottom): weather, stocks, calendar, world, news, photos
var NEWS_SLIDE = 4;
var PHOTOS_SLIDE = 5;
var TOTAL_SLIDES = 6;


interface ResolvedRotationStep {
  slide: number;
  seconds: number;
}

var DEFAULT_ROTATION_SCHEDULE: ResolvedRotationStep[] = [
  { slide: PHOTOS_SLIDE, seconds: 60 }, // photos
  { slide: 0, seconds: 15 }, // weather
  { slide: PHOTOS_SLIDE, seconds: 60 }, // photos
  { slide: 1, seconds: 15 }, // stocks
  { slide: PHOTOS_SLIDE, seconds: 60 }, // photos
  { slide: 2, seconds: 15 }, // calendar
  { slide: PHOTOS_SLIDE, seconds: 60 }, // photos
  { slide: 3, seconds: 15 }, // world
  { slide: PHOTOS_SLIDE, seconds: 60 }, // photos
  { slide: NEWS_SLIDE, seconds: 30 }, // news
];

function slideNameToIndex(name: string): number {
  var lower = (name || '').toLowerCase();
  if (lower === 'weather') return 0;
  if (lower === 'stocks' || lower === 'stock') return 1;
  if (lower === 'calendar') return 2;
  if (lower === 'world' || lower === 'map') return 3;
  if (lower === 'news' || lower === 'headlines') return NEWS_SLIDE;
  if (lower === 'photos' || lower === 'photo') return PHOTOS_SLIDE;
  return -1;
}

function resolveRotationSchedule(
  rawSchedule: CarouselScheduleStep[] | undefined,
  fallbackSeconds: number
): ResolvedRotationStep[] {
  if (!rawSchedule || rawSchedule.length === 0) {
    return DEFAULT_ROTATION_SCHEDULE;
  }
  var out: ResolvedRotationStep[] = [];
  for (var i = 0; i < rawSchedule.length; i++) {
    var step = rawSchedule[i];
    if (!step) continue;
    var slideIdx = slideNameToIndex(step.slide);
    if (slideIdx < 0) continue;
    var sec =
      typeof step.seconds === 'number' && step.seconds >= 5
        ? step.seconds
        : fallbackSeconds;
    out.push({ slide: slideIdx, seconds: sec });
  }
  return out.length > 0 ? out : DEFAULT_ROTATION_SCHEDULE;
}

interface DemoOverride {
  weatherKind?: WeatherKind;
  cloudCover?: number;
  windKmh?: number;
  minutesSinceMidnight?: number;
  disableNightQuiet?: boolean;
  forceAmbient?: boolean; // ?demo=ambient shows the night ambient screen any time
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
    if (mode === 'ambient') {
      return { forceAmbient: true };
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

function readStoredUnits(): TempUnit | null {
  try {
    var saved = window.localStorage.getItem(UNITS_STORAGE_KEY);
    if (saved === 'F' || saved === 'C') return saved;
  } catch (_err) {
    // Ignore storage errors
  }
  return null;
}

function writeStoredUnits(unit: TempUnit): void {
  try {
    window.localStorage.setItem(UNITS_STORAGE_KEY, unit);
  } catch (_err) {
    // Ignore storage errors
  }
}

function readStoredActiveSlide(): number {
  try {
    var saved = window.localStorage.getItem(ACTIVE_SLIDE_STORAGE_KEY);
    if (saved !== null) {
      var parsed = parseInt(saved, 10);
      if (!isNaN(parsed) && parsed >= 0 && parsed < TOTAL_SLIDES) {
        return parsed;
      }
    }
  } catch (_err) {
    // Ignore storage errors
  }
  return 0;
}

function writeStoredActiveSlide(slide: number): void {
  try {
    window.localStorage.setItem(ACTIVE_SLIDE_STORAGE_KEY, String(slide));
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

function toHex2(n: number): string {
  var c = Math.max(0, Math.min(255, Math.round(n)));
  var h = c.toString(16);
  return h.length < 2 ? '0' + h : h;
}

function setThemeColorMeta(hex: string): void {
  try {
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta && meta.getAttribute('content') !== hex) {
      meta.setAttribute('content', hex);
    }
    if (document.documentElement && document.documentElement.style.backgroundColor !== hex) {
      document.documentElement.style.backgroundColor = hex;
    }
    if (document.body && document.body.style.backgroundColor !== hex) {
      document.body.style.backgroundColor = hex;
    }
  } catch (_err) {
    // Ignore DOM errors
  }
}

function clearCachedDashboardData(): void {
  try {
    window.localStorage.removeItem(WEATHER_STORAGE_KEY);
    window.localStorage.removeItem(STOCKS_STORAGE_KEY);
    window.localStorage.removeItem(WORLD_STORAGE_KEY);
    window.localStorage.removeItem(NEWS_STORAGE_KEY);
  } catch (_err) {
    // Ignore storage errors
  }
  if ('caches' in window) {
    try {
      window.caches
        .keys()
        .then(function (keys) {
          for (var i = 0; i < keys.length; i++) {
            if (keys[i].indexOf('glance-api-') === 0) {
              window.caches.delete(keys[i]);
            }
          }
        })
        .catch(function () {});
    } catch (_err) {
      // Ignore Cache Storage errors
    }
  }
}

export function App() {
  var _authState = useState<'checking' | 'locked' | 'unlocked'>('checking');
  var authState = _authState[0];
  var setAuthState = _authState[1];

  var _misconfigState = useState<boolean>(false);
  var isMisconfigured = _misconfigState[0];
  var setIsMisconfigured = _misconfigState[1];

  var _authErrState = useState<string | null>(null);
  var authInitError = _authErrState[0];
  var setAuthInitError = _authErrState[1];

  useEffect(function () {
    var cancelled = false;

    fetch('/api/auth', {
      method: 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
    })
      .then(function (resp) {
        if (!resp.ok) {
          throw new Error('HTTP ' + String(resp.status));
        }
        return resp.json();
      })
      .then(function (json: {
        authenticated?: boolean;
        required?: boolean;
        misconfigured?: boolean;
      }) {
        if (cancelled) return;
        if (json && json.authenticated) {
          setIsMisconfigured(false);
          setAuthInitError(null);
          setAuthState('unlocked');
          return;
        }
        clearCachedDashboardData();
        setIsMisconfigured(Boolean(json && json.misconfigured));
        setAuthInitError(null);
        setAuthState('locked');
      })
      .catch(function () {
        if (cancelled) return;
        clearCachedDashboardData();
        setIsMisconfigured(false);
        setAuthInitError('Unable to verify session — enter PIN to retry');
        setAuthState('locked');
      });

    return function () {
      cancelled = true;
    };
  }, []);

  useEffect(
    function () {
      if (authState === 'locked') {
        setThemeColorMeta('#0b1322');
      }
    },
    [authState]
  );

  function handleUnauthorized() {
    clearCachedDashboardData();
    setAuthState('locked');
  }

  function handleUnlocked() {
    setAuthInitError(null);
    setAuthState('unlocked');
  }

  if (authState === 'checking') {
    return <div class="pin-gate pin-gate-checking" aria-busy="true" />;
  }

  if (authState === 'locked') {
    return (
      <PasscodeGate
        misconfigured={isMisconfigured}
        initialError={authInitError}
        onUnlocked={handleUnlocked}
      />
    );
  }

  return <DashboardShell onUnauthorized={handleUnauthorized} />;
}

interface DashboardShellProps {
  onUnauthorized: () => void;
}

function DashboardShell(props: DashboardShellProps) {
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

  var _slideState = useState<number>(function () {
    return readStoredActiveSlide();
  });
  var activeSlide = _slideState[0];
  var setActiveSlide = _slideState[1];

  useEffect(
    function () {
      writeStoredActiveSlide(activeSlide);
    },
    [activeSlide]
  );

  var _selectedState = useState<string | null>(null);
  var selectedCityId = _selectedState[0];
  var setSelectedCityId = _selectedState[1];

  // Explicit °F/°C choice saved per device; null follows config.units
  var _unitOverrideState = useState<TempUnit | null>(function () {
    return readStoredUnits();
  });
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

  var _preloadState = useState<boolean>(false);
  var preloadReady = _preloadState[0];
  var setPreloadReady = _preloadState[1];

  var _vpHeightState = useState<number>(function () {
    return typeof window !== 'undefined' ? Math.round(window.innerHeight) : 768;
  });
  var viewportHeight = _vpHeightState[0];
  var setViewportHeight = _vpHeightState[1];

  useEffect(function () {
    function handleResize() {
      setViewportHeight(Math.round(window.innerHeight));
    }
    window.addEventListener('resize', handleResize);
    window.addEventListener('orientationchange', handleResize);
    return function () {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('orientationchange', handleResize);
    };
  }, []);

  var _pauseBumpState = useState<number>(0);
  var pauseBump = _pauseBumpState[0];
  var setPauseBump = _pauseBumpState[1];

  var _activityTickState = useState<number>(0);
  var activityTick = _activityTickState[0];
  var setActivityTick = _activityTickState[1];

  var _rotatePausedState = useState<boolean>(false);
  var isRotatePaused = _rotatePausedState[0];
  var setIsRotatePaused = _rotatePausedState[1];

  var _rotateTargetState = useState<number>(0);
  var rotateTargetMs = _rotateTargetState[0];
  var setRotateTargetMs = _rotateTargetState[1];

  var rootRef = useRef<HTMLDivElement | null>(null);
  var bootTimeRef = useRef<number>(Date.now());
  var pollTimerRef = useRef<number | null>(null);
  var reloadTriggeredRef = useRef<boolean>(false);
  var deployedVersionRef = useRef<string | null>(null);
  var touchStartRef = useRef<{ x: number; y: number; ignore: boolean } | null>(null);
  var autoRotateRef = useRef<boolean>(true);
  var manualPauseUntilRef = useRef<number>(0);
  // Night ambient mode: 0 = asleep (ambient screen shows during night hours);
  // otherwise the time until which the woken dashboards stay up
  var _ambientWakeState = useState<number>(0);
  var ambientWakeUntil = _ambientWakeState[0];
  var setAmbientWakeUntil = _ambientWakeState[1];
  var ambientWakeUntilRef = useRef<number>(0);
  var ambientVisibleRef = useRef<boolean>(false);
  var ambientResumeMsRef = useRef<number>(60 * 1000);

  var gestureActiveRef = useRef<boolean>(false);
  var gestureStartMsRef = useRef<number>(0);
  var gesturePendingRef = useRef<boolean>(false);
  var gestureFlushTimerRef = useRef<number | null>(null);
  var manualPauseSecRef = useRef<number>(300);
  var lastPauseBumpMsRef = useRef<number>(0);
  var lastActivityTickMsRef = useRef<number>(0);
  var scheduleIdxRef = useRef<number>(0);

  // Entrance transition trigger & quiet background preload of inactive slides after boot settles
  useEffect(function () {
    var readyId = window.setTimeout(function () {
      setIsReady(true);
    }, 60);
    var preloadId = window.setTimeout(function () {
      setPreloadReady(true);
    }, 3000);
    return function () {
      window.clearTimeout(readyId);
      window.clearTimeout(preloadId);
    };
  }, []);

  function pauseAutoRotate() {
    if (!autoRotateRef.current) {
      return;
    }
    var now = Date.now();
    if (manualPauseSecRef.current > 0) {
      var wasPaused = manualPauseUntilRef.current > now;
      manualPauseUntilRef.current = now + manualPauseSecRef.current * 1000;
      if (!wasPaused) {
        setIsRotatePaused(true);
        setRotateTargetMs(0);
      }
      if (!wasPaused || now - lastPauseBumpMsRef.current >= 1000) {
        lastPauseBumpMsRef.current = now;
        setPauseBump(function (n) {
          return n + 1;
        });
      }
    } else {
      manualPauseUntilRef.current = 0;
      setIsRotatePaused(false);
    }
  }

  // While a finger is down, only refresh the pause/idle refs (which the rotation
  // timer reads) and defer the state updates until shortly after release: a
  // dashboard-wide re-render mid-gesture stalls finger-following drags (e.g. the
  // calendar month strip) on the iPad mini 2.
  function recordUserActivity() {
    var now = Date.now();
    // Any activity while the dashboards are woken at night keeps them up
    if (ambientWakeUntilRef.current > now) {
      ambientWakeUntilRef.current = now + ambientResumeMsRef.current;
    }
    // Safety: a gesture whose touchend never arrived stops deferring after 10s
    if (gestureActiveRef.current && now - gestureStartMsRef.current > 10000) {
      gestureActiveRef.current = false;
    }
    if (gestureActiveRef.current) {
      if (autoRotateRef.current && manualPauseSecRef.current > 0) {
        manualPauseUntilRef.current = now + manualPauseSecRef.current * 1000;
      }
      gesturePendingRef.current = true;
      return;
    }
    if (now - lastActivityTickMsRef.current >= 1000) {
      lastActivityTickMsRef.current = now;
      setActivityTick(function (n) {
        return n + 1;
      });
    }
    pauseAutoRotate();
  }

  function handleManualSlideSelect(nextSlide: number) {
    recordUserActivity();
    setActiveSlide(nextSlide);
  }

  // Treat any user interaction on any dashboard (tap, click, swipe, scroll, scrub) as activity (pauses auto-rotate & resets idle timers)
  useEffect(function () {
    var rootEl = rootRef.current;
    if (!rootEl) return;
    var target: HTMLDivElement = rootEl;

    function handleInteraction(e: Event) {
      if (e && e.isTrusted === false) return;
      if (e.type === 'touchstart') {
        gestureActiveRef.current = true;
        gestureStartMsRef.current = Date.now();
        if (gestureFlushTimerRef.current !== null) {
          window.clearTimeout(gestureFlushTimerRef.current);
          gestureFlushTimerRef.current = null;
        }
      }
      recordUserActivity();
    }

    // Apply the deferred activity once the gesture (and its ~300ms snap) is over
    function handleGestureEnd(e: Event) {
      if (e && e.isTrusted === false) return;
      if (e.type === 'touchend' && (e as TouchEvent).touches && (e as TouchEvent).touches.length > 0) {
        return;
      }
      if (gestureFlushTimerRef.current !== null) {
        window.clearTimeout(gestureFlushTimerRef.current);
      }
      gestureFlushTimerRef.current = window.setTimeout(function () {
        gestureFlushTimerRef.current = null;
        gestureActiveRef.current = false;
        if (gesturePendingRef.current) {
          gesturePendingRef.current = false;
          // Re-arm the visible pause state: the ref was already extended mid-gesture
          manualPauseUntilRef.current = 0;
          lastActivityTickMsRef.current = 0;
          recordUserActivity();
        }
      }, 420); // after the ~380ms month/slide transition
    }

    var opts: AddEventListenerOptions = { capture: true, passive: true };
    target.addEventListener('touchstart', handleInteraction, opts);
    target.addEventListener('touchmove', handleInteraction, opts);
    target.addEventListener('touchend', handleGestureEnd, opts);
    target.addEventListener('touchcancel', handleGestureEnd, opts);
    target.addEventListener('mousedown', handleInteraction, opts);
    target.addEventListener('wheel', handleInteraction, opts);
    target.addEventListener('scroll', handleInteraction, opts);
    target.addEventListener('click', handleInteraction, opts);

    return function () {
      target.removeEventListener('touchstart', handleInteraction, true);
      target.removeEventListener('touchmove', handleInteraction, true);
      target.removeEventListener('touchend', handleGestureEnd, true);
      target.removeEventListener('touchcancel', handleGestureEnd, true);
      if (gestureFlushTimerRef.current !== null) {
        window.clearTimeout(gestureFlushTimerRef.current);
      }
      target.removeEventListener('mousedown', handleInteraction, true);
      target.removeEventListener('wheel', handleInteraction, true);
      target.removeEventListener('scroll', handleInteraction, true);
      target.removeEventListener('click', handleInteraction, true);
    };
  }, []);

  // Desktop keyboard navigation & interaction (any key pauses auto-rotate)
  useEffect(function () {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.isTrusted === false) return;
      if (
        e.key !== 'Shift' &&
        e.key !== 'Control' &&
        e.key !== 'Alt' &&
        e.key !== 'Meta'
      ) {
        recordUserActivity();
      }
      if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
        setActiveSlide(function (prev) {
          return prev < TOTAL_SLIDES - 1 ? prev + 1 : prev;
        });
      } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
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
      fetch('/api/weather', { cache: 'no-cache', credentials: 'same-origin' })
        .then(function (resp) {
          if (resp.status === 401) {
            props.onUnauthorized();
            return null;
          }
          if (!resp.ok) {
            throw new Error('HTTP ' + String(resp.status));
          }
          return resp.json();
        })
        .then(function (json: WeatherResponse | null) {
          if (cancelled || !json) return;

          // Zero-touch auto-update in production when a new Vercel deploy lands
          if (import.meta.env.PROD && json.version) {
            if (deployedVersionRef.current === null) {
              deployedVersionRef.current = json.version;
            } else if (deployedVersionRef.current !== json.version) {
              writeCachedWeather(json);
              try {
                window.localStorage.removeItem(STOCKS_STORAGE_KEY);
                window.localStorage.removeItem(WORLD_STORAGE_KEY);
                window.localStorage.removeItem(NEWS_STORAGE_KEY);
              } catch (_err) {
                // Ignore storage errors
              }
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
  var fxPairs =
    data && data.config && data.config.world && data.config.world.fxPairs
      ? data.config.world.fxPairs
      : [];
  var configUnits: TempUnit = data && data.config ? data.config.units : 'F';
  var units: TempUnit = unitOverride || configUnits;
  var timeFormat = data && data.config ? data.config.timeFormat : '12h';
  var nightMode =
    data && data.config && data.config.nightMode
      ? data.config.nightMode
      : { enabled: true, startHour: 23, endHour: 7, dimOpacity: 0.55 };
  var idleResetSec =
    data &&
    data.config &&
    typeof data.config.idleResetSeconds === 'number' &&
    data.config.idleResetSeconds >= 5
      ? data.config.idleResetSeconds
      : 60;
  var defaultStockSymbol =
    data &&
    data.config &&
    data.config.stocks &&
    data.config.stocks.symbols &&
    data.config.stocks.symbols.length > 0
      ? data.config.stocks.symbols[0].symbol
      : 'GOOG';
  var defaultStockRange =
    data && data.config && data.config.stocks && data.config.stocks.defaultRange
      ? data.config.stocks.defaultRange
      : '1d';
  var dailyReloadHour =
    data && data.config && data.config.refresh
      ? data.config.refresh.dailyReloadHour
      : 3;

  var carouselCfg = data && data.config ? data.config.carousel : null;
  var autoRotate = carouselCfg ? carouselCfg.autoRotate : true;
  autoRotateRef.current = autoRotate;
  var rotateIntervalSec =
    carouselCfg && carouselCfg.intervalSeconds >= 5
      ? carouselCfg.intervalSeconds
      : 15;
  var manualPauseSec =
    carouselCfg && carouselCfg.manualPauseSeconds >= 0
      ? carouselCfg.manualPauseSeconds
      : 300;
  manualPauseSecRef.current = manualPauseSec;

  var photoSlideIntervalSec =
    data &&
    data.config &&
    data.config.photos &&
    data.config.photos.slideIntervalSeconds >= 3
      ? data.config.photos.slideIntervalSeconds
      : 15;

  var rotationSchedule = resolveRotationSchedule(
    carouselCfg ? carouselCfg.schedule : undefined,
    rotateIntervalSec
  );
  var scheduleKeyParts: string[] = [];
  for (var sk = 0; sk < rotationSchedule.length; sk++) {
    scheduleKeyParts.push(
      String(rotationSchedule[sk].slide) + ':' + String(rotationSchedule[sk].seconds)
    );
  }
  var rotationScheduleKey = scheduleKeyParts.join(',');
  var rotationScheduleRef = useRef<ResolvedRotationStep[]>(rotationSchedule);
  rotationScheduleRef.current = rotationSchedule;

  // Auto-rotate dashboards along the configured schedule (default: photo 30s -> weather 15s -> photo 30s -> stocks 15s -> photo 30s -> calendar 15s)
  useEffect(
    function () {
      var schedule = rotationScheduleRef.current;
      if (!autoRotate || schedule.length === 0) {
        setIsRotatePaused(false);
        setRotateTargetMs(0);
        return;
      }

      // Keep schedule index aligned with activeSlide (searching forward on manual jumps)
      var curIdx = scheduleIdxRef.current % schedule.length;
      if (curIdx < 0) curIdx = 0;
      var matchedStep = schedule[curIdx].slide === activeSlide;
      if (!matchedStep) {
        for (var offset = 1; offset < schedule.length; offset++) {
          var candIdx = (curIdx + offset) % schedule.length;
          if (schedule[candIdx].slide === activeSlide) {
            curIdx = candIdx;
            matchedStep = true;
            break;
          }
        }
      }
      scheduleIdxRef.current = curIdx;

      var currentStepSeconds = matchedStep
        ? schedule[curIdx].seconds
        : rotateIntervalSec;
      var nextIdx = matchedStep ? (curIdx + 1) % schedule.length : curIdx;
      var timerId: number | null = null;

      function scheduleNext() {
        var now = Date.now();
        var pauseLeft = manualPauseUntilRef.current - now;
        var paused = pauseLeft > 0;
        setIsRotatePaused(paused);
        var delayMs = paused ? pauseLeft : currentStepSeconds * 1000;
        setRotateTargetMs(paused ? 0 : now + delayMs);
        timerId = window.setTimeout(function () {
          // Hold rotation while hidden or behind the night ambient screen
          if (document.hidden || ambientVisibleRef.current) {
            scheduleNext();
            return;
          }
          if (Date.now() < manualPauseUntilRef.current) {
            scheduleNext();
            return;
          }
          setIsRotatePaused(false);
          var latestSchedule = rotationScheduleRef.current;
          var targetIdx = nextIdx % latestSchedule.length;
          scheduleIdxRef.current = targetIdx;
          setActiveSlide(latestSchedule[targetIdx].slide);
        }, delayMs);
      }

      scheduleNext();

      return function () {
        if (timerId !== null) {
          window.clearTimeout(timerId);
        }
      };
    },
    [autoRotate, rotateIntervalSec, rotationScheduleKey, manualPauseSec, activeSlide, pauseBump]
  );

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

  // Auto-return Weather spotlight to Home city after configured idle period when viewing another city
  var homeCityId = homeCity ? homeCity.id : null;
  useEffect(
    function () {
      if (!selectedCityId || !homeCityId || selectedCityId === homeCityId) {
        return;
      }
      var id = window.setTimeout(function () {
        setSelectedCityId(null);
      }, idleResetSec * 1000);
      return function () {
        window.clearTimeout(id);
      };
    },
    [selectedCityId, homeCityId, idleResetSec, activityTick]
  );

  var demo = getDemoOverride();
  var isNightQuiet = Boolean(
    !(demo && demo.disableNightQuiet) &&
      nightMode &&
      nightMode.enabled &&
      isNightQuietHours(homeClock.hour24, nightMode.startHour, nightMode.endHour)
  );

  // Night ambient mode (config "ambient"): during night hours show the calm clock
  // screen unless the dashboards were woken by a tap within resumeAfterSeconds
  // (any activity while awake extends that).
  var ambientCfg = data && data.config ? data.config.ambient : undefined;
  var ambientEnabled = !ambientCfg || ambientCfg.enabled !== false;
  ambientResumeMsRef.current =
    ambientCfg && ambientCfg.resumeAfterSeconds >= 10 ? ambientCfg.resumeAfterSeconds * 1000 : 60 * 1000;
  var ambientVisible = Boolean(
    ((ambientEnabled && isNightQuiet) || (demo && demo.forceAmbient)) && ambientWakeUntil === 0
  );
  ambientVisibleRef.current = ambientVisible;

  function wakeFromAmbient() {
    var until = Date.now() + ambientResumeMsRef.current;
    ambientWakeUntilRef.current = until;
    setAmbientWakeUntil(until);
  }

  // Return to the ambient screen once the woken dashboards go untouched
  useEffect(
    function () {
      if (ambientWakeUntil === 0) return;
      var timerId: number | null = null;
      function check() {
        var left = ambientWakeUntilRef.current - Date.now();
        if (left <= 0) {
          ambientWakeUntilRef.current = 0;
          setAmbientWakeUntil(0);
          return;
        }
        timerId = window.setTimeout(check, left + 50);
      }
      check();
      return function () {
        if (timerId !== null) window.clearTimeout(timerId);
      };
    },
    [ambientWakeUntil]
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

  // Sync iPadOS/Safari <meta name="theme-color"> to the active slide's top sky color
  var currentSky = computeTargetSky(
    canvasMinutes,
    sunriseMin,
    sunsetMin,
    canvasWeatherKind,
    canvasCloudCover
  );
  var topThemeColor =
    activeSlide === 0
      ? '#' +
        toHex2(currentSky.top[0]) +
        toHex2(currentSky.top[1]) +
        toHex2(currentSky.top[2])
      : activeSlide === PHOTOS_SLIDE
        ? '#060911'
        : activeSlide === 3
          ? '#091120'
          : '#0b1322';
  useEffect(
    function () {
      setThemeColorMeta(topThemeColor);
    },
    [topThemeColor]
  );

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
    setUnitOverride(nextUnit);
    writeStoredUnits(nextUnit);
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
      window.localStorage.removeItem(WORLD_STORAGE_KEY);
      window.localStorage.removeItem(NEWS_STORAGE_KEY);
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
      isInsideClass(e.target, 'cal-day-list') ||
      isInsideClass(e.target, 'stock-chart-wrap');
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
    if (Math.abs(dy) < 55 || Math.abs(dy) < Math.abs(dx) * 1.3) {
      return;
    }
    if (dy < 0 && activeSlide < TOTAL_SLIDES - 1) {
      handleManualSlideSelect(activeSlide + 1);
    } else if (dy > 0 && activeSlide > 0) {
      handleManualSlideSelect(activeSlide - 1);
    }
  }

  var rootClass = 'dashboard-root';
  if (isReady) {
    rootClass += ' dashboard-ready';
  }
  if (!animEnabled) {
    rootClass += ' anim-paused';
  }

  var trackOffsetPx = -(activeSlide * viewportHeight);
  var isLightRail = activeSlide === 0 && themeMode === 'day';
  var isMultiCityGrid = cities.length > 4;
  var cityRows: CityConfig[][] = [];
  for (var cr = 0; cr < cities.length; cr += 4) {
    cityRows.push(cities.slice(cr, cr + 4));
  }

  return (
    <div
      ref={rootRef}
      class={rootClass}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      <div
        class="carousel-track"
        style={{
          transform: 'translate3d(0, ' + String(trackOffsetPx) + 'px, 0)',
        }}
      >
        {/* Slide 0: Weather Dashboard */}
        <section
          class={
            'carousel-slide weather-slide theme-' +
            themeMode +
            (isMultiCityGrid ? ' weather-slide-multi' : '')
          }
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
            animated={animEnabled && activeSlide === 0 && !ambientVisible}
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
                  units={units}
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

            {cityRows.length > 0 ? (
              <section
                class={
                  isMultiCityGrid ? 'cities-grid cities-grid-multi' : 'cities-grid'
                }
                aria-label="Cities"
              >
                {cityRows.map(function (rowCities, rowIdx) {
                  var rowClass =
                    cities.length >= 4
                      ? 'cities-row cities-row-compact'
                      : 'cities-row';
                  if (rowIdx > 0) {
                    rowClass += ' cities-row-next';
                  }
                  return (
                    <div class={rowClass} key={'city-row-' + String(rowIdx)}>
                      {rowCities.map(function (city, colIdx) {
                        var globalIdx = rowIdx * 4 + colIdx;
                        var cityWeather = weatherById[city.id];
                        var cityClock = getCityClock(
                          nowMs,
                          cityWeather ? cityWeather.utcOffsetSeconds : undefined,
                          timeFormat
                        );
                        var isSelected = Boolean(
                          activeCity && activeCity.id === city.id
                        );
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
                            isHome={globalIdx === 0}
                            isSelected={isSelected}
                            compact={cities.length >= 4}
                            onSelect={handleSelectCity}
                          />
                        );
                      })}
                    </div>
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
            preload={preloadReady}
            timeFormat={timeFormat}
            cardMetric={stockMetric}
            defaultSymbol={defaultStockSymbol}
            defaultRange={defaultStockRange}
            idleResetSeconds={idleResetSec}
            activityTick={activityTick}
            onUnauthorized={props.onUnauthorized}
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
            preload={preloadReady}
            nowMs={nowMs}
            timeFormat={timeFormat}
            idleResetSeconds={idleResetSec}
            activityTick={activityTick}
            isRefreshing={isRefreshing}
            onRefresh={handleRefresh}
            onUnauthorized={props.onUnauthorized}
          />
        </section>
        {/* Slide 3: World Day/Night Map & FX */}
        <section class="carousel-slide" aria-hidden={activeSlide !== 3}>
          <WorldDashboard
            isActive={activeSlide === 3}
            preload={preloadReady}
            cities={cities}
            fxPairs={fxPairs}
            weatherById={weatherById}
            nowMs={nowMs}
            units={units}
            timeFormat={timeFormat}
            moonPhase={moonPhase}
            idleResetSeconds={idleResetSec}
            activityTick={activityTick}
            isRefreshing={isRefreshing}
            onRefresh={handleRefresh}
            onUnauthorized={props.onUnauthorized}
          />
        </section>
        {/* Slide 4: Headlines (Hacker News, local news, 百度热搜) */}
        <section class="carousel-slide" aria-hidden={activeSlide !== NEWS_SLIDE}>
          <NewsDashboard
            isActive={activeSlide === NEWS_SLIDE}
            preload={preloadReady}
            nowMs={nowMs}
            isRefreshing={isRefreshing}
            onRefresh={handleRefresh}
            onUnauthorized={props.onUnauthorized}
          />
        </section>
        {/* Slide 5: Photos Frame */}
        <section class="carousel-slide" aria-hidden={activeSlide !== PHOTOS_SLIDE}>
          <PhotosDashboard
            isActive={activeSlide === PHOTOS_SLIDE}
            preload={preloadReady}
            slideIntervalSeconds={photoSlideIntervalSec}
            isRefreshing={isRefreshing}
            onRefresh={handleRefresh}
            onUnauthorized={props.onUnauthorized}
          />
        </section>
      </div>

      {/* Vertical side rail dashboard switcher + minimalist auto-rotate countdown pill */}
      <div class="carousel-rail-wrap">
        <nav
          class={
            isLightRail
              ? 'carousel-rail carousel-rail-light'
              : activeSlide === PHOTOS_SLIDE
                ? 'carousel-rail carousel-rail-photos'
                : 'carousel-rail'
          }
          aria-label="Switch dashboard"
        >
        <button
          type="button"
          class={
            activeSlide === 0
              ? isRotatePaused
                ? 'rail-btn rail-btn-active rail-btn-paused'
                : 'rail-btn rail-btn-active'
              : 'rail-btn'
          }
          onClick={function () {
            handleManualSlideSelect(0);
          }}
          title={
            activeSlide === 0 && isRotatePaused
              ? 'Weather (auto-rotate paused)'
              : 'Weather dashboard'
          }
          aria-label="Weather dashboard"
          aria-current={activeSlide === 0 ? 'page' : undefined}
        >
          <svg
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            class="ctrl-svg"
            aria-hidden="true"
          >
            <path d="M12 3v2" />
            <path d="M5.6 5.6l1.4 1.4" />
            <path d="M18.4 5.6l-1.4 1.4" />
            <path d="M8.5 11.5a4 4 0 0 1 7.4-1.5" />
            <path d="M6.5 19h11a3.5 3.5 0 0 0 .5-6.96A5 5 0 0 0 8.2 11a3.5 3.5 0 0 0-1.7 8z" />
          </svg>
        </button>

        <button
          type="button"
          class={
            activeSlide === 1
              ? isRotatePaused
                ? 'rail-btn rail-btn-active rail-btn-paused'
                : 'rail-btn rail-btn-active'
              : 'rail-btn'
          }
          onClick={function () {
            handleManualSlideSelect(1);
          }}
          title={
            activeSlide === 1 && isRotatePaused
              ? 'Stocks (auto-rotate paused)'
              : 'Stocks dashboard'
          }
          aria-label="Stocks dashboard"
          aria-current={activeSlide === 1 ? 'page' : undefined}
        >
          <svg
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2.1"
            stroke-linecap="round"
            stroke-linejoin="round"
            class="ctrl-svg"
            aria-hidden="true"
          >
            <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" />
            <polyline points="16 7 22 7 22 13" />
          </svg>
        </button>

        <button
          type="button"
          class={
            activeSlide === 2
              ? isRotatePaused
                ? 'rail-btn rail-btn-active rail-btn-paused'
                : 'rail-btn rail-btn-active'
              : 'rail-btn'
          }
          onClick={function () {
            handleManualSlideSelect(2);
          }}
          title={
            activeSlide === 2 && isRotatePaused
              ? 'Calendar (auto-rotate paused)'
              : 'Calendar dashboard'
          }
          aria-label="Calendar dashboard"
          aria-current={activeSlide === 2 ? 'page' : undefined}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            class="ctrl-svg"
            aria-hidden="true"
          >
            <rect x="3" y="4" width="18" height="18" rx="3" />
            <line x1="16" y1="2" x2="16" y2="6" />
            <line x1="8" y1="2" x2="8" y2="6" />
            <line x1="3" y1="10" x2="21" y2="10" />
          </svg>
        </button>

        <button
          type="button"
          class={
            activeSlide === 3
              ? isRotatePaused
                ? 'rail-btn rail-btn-active rail-btn-paused'
                : 'rail-btn rail-btn-active'
              : 'rail-btn'
          }
          onClick={function () {
            handleManualSlideSelect(3);
          }}
          title={
            activeSlide === 3 && isRotatePaused
              ? 'World Map (auto-rotate paused)'
              : 'World Map dashboard'
          }
          aria-label="World Map dashboard"
          aria-current={activeSlide === 3 ? 'page' : undefined}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            class="ctrl-svg"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="9.5" />
            <line x1="2.5" y1="12" x2="21.5" y2="12" />
            <path d="M12 2.5a14 14 0 0 1 0 19" />
            <path d="M12 2.5a14 14 0 0 0 0 19" />
          </svg>
        </button>

        <button
          type="button"
          class={
            activeSlide === NEWS_SLIDE
              ? isRotatePaused
                ? 'rail-btn rail-btn-active rail-btn-paused'
                : 'rail-btn rail-btn-active'
              : 'rail-btn'
          }
          onClick={function () {
            handleManualSlideSelect(NEWS_SLIDE);
          }}
          title={
            activeSlide === NEWS_SLIDE && isRotatePaused
              ? 'Headlines (auto-rotate paused)'
              : 'Headlines dashboard'
          }
          aria-label="Headlines dashboard"
          aria-current={activeSlide === NEWS_SLIDE ? 'page' : undefined}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            class="ctrl-svg"
            aria-hidden="true"
          >
            <path d="M4 5.5h13a1 1 0 0 1 1 1V18a2 2 0 0 0 2 2H6a2 2 0 0 1-2-2V5.5z" />
            <path d="M18 9h1.5a.5.5 0 0 1 .5.5V18a2 2 0 0 1-2 2" />
            <path d="M7.5 9h7M7.5 12.5h7M7.5 16h4" />
          </svg>
        </button>

        <button
          type="button"
          class={
            activeSlide === PHOTOS_SLIDE
              ? isRotatePaused
                ? 'rail-btn rail-btn-active rail-btn-paused'
                : 'rail-btn rail-btn-active'
              : 'rail-btn'
          }
          onClick={function () {
            handleManualSlideSelect(PHOTOS_SLIDE);
          }}
          title={
            activeSlide === PHOTOS_SLIDE && isRotatePaused
              ? 'Photos (auto-rotate paused)'
              : 'Photos dashboard'
          }
          aria-label="Photos dashboard"
          aria-current={activeSlide === PHOTOS_SLIDE ? 'page' : undefined}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            class="ctrl-svg"
            aria-hidden="true"
          >
            <rect x="3" y="4" width="18" height="16" rx="2.5" />
            <circle cx="8.5" cy="9.5" r="1.5" />
            <path d="M21 15.5l-5-5L5 20" />
          </svg>
        </button>
        </nav>

        <RotateCountdown
          targetMs={rotateTargetMs}
          visible={autoRotate && !isRotatePaused}
          light={isLightRail}
          photos={activeSlide === PHOTOS_SLIDE}
        />
      </div>

      {ambientVisible ? (
        <AmbientScreen
          clock={homeClock}
          cityName={homeCity ? homeCity.name : ''}
          weather={homeWeather}
          units={units}
          timeFormat={timeFormat}
          onWake={wakeFromAmbient}
        />
      ) : null}

      {/* The ambient screen is already dark, so the dim veil only covers woken dashboards */}
      <div
        class="night-veil"
        style={{ opacity: ambientVisible ? 0 : dimOpacity }}
        aria-hidden="true"
      />
    </div>
  );
}
