import { useEffect, useRef, useState } from 'preact/hooks';
import type {
  AuroraStatus,
  CityConfig,
  CityWeather,
  EarthquakeEvent,
  FXQuote,
  ISSOrbit,
  TempUnit,
  TimeFormat,
  TropicalStorm,
  WorldResponse,
} from '../types';
import { WORLD_BORDER_PATH, WORLD_LAND_PATH } from '../data/worldLand';
import {
  MAP_LEFT_LON,
  buildAuroraOvalPaths,
  buildISSTrack,
  buildTerminatorPaths,
  computeGreatCircleArc,
  formatFXInverseHint,
  formatFXRate,
  formatUTCClock,
  getSublunarPoint,
  getSubsolarPoint,
  projectLat,
  projectLonLat,
} from '../utils/astronomy';
import { formatHourOffset, getCityClock } from '../utils/time';
import { formatTemp, formatWind } from '../utils/weather';
import { formatStockPct } from '../utils/stocks';

export var WORLD_STORAGE_KEY = 'glance:lastWorld:v1';

var MAP_W = 1000;
var MAP_H = 500;

interface WorldDashboardProps {
  isActive: boolean;
  preload?: boolean;
  cities: CityConfig[];
  weatherById: { [id: string]: CityWeather };
  nowMs: number;
  units: TempUnit;
  timeFormat: TimeFormat;
  moonPhase: number;
  idleResetSeconds?: number;
  activityTick?: number;
  isRefreshing: boolean;
  onRefresh: () => void;
  onUnauthorized?: () => void;
}

function readCachedWorld(): WorldResponse | null {
  try {
    var raw = window.localStorage.getItem(WORLD_STORAGE_KEY);
    if (!raw) return null;
    var parsed = JSON.parse(raw) as WorldResponse;
    if (parsed && parsed.fx && parsed.fx.length > 0) {
      return parsed;
    }
  } catch (_err) {
    // Ignore storage errors
  }
  return null;
}

function writeCachedWorld(data: WorldResponse): void {
  try {
    window.localStorage.setItem(WORLD_STORAGE_KEY, JSON.stringify(data));
  } catch (_err) {
    // Ignore storage errors
  }
}

function buildMiniSparkPath(values: number[], w: number, h: number): string {
  if (!values || values.length < 2) return '';
  var minV = values[0];
  var maxV = values[0];
  for (var i = 1; i < values.length; i++) {
    if (values[i] < minV) minV = values[i];
    if (values[i] > maxV) maxV = values[i];
  }
  var span = maxV - minV;
  var padY = 2.5;
  var innerH = h - padY * 2;
  var parts: string[] = [];
  for (var j = 0; j < values.length; j++) {
    var x = (j / (values.length - 1)) * w;
    var norm = span > 0 ? (values[j] - minV) / span : 0.5;
    var y = h - padY - norm * innerH;
    parts.push((j === 0 ? 'M ' : 'L ') + x.toFixed(1) + ' ' + y.toFixed(1));
  }
  return parts.join(' ');
}

function buildSmallMoonLitPath(moonPhase: number, r: number): string {
  var waxing = moonPhase < 0.5;
  var k = Math.cos(moonPhase * Math.PI * 2);
  var rx = Math.abs(k) * r;
  var outerSweep = waxing ? 1 : 0;
  if (rx < 0.3) {
    return (
      'M 0 ' +
      String(-r) +
      ' A ' +
      String(r) +
      ' ' +
      String(r) +
      ' 0 0 ' +
      String(outerSweep) +
      ' 0 ' +
      String(r) +
      ' L 0 ' +
      String(-r) +
      ' Z'
    );
  }
  var innerSweep = waxing ? (k > 0 ? 0 : 1) : k > 0 ? 1 : 0;
  return (
    'M 0 ' +
    String(-r) +
    ' A ' +
    String(r) +
    ' ' +
    String(r) +
    ' 0 0 ' +
    String(outerSweep) +
    ' 0 ' +
    String(r) +
    ' A ' +
    rx.toFixed(2) +
    ' ' +
    String(r) +
    ' 0 0 ' +
    String(innerSweep) +
    ' 0 ' +
    String(-r) +
    ' Z'
  );
}

function currencySymbol(code: string): string {
  if (code === 'CNY' || code === 'JPY') return '¥';
  if (code === 'EUR') return '€';
  if (code === 'GBP') return '£';
  if (code === 'USD') return '$';
  if (code === 'KRW') return '₩';
  return code;
}

function formatTimeAgo(timeMs: number, nowMs: number): string {
  var diffMin = Math.max(0, Math.round((nowMs - timeMs) / 60000));
  if (diffMin < 1) return 'Just now';
  if (diffMin < 60) return String(diffMin) + 'm ago';
  var hrs = Math.floor(diffMin / 60);
  var mins = diffMin % 60;
  if (hrs < 24) {
    return mins > 0 ? String(hrs) + 'h ' + String(mins) + 'm ago' : String(hrs) + 'h ago';
  }
  return String(Math.floor(hrs / 24)) + 'd ago';
}

export function WorldDashboard(props: WorldDashboardProps) {
  var _fxState = useState<FXQuote[]>(function () {
    var cached = readCachedWorld();
    return cached && cached.fx ? cached.fx : [];
  });
  var fxQuotes = _fxState[0];
  var setFxQuotes = _fxState[1];

  var _issOrbitState = useState<ISSOrbit | null>(function () {
    var cached = readCachedWorld();
    return cached && cached.iss ? cached.iss : null;
  });
  var issOrbit = _issOrbitState[0];
  var setIssOrbit = _issOrbitState[1];

  var _quakesState = useState<EarthquakeEvent[]>(function () {
    var cached = readCachedWorld();
    return cached && cached.quakes ? cached.quakes : [];
  });
  var quakes = _quakesState[0];
  var setQuakes = _quakesState[1];

  var _auroraState = useState<AuroraStatus | null>(function () {
    var cached = readCachedWorld();
    return cached && cached.aurora ? cached.aurora : null;
  });
  var aurora = _auroraState[0];
  var setAurora = _auroraState[1];

  var _stormsState = useState<TropicalStorm[]>(function () {
    var cached = readCachedWorld();
    return cached && cached.storms ? cached.storms : [];
  });
  var storms = _stormsState[0];
  var setStorms = _stormsState[1];

  var _loadingState = useState<boolean>(false);
  var isLoading = _loadingState[0];
  var setIsLoading = _loadingState[1];

  var _errorState = useState<string | null>(null);
  var loadError = _errorState[0];
  var setLoadError = _errorState[1];

  var _selectedCityState = useState<string | null>(null);
  var selectedCityId = _selectedCityState[0];
  var setSelectedCityId = _selectedCityState[1];

  var _selectedQuakeState = useState<string | null>(null);
  var selectedQuakeId = _selectedQuakeState[0];
  var setSelectedQuakeId = _selectedQuakeState[1];

  var _selectedAuroraState = useState<boolean>(false);
  var selectedAurora = _selectedAuroraState[0];
  var setSelectedAurora = _selectedAuroraState[1];

  var _selectedStormState = useState<string | null>(null);
  var selectedStormId = _selectedStormState[0];
  var setSelectedStormId = _selectedStormState[1];

  var _showArcsState = useState<boolean>(true);
  var showArcs = _showArcsState[0];
  var setShowArcs = _showArcsState[1];

  var _showCelestialState = useState<boolean>(true);
  var showCelestial = _showCelestialState[0];
  var setShowCelestial = _showCelestialState[1];

  var _showISSState = useState<boolean>(true);
  var showISS = _showISSState[0];
  var setShowISS = _showISSState[1];

  var _showQuakesState = useState<boolean>(true);
  var showQuakes = _showQuakesState[0];
  var setShowQuakes = _showQuakesState[1];

  var _showAuroraState = useState<boolean>(true);
  var showAurora = _showAuroraState[0];
  var setShowAurora = _showAuroraState[1];

  var _showStormsState = useState<boolean>(true);
  var showStorms = _showStormsState[0];
  var setShowStorms = _showStormsState[1];

  var _issNowState = useState<number>(function () {
    return Date.now();
  });
  var issNowMs = _issNowState[0];
  var setIssNowMs = _issNowState[1];

  var _wideMapState = useState<boolean>(function () {
    if (typeof window === 'undefined') return false;
    return window.innerWidth / Math.max(1, window.innerHeight - 180) > 2.02;
  });
  var isWideMap = _wideMapState[0];
  var setIsWideMap = _wideMapState[1];

  useEffect(function () {
    function handleResize() {
      setIsWideMap(window.innerWidth / Math.max(1, window.innerHeight - 180) > 2.02);
    }
    window.addEventListener('resize', handleResize);
    window.addEventListener('orientationchange', handleResize);
    return function () {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('orientationchange', handleResize);
    };
  }, []);

  var hasPreloadedRef = useRef<boolean>(false);
  var lastFetchMsRef = useRef<number>(0);
  var pollTimerRef = useRef<number | null>(null);

  function fetchWorld(showSpinner: boolean) {
    if (showSpinner) {
      setIsLoading(true);
    }
    return fetch('/api/world', { cache: 'no-cache', credentials: 'same-origin' })
      .then(function (resp) {
        if (resp.status === 401) {
          if (props.onUnauthorized) props.onUnauthorized();
          return null;
        }
        if (!resp.ok) {
          throw new Error('HTTP ' + String(resp.status));
        }
        return resp.json();
      })
      .then(function (json: WorldResponse | null) {
        if (!json) return json;
        if (json.fx && json.fx.length > 0) {
          lastFetchMsRef.current = Date.now();
          setFxQuotes(json.fx);
        }
        if (json.iss) {
          setIssOrbit(json.iss);
        }
        if (json.quakes) {
          setQuakes(json.quakes);
        }
        if (json.aurora) {
          setAurora(json.aurora);
        }
        if (json.storms) {
          setStorms(json.storms);
        } else {
          setStorms([]);
        }
        if (
          (json.fx && json.fx.length > 0) ||
          json.iss ||
          json.quakes ||
          json.aurora ||
          json.storms
        ) {
          writeCachedWorld(json);
        }
        setLoadError(null);
        setIsLoading(false);
        return json;
      })
      .catch(function (err) {
        setLoadError(err && err.message ? String(err.message) : 'Network error');
        setIsLoading(false);
        return null;
      });
  }

  // Quiet preload while inactive after boot
  useEffect(
    function () {
      if (!props.preload || props.isActive || hasPreloadedRef.current) {
        return;
      }
      hasPreloadedRef.current = true;
      fetchWorld(false);
    },
    [props.preload, props.isActive]
  );

  // Fetch on visit + poll every 5 min while active
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
      function schedulePoll() {
        if (cancelled) return;
        if (pollTimerRef.current !== null) {
          window.clearTimeout(pollTimerRef.current);
        }
        pollTimerRef.current = window.setTimeout(function () {
          fetchWorld(false).then(schedulePoll);
        }, 5 * 60 * 1000);
      }

      if (lastFetchMsRef.current > 0 && Date.now() - lastFetchMsRef.current < 2 * 60 * 1000) {
        schedulePoll();
      } else {
        fetchWorld(fxQuotes.length === 0).then(schedulePoll);
      }

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

  // Smooth 5-second ISS position tick only while World slide is visible and ISS layer is on
  useEffect(
    function () {
      if (!props.isActive || !showISS || !issOrbit) {
        return;
      }
      setIssNowMs(Date.now());
      var id = window.setInterval(function () {
        setIssNowMs(Date.now());
      }, 5000);
      return function () {
        window.clearInterval(id);
      };
    },
    [props.isActive, showISS, issOrbit]
  );

  // Auto-clear selected map inspector after configured idle period
  var idleResetSec =
    typeof props.idleResetSeconds === 'number' && props.idleResetSeconds >= 5
      ? props.idleResetSeconds
      : 60;
  useEffect(
    function () {
      if (
        !selectedCityId &&
        !selectedQuakeId &&
        !selectedAurora &&
        !selectedStormId
      ) {
        return;
      }
      var id = window.setTimeout(function () {
        setSelectedCityId(null);
        setSelectedQuakeId(null);
        setSelectedAurora(false);
        setSelectedStormId(null);
      }, idleResetSec * 1000);
      return function () {
        window.clearTimeout(id);
      };
    },
    [
      selectedCityId,
      selectedQuakeId,
      selectedAurora,
      selectedStormId,
      idleResetSec,
      props.activityTick,
    ]
  );

  // Astronomical & ISS orbital calculations
  var sun = getSubsolarPoint(props.nowMs);
  var moon = getSublunarPoint(props.nowMs);
  var sunPt = projectLonLat(sun.lon, sun.lat, MAP_W, MAP_H);
  var moonPt = projectLonLat(moon.lon, moon.lat, MAP_W, MAP_H);
  var term = buildTerminatorPaths(sun.lat, sun.lon, MAP_W, MAP_H);
  var isMoonFull = Math.abs(props.moonPhase - 0.5) < 0.02;
  var isMoonNew = props.moonPhase < 0.02 || props.moonPhase > 0.98;
  var moonLitPath = buildSmallMoonLitPath(props.moonPhase, 6.2);

  var auroraOval =
    showAurora && aurora
      ? buildAuroraOvalPaths(aurora.kp, sun.lon, MAP_W, MAP_H)
      : null;

  var effectiveIssMs = Math.max(props.nowMs, issNowMs);
  var issTrack =
    showISS && issOrbit ? buildISSTrack(issOrbit, effectiveIssMs, MAP_W, MAP_H) : null;
  var issLabelLeft = issTrack ? issTrack.x > MAP_W - 110 : false;
  var issFootprintClosed = issTrack ? issTrack.footprintSegments.length === 1 : false;

  // Prepare city pins (deduplicate cities within < 18px of Home so Bay Area labels never collide)
  var cities = props.cities || [];
  var homeCity = cities.length > 0 ? cities[0] : null;
  var homeWeather = homeCity ? props.weatherById[homeCity.id] : undefined;
  var homeOffsetSec = homeWeather ? homeWeather.utcOffsetSeconds : 0;
  var homePt = homeCity ? projectLonLat(homeCity.lon, homeCity.lat, MAP_W, MAP_H) : null;

  interface CityPinData {
    city: CityConfig;
    isHome: boolean;
    x: number;
    y: number;
    timeLabel: string;
    tempLabel: string;
    isDay: boolean;
    offsetLabel: string;
    arc: ReturnType<typeof computeGreatCircleArc> | null;
    labelSide: 'left' | 'right';
  }

  var pins: CityPinData[] = [];

  for (var i = 0; i < cities.length; i++) {
    var c = cities[i];
    var isHome = i === 0;
    var pt = projectLonLat(c.lon, c.lat, MAP_W, MAP_H);
    var w = props.weatherById[c.id];
    var clk = getCityClock(props.nowMs, w ? w.utcOffsetSeconds : undefined, props.timeFormat);
    var isDay = w ? w.isDay : clk.hour24 >= 6 && clk.hour24 < 19;

    // Skip pins virtually on top of Home (e.g., San Francisco 1.3px from Sunnyvale)
    if (!isHome && homePt) {
      var dxHome = pt.x - homePt.x;
      var dyHome = pt.y - homePt.y;
      if (Math.sqrt(dxHome * dxHome + dyHome * dyHome) < 18) {
        continue;
      }
    }

    var arc =
      !isHome && homeCity
        ? computeGreatCircleArc(homeCity.lat, homeCity.lon, c.lat, c.lon, MAP_W, MAP_H)
        : null;

    var timeLabel =
      clk.hoursDisplay + ':' + clk.minutesDisplay + (clk.ampm ? ' ' + clk.ampm : '');
    var tempLabel = w ? formatTemp(w.tempC, props.units) : '';
    var offsetLabel =
      !isHome && w && homeWeather
        ? formatHourOffset(w.utcOffsetSeconds, homeOffsetSec)
        : '';

    pins.push({
      city: c,
      isHome: isHome,
      x: pt.x,
      y: pt.y,
      timeLabel: timeLabel,
      tempLabel: tempLabel,
      isDay: isDay,
      offsetLabel: offsetLabel,
      arc: arc,
      labelSide: 'right',
    });
  }

  // Smart horizontal label placement so neighboring pins (e.g. Shanghai & Tokyo) never overlap
  for (var pIdx = 0; pIdx < pins.length; pIdx++) {
    var curPin = pins[pIdx];
    var hasCloseEastNeighbor = false;
    for (var qIdx = 0; qIdx < pins.length; qIdx++) {
      if (pIdx === qIdx) continue;
      var other = pins[qIdx];
      if (
        other.x > curPin.x &&
        other.x - curPin.x < 120 &&
        Math.abs(other.y - curPin.y) < 42
      ) {
        hasCloseEastNeighbor = true;
        break;
      }
    }
    if (hasCloseEastNeighbor || curPin.x > MAP_W - 145) {
      curPin.labelSide = 'left';
    } else {
      curPin.labelSide = 'right';
    }
  }

  var selectedPin: CityPinData | null = null;
  if (selectedCityId) {
    for (var sp = 0; sp < pins.length; sp++) {
      if (pins[sp].city.id === selectedCityId) {
        selectedPin = pins[sp];
        break;
      }
    }
  }

  var selectedQuake: EarthquakeEvent | null = null;
  if (selectedQuakeId && showQuakes) {
    for (var sq = 0; sq < quakes.length; sq++) {
      if (quakes[sq].id === selectedQuakeId) {
        selectedQuake = quakes[sq];
        break;
      }
    }
  }

  var selectedStorm: TropicalStorm | null = null;
  if (selectedStormId && showStorms) {
    for (var ss = 0; ss < storms.length; ss++) {
      if (storms[ss].id === selectedStormId) {
        selectedStorm = storms[ss];
        break;
      }
    }
  }

  // Graticule coordinates (82°N to 58°S)
  var latLines = [-30, 0, 30, 60];
  var lonSteps: number[] = [];
  for (var lg = 0; lg < 12; lg++) {
    lonSteps.push(MAP_LEFT_LON + lg * 30);
  }
  var tropicNorthY = projectLat(23.44, MAP_H);
  var tropicSouthY = projectLat(-23.44, MAP_H);

  var fxCards: FXQuote[] =
    fxQuotes.length > 0
      ? fxQuotes
      : [
          { symbol: 'CNY=X', base: 'USD', quote: 'CNY', label: 'USD / CNY', rate: 0, previousClose: 0, change: 0, changePct: 0, sparkline: [] },
          { symbol: 'JPY=X', base: 'USD', quote: 'JPY', label: 'USD / JPY', rate: 0, previousClose: 0, change: 0, changePct: 0, sparkline: [] },
          { symbol: 'EUR=X', base: 'USD', quote: 'EUR', label: 'USD / EUR', rate: 0, previousClose: 0, change: 0, changePct: 0, sparkline: [] },
        ];

  return (
    <div class="world-slide">
      <div class="world-backdrop" aria-hidden="true" />

      <div class="dashboard-content world-content">
        {/* Top Header */}
        <header class="world-header">
          <div class="world-header-left">
            <h1 class="world-title">World</h1>
            <span class="world-utc-tag">{formatUTCClock(props.nowMs)}</span>
          </div>

          <div class="world-header-center">
            <div class="top-controls world-controls" role="toolbar" aria-label="World map controls">
              <button
                type="button"
                class={
                  showArcs
                    ? 'ctrl-btn ctrl-btn-mode ctrl-btn-selected'
                    : 'ctrl-btn ctrl-btn-mode'
                }
                onClick={function () {
                  setShowArcs(function (v) {
                    return !v;
                  });
                }}
                aria-pressed={showArcs}
                title="Toggle flight routes"
              >
                Flights
              </button>
              <button
                type="button"
                class={
                  showCelestial
                    ? 'ctrl-btn ctrl-btn-mode ctrl-btn-selected'
                    : 'ctrl-btn ctrl-btn-mode'
                }
                onClick={function () {
                  setShowCelestial(function (v) {
                    return !v;
                  });
                }}
                aria-pressed={showCelestial}
                title="Toggle Sun & Moon markers"
              >
                Sun/Moon
              </button>
              <button
                type="button"
                class={
                  showISS
                    ? 'ctrl-btn ctrl-btn-mode ctrl-btn-selected'
                    : 'ctrl-btn ctrl-btn-mode'
                }
                onClick={function () {
                  setShowISS(function (v) {
                    return !v;
                  });
                }}
                aria-pressed={showISS}
                title="Toggle International Space Station & orbit"
              >
                ISS
              </button>
              <button
                type="button"
                class={
                  showQuakes
                    ? 'ctrl-btn ctrl-btn-mode ctrl-btn-selected'
                    : 'ctrl-btn ctrl-btn-mode'
                }
                onClick={function () {
                  setShowQuakes(function (v) {
                    if (v) {
                      setSelectedQuakeId(null);
                    }
                    return !v;
                  });
                }}
                aria-pressed={showQuakes}
                title="Toggle recent M4.5+ earthquakes (24h)"
              >
                Quakes
              </button>
              <button
                type="button"
                class={
                  showAurora
                    ? 'ctrl-btn ctrl-btn-mode ctrl-btn-selected'
                    : 'ctrl-btn ctrl-btn-mode'
                }
                onClick={function () {
                  setShowAurora(function (v) {
                    if (v) {
                      setSelectedAurora(false);
                    }
                    return !v;
                  });
                }}
                aria-pressed={showAurora}
                title="Toggle Aurora Oval & geomagnetic Kp activity"
              >
                Aurora
              </button>
              <button
                type="button"
                class={
                  showStorms
                    ? 'ctrl-btn ctrl-btn-mode ctrl-btn-selected'
                    : 'ctrl-btn ctrl-btn-mode'
                }
                onClick={function () {
                  setShowStorms(function (v) {
                    if (v) {
                      setSelectedStormId(null);
                    }
                    return !v;
                  });
                }}
                aria-pressed={showStorms}
                title="Toggle active tropical cyclones, typhoons, & hurricanes"
              >
                Storms
              </button>
              <button
                type="button"
                class="ctrl-btn ctrl-btn-icon"
                onClick={props.onRefresh}
                disabled={props.isRefreshing}
                title="Hard reload & clear cache"
                aria-label="Hard reload and clear cache"
              >
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2.1"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  class={props.isRefreshing ? 'ctrl-svg ctrl-spinning' : 'ctrl-svg'}
                  aria-hidden="true"
                >
                  <path d="M21 12a9 9 0 1 1-2.64-6.36" />
                  <polyline points="21 3 21 9 15 9" />
                </svg>
              </button>
            </div>
          </div>

          <div class="world-header-right" />
        </header>

        {/* Main Day/Night World Map Card */}
        <section class="world-map-card" aria-label="Live day and night world map">
          {selectedStorm ? (
            <button
              type="button"
              class="world-map-inspector world-storm-pill"
              onClick={function () {
                setSelectedStormId(null);
              }}
              title="Tap to dismiss tropical cyclone details"
            >
              <span class="world-route-cities">{selectedStorm.name}</span>
              <span class="world-storm-meta">
                {selectedStorm.category}
                {selectedStorm.windKmh > 0
                  ? ' · Max winds ' + formatWind(selectedStorm.windKmh, props.units)
                  : ''}
              </span>
            </button>
          ) : selectedAurora && aurora ? (
            <button
              type="button"
              class="world-map-inspector world-aurora-pill"
              onClick={function () {
                setSelectedAurora(false);
              }}
              title="Tap to dismiss aurora activity"
            >
              <span class="world-route-cities">Aurora</span>
              <span class="world-aurora-meta">
                Kp {aurora.kp.toFixed(1)} ({aurora.scale}) · 24h peak Kp{' '}
                {aurora.maxKp24h.toFixed(1)}
              </span>
            </button>
          ) : selectedQuake ? (
            <button
              type="button"
              class="world-map-inspector world-quake-pill"
              onClick={function () {
                setSelectedQuakeId(null);
              }}
              title="Tap to dismiss earthquake details"
            >
              <span class="world-route-cities">
                M{selectedQuake.mag.toFixed(1)}
              </span>
              <span class="world-quake-meta">
                {selectedQuake.place || 'Earthquake'} · {Math.round(selectedQuake.depthKm)} km depth ·{' '}
                {formatTimeAgo(selectedQuake.timeMs, props.nowMs)}
              </span>
            </button>
          ) : selectedPin && selectedPin.arc && homeCity ? (
            <button
              type="button"
              class="world-map-inspector world-route-pill-active"
              onClick={function () {
                setSelectedCityId(null);
              }}
              title="Tap to clear selected route"
            >
              <span class="world-route-cities">
                {homeCity.name} → {selectedPin.city.name}
              </span>
              <span class="world-route-meta">
                {selectedPin.arc.distKm.toLocaleString()} km · {selectedPin.arc.flightLabel}
              </span>
            </button>
          ) : null}

          <svg
            class="world-map-svg"
            viewBox={'0 0 ' + String(MAP_W) + ' ' + String(MAP_H)}
            preserveAspectRatio={isWideMap ? 'xMidYMid slice' : 'xMidYMid meet'}
            onClick={function (e) {
              var tgt = e.target as Element | null;
              if (tgt && tgt.tagName && tgt.tagName.toLowerCase() === 'svg') {
                setSelectedCityId(null);
                setSelectedQuakeId(null);
                setSelectedAurora(false);
                setSelectedStormId(null);
              }
            }}
          >
            <defs>
              {/* Luminous daylight ocean base (darkened cleanly by the night hemisphere veil) */}
              <linearGradient id="world-ocean-day" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stop-color="#194275" />
                <stop offset="50%" stop-color="#225796" />
                <stop offset="100%" stop-color="#173c6b" />
              </linearGradient>

              {/* Soft warm sunlight sheen centered on the live subsolar point */}
              <radialGradient
                id="world-daylight-bloom"
                gradientUnits="userSpaceOnUse"
                cx={sunPt.x.toFixed(1)}
                cy={sunPt.y.toFixed(1)}
                r="340"
              >
                <stop offset="0%" stop-color="#fef08a" stop-opacity="0.22" />
                <stop offset="48%" stop-color="#7dd3fc" stop-opacity="0.12" />
                <stop offset="100%" stop-color="#38bdf8" stop-opacity="0" />
              </radialGradient>

              <radialGradient id="world-sun-halo" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stop-color="#fde047" stop-opacity="0.65" />
                <stop offset="45%" stop-color="#f59e0b" stop-opacity="0.26" />
                <stop offset="100%" stop-color="#f59e0b" stop-opacity="0" />
              </radialGradient>

              <radialGradient id="world-moon-halo" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stop-color="#e2e8f0" stop-opacity="0.42" />
                <stop offset="100%" stop-color="#94a3b8" stop-opacity="0" />
              </radialGradient>

              <linearGradient id="world-twilight-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stop-color="#fb923c" stop-opacity="0.24" />
                <stop offset="50%" stop-color="#f59e0b" stop-opacity="0.3" />
                <stop offset="100%" stop-color="#818cf8" stop-opacity="0.2" />
              </linearGradient>

              <linearGradient id="world-aurora-grad" x1="0" y1="0" x2="0" y2="1">
                <stop
                  offset="0%"
                  stop-color={auroraOval && auroraOval.isStorm ? '#c084fc' : '#34d399'}
                  stop-opacity="0.72"
                />
                <stop offset="55%" stop-color="#34d399" stop-opacity="0.88" />
                <stop offset="100%" stop-color="#10b981" stop-opacity="0.38" />
              </linearGradient>

              <clipPath id="world-map-clip">
                <rect x="0" y="0" width={MAP_W} height={MAP_H} />
              </clipPath>
            </defs>

            <g clip-path="url(#world-map-clip)">
              {/* Sunlit daylight ocean + live solar illumination bloom */}
              <rect x="0" y="0" width={MAP_W} height={MAP_H} fill="url(#world-ocean-day)" />
              <rect x="0" y="0" width={MAP_W} height={MAP_H} fill="url(#world-daylight-bloom)" />

              {/* Subtle graticule lines */}
              <g class="world-graticule" aria-hidden="true">
                {latLines.map(function (lat) {
                  var y = projectLat(lat, MAP_H);
                  return (
                    <line
                      key={'lat-' + String(lat)}
                      x1="0"
                      y1={y.toFixed(1)}
                      x2={String(MAP_W)}
                      y2={y.toFixed(1)}
                      stroke={lat === 0 ? 'rgba(214, 234, 255, 0.24)' : 'rgba(214, 234, 255, 0.1)'}
                      stroke-width={lat === 0 ? '1' : '0.8'}
                      stroke-dasharray={lat === 0 ? '5 5' : undefined}
                    />
                  );
                })}
                {lonSteps.map(function (lon, idx) {
                  var x = (idx / 12) * MAP_W;
                  return (
                    <line
                      key={'lon-' + String(lon)}
                      x1={x.toFixed(1)}
                      y1="0"
                      x2={x.toFixed(1)}
                      y2={String(MAP_H)}
                      stroke="rgba(214, 234, 255, 0.08)"
                      stroke-width="0.8"
                    />
                  );
                })}
                {/* Tropics of Cancer & Capricorn */}
                <line
                  x1="0"
                  y1={tropicNorthY.toFixed(1)}
                  x2={String(MAP_W)}
                  y2={tropicNorthY.toFixed(1)}
                  stroke="rgba(253, 224, 71, 0.14)"
                  stroke-width="0.7"
                  stroke-dasharray="2 5"
                />
                <line
                  x1="0"
                  y1={tropicSouthY.toFixed(1)}
                  x2={String(MAP_W)}
                  y2={tropicSouthY.toFixed(1)}
                  stroke="rgba(253, 224, 71, 0.14)"
                  stroke-width="0.7"
                  stroke-dasharray="2 5"
                />
              </g>

              {/* High-detail Natural Earth 110m landmasses & subtle country borders */}
              <g class="world-land-layer">
                <path
                  d={WORLD_LAND_PATH}
                  fill="rgba(210, 234, 255, 0.46)"
                  stroke="rgba(236, 246, 255, 0.72)"
                  stroke-width="0.75"
                  stroke-linejoin="round"
                />
                <path
                  d={WORLD_BORDER_PATH}
                  fill="none"
                  stroke="rgba(220, 238, 255, 0.26)"
                  stroke-width="0.55"
                  stroke-linejoin="round"
                />
              </g>

              {/* High-contrast twilight ribbon, deep night shadow hemisphere, & golden terminator */}
              <path d={term.twilightPath} fill="url(#world-twilight-fill)" />
              <path d={term.nightPath} fill="rgba(3, 7, 18, 0.8)" />
              <path
                d={term.terminatorLine}
                fill="none"
                stroke="rgba(251, 146, 60, 0.34)"
                stroke-width="6"
                stroke-linecap="round"
              />
              <path
                d={term.terminatorLine}
                fill="none"
                stroke="rgba(253, 224, 71, 0.8)"
                stroke-width="1.6"
                stroke-linecap="round"
              />

              {/* Live Geomagnetic Aurora Ovals (scaled by NOAA SWPC Kp index) */}
              {auroraOval ? (
                <g
                  class="world-aurora-layer"
                  onClick={function () {
                    setSelectedCityId(null);
                    setSelectedQuakeId(null);
                    setSelectedStormId(null);
                    setSelectedAurora(function (v) {
                      return !v;
                    });
                  }}
                >
                  {auroraOval.northOuter ? (
                    <path
                      d={auroraOval.northOuter}
                      fill={auroraOval.isStorm ? '#a855f7' : '#10b981'}
                      opacity={(auroraOval.intensity * 0.28).toFixed(2)}
                    />
                  ) : null}
                  {auroraOval.northCore ? (
                    <path
                      d={auroraOval.northCore}
                      fill="url(#world-aurora-grad)"
                      opacity={(auroraOval.intensity * 0.62).toFixed(2)}
                    />
                  ) : null}
                  {auroraOval.southOuter ? (
                    <path
                      d={auroraOval.southOuter}
                      fill={auroraOval.isStorm ? '#a855f7' : '#10b981'}
                      opacity={(auroraOval.intensity * 0.28).toFixed(2)}
                    />
                  ) : null}
                  {auroraOval.southCore ? (
                    <path
                      d={auroraOval.southCore}
                      fill="url(#world-aurora-grad)"
                      opacity={(auroraOval.intensity * 0.62).toFixed(2)}
                    />
                  ) : null}
                </g>
              ) : null}

              {/* Toggleable Subsolar (Sun) & Sublunar (Moon) markers */}
              {showCelestial ? (
                <g class="world-celestial-layer" aria-hidden="true">
                  <g
                    class="world-celestial"
                    transform={'translate(' + sunPt.x.toFixed(1) + ',' + sunPt.y.toFixed(1) + ')'}
                  >
                    <circle cx="0" cy="0" r="36" fill="url(#world-sun-halo)" />
                    <circle cx="0" cy="0" r="10" fill="rgba(253, 224, 71, 0.22)" />
                    <circle cx="0" cy="0" r="5.2" fill="#fde047" />
                  </g>

                  <g
                    class="world-celestial"
                    transform={'translate(' + moonPt.x.toFixed(1) + ',' + moonPt.y.toFixed(1) + ')'}
                  >
                    <circle cx="0" cy="0" r="22" fill="url(#world-moon-halo)" />
                    <circle cx="0" cy="0" r="6.2" fill="rgba(15, 23, 42, 0.85)" stroke="rgba(226, 232, 240, 0.45)" stroke-width="0.7" />
                    {isMoonFull ? (
                      <circle cx="0" cy="0" r="6.2" fill="#e2e8f0" />
                    ) : isMoonNew ? null : (
                      <path d={moonLitPath} fill="#e2e8f0" />
                    )}
                  </g>
                </g>
              ) : null}

              {/* Active Tropical Cyclones / Typhoons & Hurricanes (NHC + GDACS) */}
              {showStorms && storms.length > 0 ? (
                <g class="world-storms-layer">
                  {storms.map(function (storm) {
                    var sPt = projectLonLat(storm.lon, storm.lat, MAP_W, MAP_H);
                    var isSelS = selectedStormId === storm.id;
                    var isMajor = storm.windKmh >= 178 || storm.alertLevel === 'Red';
                    var isHurr = storm.windKmh >= 119 || storm.alertLevel === 'Orange';
                    var sColor = isMajor ? '#f43f5e' : isHurr ? '#fb923c' : '#38bdf8';
                    var sHalo = isMajor
                      ? 'rgba(244, 63, 94, 0.28)'
                      : isHurr
                        ? 'rgba(251, 146, 60, 0.24)'
                        : 'rgba(56, 189, 248, 0.22)';
                    // Counter-clockwise spiral in Northern Hemisphere, mirrored clockwise in Southern
                    var spinScale = storm.lat >= 0 ? '1,1' : '-1,1';
                    var labelLeft = sPt.x > MAP_W - 115;

                    return (
                      <g
                        key={'storm-' + storm.id}
                        class="world-storm-pin"
                        transform={
                          'translate(' + sPt.x.toFixed(1) + ',' + sPt.y.toFixed(1) + ')'
                        }
                        onClick={function () {
                          setSelectedCityId(null);
                          setSelectedQuakeId(null);
                          setSelectedAurora(false);
                          setSelectedStormId(isSelS ? null : storm.id);
                        }}
                      >
                        <circle cx="0" cy="0" r="18" fill="transparent" />
                        <circle cx="0" cy="0" r={isSelS ? '13' : '10.5'} fill={sHalo} />
                        <g transform={'scale(' + spinScale + ')'}>
                          {/* Spiral cyclone arms + eye */}
                          <path
                            d="M 0 -5.5 C 4.5 -5.5 7.5 -2 6.5 2.5 C 5.8 5.4 3 7.5 -0.8 8.2"
                            fill="none"
                            stroke={sColor}
                            stroke-width="2"
                            stroke-linecap="round"
                          />
                          <path
                            d="M 0 5.5 C -4.5 5.5 -7.5 2 -6.5 -2.5 C -5.8 -5.4 -3 -7.5 0.8 -8.2"
                            fill="none"
                            stroke={sColor}
                            stroke-width="2"
                            stroke-linecap="round"
                          />
                          <circle
                            cx="0"
                            cy="0"
                            r="3"
                            fill="#091326"
                            stroke={sColor}
                            stroke-width="1.6"
                          />
                        </g>
                        <text
                          x={labelLeft ? '-12' : '12'}
                          y="-2"
                          text-anchor={labelLeft ? 'end' : 'start'}
                          class="world-pin-name"
                          fill={isMajor ? '#fda4af' : isHurr ? '#fed7aa' : '#bae6fd'}
                          font-size="11"
                          font-weight="700"
                        >
                          {storm.name}
                        </text>
                        <text
                          x={labelLeft ? '-12' : '12'}
                          y="10"
                          text-anchor={labelLeft ? 'end' : 'start'}
                          class="world-pin-sub"
                          fill="rgba(226, 238, 255, 0.88)"
                          font-size="9.5"
                          font-weight="500"
                        >
                          {storm.category}
                        </text>
                      </g>
                    );
                  })}
                </g>
              ) : null}

              {/* Recent USGS Earthquakes (M4.5+ in last 24h) */}
              {showQuakes && quakes.length > 0 ? (
                <g class="world-quakes-layer">
                  {quakes.map(function (q) {
                    var qPt = projectLonLat(q.lon, q.lat, MAP_W, MAP_H);
                    var isSelQ = selectedQuakeId === q.id;
                    var isMajor = q.mag >= 6.5;
                    var isStrong = q.mag >= 5.5;
                    var color = isMajor ? '#f43f5e' : isStrong ? '#fb923c' : '#fbbf24';
                    var ringFill = isMajor
                      ? 'rgba(244, 63, 94, 0.24)'
                      : isStrong
                        ? 'rgba(251, 146, 60, 0.2)'
                        : 'rgba(251, 191, 36, 0.16)';
                    var coreR = Math.max(2.6, Math.min(6.8, 2.6 + (q.mag - 4.5) * 1.4));
                    var outerR = coreR * (isSelQ ? 2.8 : 2.2);
                    return (
                      <g
                        key={'quake-' + q.id}
                        class="world-quake-pin"
                        transform={
                          'translate(' + qPt.x.toFixed(1) + ',' + qPt.y.toFixed(1) + ')'
                        }
                        onClick={function () {
                          setSelectedCityId(null);
                          setSelectedAurora(false);
                          setSelectedStormId(null);
                          setSelectedQuakeId(isSelQ ? null : q.id);
                        }}
                      >
                        <circle cx="0" cy="0" r="14" fill="transparent" />
                        <circle
                          cx="0"
                          cy="0"
                          r={outerR.toFixed(1)}
                          fill={ringFill}
                          stroke={color}
                          stroke-width={isSelQ ? '1.6' : '0.9'}
                          stroke-opacity={isSelQ ? '0.95' : '0.68'}
                        />
                        {isMajor ? (
                          <circle
                            cx="0"
                            cy="0"
                            r={(outerR + 4.5).toFixed(1)}
                            fill="none"
                            stroke="#f43f5e"
                            stroke-width="0.8"
                            stroke-opacity="0.48"
                            stroke-dasharray="2 2"
                          />
                        ) : null}
                        <circle
                          cx="0"
                          cy="0"
                          r={coreR.toFixed(1)}
                          fill={color}
                          stroke="#091326"
                          stroke-width="0.9"
                        />
                        {q.mag >= 5.8 || isSelQ ? (
                          <text
                            x={qPt.x > MAP_W - 60 ? '-9' : '9'}
                            y="3.5"
                            text-anchor={qPt.x > MAP_W - 60 ? 'end' : 'start'}
                            class="world-pin-sub"
                            fill={isMajor ? '#fda4af' : '#fed7aa'}
                            font-size="9.5"
                            font-weight="700"
                          >
                            M{q.mag.toFixed(1)}
                          </text>
                        ) : null}
                      </g>
                    );
                  })}
                </g>
              ) : null}

              {/* Live International Space Station orbital track, footprint, & marker */}
              {issTrack ? (
                <g class="world-iss-layer">
                  {/* Past orbital trail (-45 min) */}
                  {issTrack.pastSegments.map(function (seg, idx) {
                    return (
                      <path
                        key={'iss-past-' + String(idx)}
                        d={seg}
                        fill="none"
                        stroke="rgba(165, 243, 252, 0.34)"
                        stroke-width="1.35"
                        stroke-dasharray="3 4"
                        stroke-linecap="round"
                      />
                    );
                  })}

                  {/* Future orbital trajectory (+95 min, ~1 full orbit) */}
                  {issTrack.futureSegments.map(function (seg, idx) {
                    return (
                      <g key={'iss-fut-' + String(idx)}>
                        <path
                          d={seg}
                          fill="none"
                          stroke="rgba(34, 211, 238, 0.22)"
                          stroke-width="4"
                          stroke-linecap="round"
                        />
                        <path
                          d={seg}
                          fill="none"
                          stroke="#67e8f9"
                          stroke-width="1.5"
                          stroke-linecap="round"
                          opacity="0.92"
                        />
                      </g>
                    );
                  })}

                  {/* Radio / visual horizon footprint circle */}
                  {issTrack.footprintSegments.map(function (seg, idx) {
                    return (
                      <path
                        key={'iss-foot-' + String(idx)}
                        d={seg}
                        fill={
                          issFootprintClosed
                            ? 'rgba(103, 232, 249, 0.08)'
                            : 'none'
                        }
                        stroke="rgba(103, 232, 249, 0.42)"
                        stroke-width="1"
                        stroke-dasharray="3 3"
                      />
                    );
                  })}

                  {/* ISS Marker */}
                  <g
                    class="world-iss-marker"
                    aria-hidden="true"
                    transform={
                      'translate(' +
                      issTrack.x.toFixed(1) +
                      ',' +
                      issTrack.y.toFixed(1) +
                      ')'
                    }
                  >
                    <circle
                      cx="0"
                      cy="0"
                      r="11"
                      fill="rgba(103, 232, 249, 0.16)"
                    />
                    {/* Miniature Space Station SVG oriented slightly along track */}
                    <g
                      transform={
                        'rotate(' +
                        (issTrack.headingDeg * 0.35).toFixed(1) +
                        ')'
                      }
                    >
                      {/* Main truss */}
                      <line
                        x1="-10"
                        y1="0"
                        x2="10"
                        y2="0"
                        stroke="#e0f2fe"
                        stroke-width="1.8"
                        stroke-linecap="round"
                      />
                      {/* Port & Starboard solar array wings */}
                      <rect
                        x="-9.5"
                        y="-6"
                        width="3"
                        height="12"
                        rx="0.7"
                        fill="#38bdf8"
                        stroke="#091326"
                        stroke-width="0.6"
                      />
                      <rect
                        x="-5.3"
                        y="-5.5"
                        width="2.6"
                        height="11"
                        rx="0.7"
                        fill="#7dd3fc"
                        stroke="#091326"
                        stroke-width="0.6"
                      />
                      <rect
                        x="2.7"
                        y="-5.5"
                        width="2.6"
                        height="11"
                        rx="0.7"
                        fill="#7dd3fc"
                        stroke="#091326"
                        stroke-width="0.6"
                      />
                      <rect
                        x="6.5"
                        y="-6"
                        width="3"
                        height="12"
                        rx="0.7"
                        fill="#38bdf8"
                        stroke="#091326"
                        stroke-width="0.6"
                      />
                      {/* Pressurized core modules */}
                      <rect
                        x="-1.6"
                        y="-3.6"
                        width="3.2"
                        height="7.2"
                        rx="1.2"
                        fill="#ffffff"
                        stroke="#091326"
                        stroke-width="0.7"
                      />
                    </g>
                    <text
                      x={issLabelLeft ? '-14' : '14'}
                      y="4"
                      text-anchor={issLabelLeft ? 'end' : 'start'}
                      class="world-pin-name"
                      fill="#a5f3fc"
                      font-size="11.5"
                      font-weight="700"
                    >
                      ISS
                    </text>
                  </g>
                </g>
              ) : null}

              {/* Great-circle flight arcs from Home to distant cities */}
              {showArcs ? (
                <g class="world-arcs-layer">
                  {pins.map(function (pin) {
                    if (!pin.arc) return null;
                    var isSel = selectedCityId === pin.city.id;
                    var dimmed = Boolean(selectedCityId && !isSel);
                    return (
                      <g
                        key={'arc-' + pin.city.id}
                        class="world-arc-group"
                        onClick={function () {
                          setSelectedQuakeId(null);
                          setSelectedAurora(false);
                          setSelectedStormId(null);
                          setSelectedCityId(isSel ? null : pin.city.id);
                        }}
                      >
                        {pin.arc.segments.map(function (seg, sIdx) {
                          return (
                            <g key={sIdx}>
                              <path
                                d={seg}
                                fill="none"
                                stroke={isSel ? 'rgba(251, 191, 36, 0.42)' : 'rgba(125, 211, 252, 0.2)'}
                                stroke-width={isSel ? '5.5' : '3.5'}
                                stroke-linecap="round"
                                opacity={dimmed ? '0.32' : '1'}
                              />
                              <path
                                d={seg}
                                fill="none"
                                stroke={isSel ? '#fde68a' : '#7dd3fc'}
                                stroke-width={isSel ? '2' : '1.4'}
                                stroke-dasharray={isSel ? undefined : '5 4'}
                                stroke-linecap="round"
                                opacity={dimmed ? '0.35' : '0.92'}
                              />
                            </g>
                          );
                        })}

                        {/* Midpoint flight-time pill when this route is selected */}
                        {isSel ? (
                          <g
                            transform={
                              'translate(' +
                              pin.arc.midX.toFixed(1) +
                              ',' +
                              Math.max(24, pin.arc.midY - 14).toFixed(1) +
                              ')'
                            }
                          >
                            <rect
                              x="-68"
                              y="-11"
                              width="136"
                              height="22"
                              rx="11"
                              fill="rgba(11, 18, 35, 0.88)"
                              stroke="rgba(253, 230, 138, 0.55)"
                              stroke-width="1"
                            />
                            <text
                              x="0"
                              y="3.5"
                              text-anchor="middle"
                              fill="#fef3c7"
                              font-size="10.5"
                              font-weight="600"
                              font-family="-apple-system, BlinkMacSystemFont, Helvetica Neue, sans-serif"
                            >
                              {pin.arc.distKm.toLocaleString()} km · {pin.arc.flightLabel}
                            </text>
                          </g>
                        ) : null}
                      </g>
                    );
                  })}
                </g>
              ) : null}

              {/* Interactive City Pins */}
              <g class="world-pins-layer">
                {pins.map(function (pin) {
                  var isSel = selectedCityId === pin.city.id;
                  var isLeft = pin.labelSide === 'left';
                  var dx = isLeft ? -11 : 11;
                  var anchor = isLeft ? 'end' : 'start';
                  var pinFill = pin.isHome
                    ? '#34d399'
                    : isSel
                      ? '#fde047'
                      : pin.isDay
                        ? '#fbbf24'
                        : '#7dd3fc';
                  var haloFill = pin.isHome
                    ? 'rgba(52, 211, 153, 0.28)'
                    : isSel
                      ? 'rgba(253, 224, 71, 0.34)'
                      : pin.isDay
                        ? 'rgba(251, 191, 36, 0.26)'
                        : 'rgba(125, 211, 252, 0.26)';
                  var subLine =
                    pin.timeLabel +
                    (pin.tempLabel ? ' · ' + pin.tempLabel : '') +
                    (pin.arc && !isSel ? ' · ' + pin.arc.flightLabel : '');

                  return (
                    <g
                      key={'pin-' + pin.city.id}
                      class="world-city-pin"
                      transform={'translate(' + pin.x.toFixed(1) + ',' + pin.y.toFixed(1) + ')'}
                      onClick={function () {
                        setSelectedQuakeId(null);
                        setSelectedAurora(false);
                        setSelectedStormId(null);
                        if (pin.isHome) {
                          setSelectedCityId(null);
                        } else {
                          setSelectedCityId(isSel ? null : pin.city.id);
                        }
                      }}
                    >
                      {/* Generous invisible hit area for effortless iPad tapping */}
                      <circle cx="0" cy="0" r="18" fill="transparent" />
                      <circle cx="0" cy="0" r={isSel || pin.isHome ? '9.5' : '7.5'} fill={haloFill} />
                      <circle
                        cx="0"
                        cy="0"
                        r={isSel || pin.isHome ? '4.4' : '3.7'}
                        fill={pinFill}
                        stroke="#091326"
                        stroke-width="1.3"
                      />

                      <text
                        x={dx}
                        y="-3"
                        text-anchor={anchor}
                        class="world-pin-name"
                        fill="rgba(255, 255, 255, 0.96)"
                        font-size="12.5"
                        font-weight="600"
                      >
                        {pin.city.name}
                      </text>
                      <text
                        x={dx}
                        y="11"
                        text-anchor={anchor}
                        class="world-pin-sub"
                        fill="rgba(203, 222, 248, 0.86)"
                        font-size="10.5"
                        font-weight="500"
                      >
                        {subLine}
                      </text>
                    </g>
                  );
                })}
              </g>
            </g>
          </svg>
        </section>

        {/* Bottom Live FX Rates Strip */}
        <section
          class={isLoading && fxQuotes.length === 0 ? 'world-fx-row world-fx-loading' : 'world-fx-row'}
          aria-label="Live foreign exchange rates"
        >
          {fxCards.map(function (fx) {
            var hasRate = !fx.unavailable && fx.rate > 0;
            var isUp = fx.change >= 0;
            var isFlat = Math.abs(fx.changePct) < 0.005;
            var sparkPath = buildMiniSparkPath(fx.sparkline, 82, 26);
            var sparkColor = isFlat ? '#94a3b8' : isUp ? '#34d399' : '#fb7185';
            var invHint = hasRate ? formatFXInverseHint(fx.rate, fx.base, fx.quote) : '';

            return (
              <div class="world-fx-card" key={fx.symbol}>
                <div class="world-fx-top">
                  <div class="world-fx-pair-wrap">
                    <span class="world-fx-badge">{currencySymbol(fx.quote)}</span>
                    <span class="world-fx-pair">{fx.label}</span>
                  </div>
                  {hasRate ? (
                    <span
                      class={
                        isFlat
                          ? 'stock-pct-badge stock-pct-neutral'
                          : isUp
                            ? 'stock-pct-badge stock-pct-up'
                            : 'stock-pct-badge stock-pct-down'
                      }
                    >
                      {formatStockPct(fx.changePct)}
                    </span>
                  ) : (
                    <span class="stock-pct-badge stock-pct-neutral">
                      {loadError ? 'Offline' : '…'}
                    </span>
                  )}
                </div>

                <div class="world-fx-mid">
                  <span class="world-fx-rate">
                    {hasRate ? formatFXRate(fx.rate, fx.quote) : '—'}
                  </span>
                  {sparkPath ? (
                    <svg
                      width="82"
                      height="26"
                      viewBox="0 0 82 26"
                      class="world-fx-spark"
                      aria-hidden="true"
                    >
                      <path
                        d={sparkPath}
                        fill="none"
                        stroke={sparkColor}
                        stroke-width="1.8"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                      />
                    </svg>
                  ) : null}
                </div>

                <div class="world-fx-sub">
                  {invHint || (loadError ? loadError : 'Loading live rate…')}
                </div>
              </div>
            );
          })}
        </section>
      </div>
    </div>
  );
}
