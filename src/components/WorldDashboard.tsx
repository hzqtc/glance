import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type {
  AuroraStatus,
  CityConfig,
  CityWeather,
  EarthquakeEvent,
  FXPairConfig,
  FXQuote,
  ISSOrbit,
  TempUnit,
  TimeFormat,
  TropicalStorm,
  WorldResponse,
} from '../types';
import { WORLD_BORDER_PATH, WORLD_LAND_PATH } from '../data/worldLand';
import {
  MAP_CENTER_LON,
  MAP_LEFT_LON,
  buildAuroraOvalPaths,
  buildISSTrack,
  buildMoonLitPath,
  buildTerminatorPaths,
  computeGreatCircleArc,
  formatFXInverseHint,
  formatFXRate,
  formatUTCClock,
  getMapLeftLon,
  getSublunarPoint,
  getSubsolarPoint,
  projectLat,
  projectLonLat,
} from '../utils/astronomy';
import { formatTimeAgo, getCityClock } from '../utils/time';
import { formatTemp, formatWind } from '../utils/weather';
import { formatStockPct, getCurrencySymbol } from '../utils/stocks';
import { readStorage, readStorageJSON, writeStorage, writeStorageJSON } from '../utils/storage';

export var WORLD_STORAGE_KEY = 'glance:lastWorld:v1';
var WORLD_HOME_LON_KEY = 'glance:homeLon:v1';
var WORLD_LAYERS_KEY = 'glance:worldLayers:v1';

interface WorldLayerPrefs {
  arcs: boolean;
  celestial: boolean;
  iss: boolean;
  quakes: boolean;
  aurora: boolean;
  storms: boolean;
}

// Map layer toggles saved per device; any missing or invalid field defaults to visible.
function readStoredWorldLayers(): WorldLayerPrefs {
  var prefs: WorldLayerPrefs = {
    arcs: true,
    celestial: true,
    iss: true,
    quakes: true,
    aurora: true,
    storms: true,
  };
  var parsed = readStorageJSON<Partial<WorldLayerPrefs>>(WORLD_LAYERS_KEY);
  if (parsed && typeof parsed === 'object') {
    var keys: (keyof WorldLayerPrefs)[] = ['arcs', 'celestial', 'iss', 'quakes', 'aurora', 'storms'];
    for (var i = 0; i < keys.length; i++) {
      var val = parsed[keys[i]];
      if (typeof val === 'boolean') prefs[keys[i]] = val;
    }
  }
  return prefs;
}

function writeStoredWorldLayers(prefs: WorldLayerPrefs): void {
  writeStorageJSON(WORLD_LAYERS_KEY, prefs);
}

var MAP_W = 1000;
var MAP_H = 500;

function readStoredHomeLon(): number {
  var raw = readStorage(WORLD_HOME_LON_KEY);
  if (raw !== null) {
    var parsed = parseFloat(raw);
    if (isFinite(parsed) && parsed >= -180 && parsed <= 180) {
      return parsed;
    }
  }
  return MAP_CENTER_LON;
}

function writeStoredHomeLon(lon: number): void {
  writeStorage(WORLD_HOME_LON_KEY, String(lon));
}

interface WorldDashboardProps {
  isActive: boolean;
  preload?: boolean;
  cities: CityConfig[];
  fxPairs: FXPairConfig[];
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
  var parsed = readStorageJSON<WorldResponse>(WORLD_STORAGE_KEY);
  if (parsed && parsed.fx && parsed.fx.length > 0) {
    return parsed;
  }
  return null;
}

function writeCachedWorld(data: WorldResponse): void {
  writeStorageJSON(WORLD_STORAGE_KEY, data);
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

export function WorldDashboard(props: WorldDashboardProps) {
  var initialCacheRef = useRef<WorldResponse | null | undefined>(undefined);
  if (initialCacheRef.current === undefined) {
    initialCacheRef.current = readCachedWorld();
  }
  var initialCache = initialCacheRef.current;

  var _fxState = useState<FXQuote[]>(function () {
    return initialCache && initialCache.fx ? initialCache.fx : [];
  });
  var fxQuotes = _fxState[0];
  var setFxQuotes = _fxState[1];

  var _issOrbitState = useState<ISSOrbit | null>(function () {
    return initialCache && initialCache.iss ? initialCache.iss : null;
  });
  var issOrbit = _issOrbitState[0];
  var setIssOrbit = _issOrbitState[1];

  var _quakesState = useState<EarthquakeEvent[]>(function () {
    return initialCache && initialCache.quakes ? initialCache.quakes : [];
  });
  var quakes = _quakesState[0];
  var setQuakes = _quakesState[1];

  var _auroraState = useState<AuroraStatus | null>(function () {
    return initialCache && initialCache.aurora ? initialCache.aurora : null;
  });
  var aurora = _auroraState[0];
  var setAurora = _auroraState[1];

  var _stormsState = useState<TropicalStorm[]>(function () {
    return initialCache && initialCache.storms ? initialCache.storms : [];
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

  var _selectedISSState = useState<boolean>(false);
  var selectedISS = _selectedISSState[0];
  var setSelectedISS = _selectedISSState[1];

  var _selectedQuakeState = useState<string | null>(null);
  var selectedQuakeId = _selectedQuakeState[0];
  var setSelectedQuakeId = _selectedQuakeState[1];

  var _selectedAuroraState = useState<{ x: number; y: number } | null>(null);
  var selectedAuroraPt = _selectedAuroraState[0];
  var setSelectedAuroraPt = _selectedAuroraState[1];

  var _selectedStormState = useState<string | null>(null);
  var selectedStormId = _selectedStormState[0];
  var setSelectedStormId = _selectedStormState[1];

  var _layersState = useState<WorldLayerPrefs>(readStoredWorldLayers);
  var layers = _layersState[0];
  var setLayers = _layersState[1];
  var showArcs = layers.arcs;
  var showCelestial = layers.celestial;
  var showISS = layers.iss;
  var showQuakes = layers.quakes;
  var showAurora = layers.aurora;
  var showStorms = layers.storms;

  function toggleLayer(key: keyof WorldLayerPrefs) {
    setLayers(function (prev) {
      var nextVal = !prev[key];
      if (!nextVal) {
        if (key === 'iss') setSelectedISS(false);
        else if (key === 'quakes') setSelectedQuakeId(null);
        else if (key === 'aurora') setSelectedAuroraPt(null);
        else if (key === 'storms') setSelectedStormId(null);
      }
      var next: WorldLayerPrefs = {
        arcs: prev.arcs,
        celestial: prev.celestial,
        iss: prev.iss,
        quakes: prev.quakes,
        aurora: prev.aurora,
        storms: prev.storms,
      };
      next[key] = nextVal;
      writeStoredWorldLayers(next);
      return next;
    });
  }

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
        !selectedISS &&
        !selectedQuakeId &&
        !selectedAuroraPt &&
        !selectedStormId
      ) {
        return;
      }
      var id = window.setTimeout(function () {
        setSelectedCityId(null);
        setSelectedISS(false);
        setSelectedQuakeId(null);
        setSelectedAuroraPt(null);
        setSelectedStormId(null);
      }, idleResetSec * 1000);
      return function () {
        window.clearTimeout(id);
      };
    },
    [
      selectedCityId,
      selectedISS,
      selectedQuakeId,
      selectedAuroraPt,
      selectedStormId,
      idleResetSec,
      props.activityTick,
    ]
  );

  // Center the map horizontally on the Home city's longitude from the very first frame
  var cities = props.cities;
  var homeCity = cities.length > 0 ? cities[0] : null;
  var homeLon = homeCity ? homeCity.lon : null;
  var fallbackHomeLonRef = useRef<number | null>(null);
  if (fallbackHomeLonRef.current === null) {
    fallbackHomeLonRef.current = readStoredHomeLon();
  }
  useEffect(
    function () {
      if (homeLon !== null && fallbackHomeLonRef.current !== homeLon) {
        fallbackHomeLonRef.current = homeLon;
        writeStoredHomeLon(homeLon);
      }
    },
    [homeLon]
  );
  var mapCenterLon = homeLon !== null ? homeLon : fallbackHomeLonRef.current;

  // Astronomical calculations (recompute only when nowMs or map center changes — not on 5s ISS ticks)
  var celestial = useMemo(
    function () {
      var sunPos = getSubsolarPoint(props.nowMs);
      var moonPos = getSublunarPoint(props.nowMs);
      return {
        sun: sunPos,
        sunPt: projectLonLat(sunPos.lon, sunPos.lat, MAP_W, MAP_H, mapCenterLon),
        moonPt: projectLonLat(moonPos.lon, moonPos.lat, MAP_W, MAP_H, mapCenterLon),
        term: buildTerminatorPaths(sunPos.lat, sunPos.lon, MAP_W, MAP_H, mapCenterLon),
      };
    },
    [props.nowMs, mapCenterLon]
  );
  var sun = celestial.sun;
  var sunPt = celestial.sunPt;
  var moonPt = celestial.moonPt;
  var term = celestial.term;
  var isMoonFull = Math.abs(props.moonPhase - 0.5) < 0.02;
  var isMoonNew = props.moonPhase < 0.02 || props.moonPhase > 0.98;
  var moonLitPath = useMemo(
    function () {
      return buildMoonLitPath(props.moonPhase, 6.2);
    },
    [props.moonPhase]
  );

  var auroraOval = useMemo(
    function () {
      return showAurora && aurora
        ? buildAuroraOvalPaths(aurora.kp, sun.lon, MAP_W, MAP_H, mapCenterLon)
        : null;
    },
    [showAurora, aurora, sun.lon, mapCenterLon]
  );

  var effectiveIssMs = Math.max(props.nowMs, issNowMs);
  var issTrack = useMemo(
    function () {
      return props.isActive && showISS && issOrbit
        ? buildISSTrack(issOrbit, effectiveIssMs, MAP_W, MAP_H, mapCenterLon)
        : null;
    },
    [props.isActive, showISS, issOrbit, effectiveIssMs, mapCenterLon]
  );
  var issLabelLeft = issTrack ? issTrack.x > MAP_W - 110 : false;
  var issFootprintClosed = issTrack ? issTrack.footprintSegments.length === 1 : false;

  // Static city pin positions, great-circle arcs, and collision-free label sides (recomputed only when cities/center change)
  var staticPins = useMemo(
    function () {
      var home = cities.length > 0 ? cities[0] : null;
      var homePt = home
        ? projectLonLat(home.lon, home.lat, MAP_W, MAP_H, mapCenterLon)
        : null;
      var out: Array<{
        city: CityConfig;
        isHome: boolean;
        x: number;
        y: number;
        arc: ReturnType<typeof computeGreatCircleArc> | null;
        labelSide: 'left' | 'right';
      }> = [];

      for (var i = 0; i < cities.length; i++) {
        var c = cities[i];
        var isHome = i === 0;
        var pt = projectLonLat(c.lon, c.lat, MAP_W, MAP_H, mapCenterLon);

        // Skip pins virtually on top of Home (e.g., a neighbouring city ~1px away)
        if (!isHome && homePt) {
          var dxHome = pt.x - homePt.x;
          var dyHome = pt.y - homePt.y;
          if (Math.sqrt(dxHome * dxHome + dyHome * dyHome) < 18) {
            continue;
          }
        }

        var arc =
          !isHome && home
            ? computeGreatCircleArc(
                home.lat,
                home.lon,
                c.lat,
                c.lon,
                MAP_W,
                MAP_H,
                mapCenterLon
              )
            : null;

        out.push({
          city: c,
          isHome: isHome,
          x: pt.x,
          y: pt.y,
          arc: arc,
          labelSide: 'right',
        });
      }

      // Smart horizontal label placement so neighboring pins (e.g. Shanghai & Tokyo) never overlap
      for (var pIdx = 0; pIdx < out.length; pIdx++) {
        var curPin = out[pIdx];
        var hasCloseEastNeighbor = false;
        for (var qIdx = 0; qIdx < out.length; qIdx++) {
          if (pIdx === qIdx) continue;
          var other = out[qIdx];
          if (
            other.x > curPin.x &&
            other.x - curPin.x < 120 &&
            Math.abs(other.y - curPin.y) < 42
          ) {
            hasCloseEastNeighbor = true;
            break;
          }
        }
        curPin.labelSide =
          hasCloseEastNeighbor || curPin.x > MAP_W - 145 ? 'left' : 'right';
      }

      return out;
    },
    [cities, mapCenterLon]
  );

  interface CityPinData {
    city: CityConfig;
    isHome: boolean;
    x: number;
    y: number;
    timeLabel: string;
    tempLabel: string;
    isDay: boolean;
    arc: ReturnType<typeof computeGreatCircleArc> | null;
    labelSide: 'left' | 'right';
  }

  var pins: CityPinData[] = [];
  for (var i = 0; i < staticPins.length; i++) {
    var spBase = staticPins[i];
    var w = props.weatherById[spBase.city.id];
    var clk = getCityClock(props.nowMs, w ? w.utcOffsetSeconds : undefined, props.timeFormat);
    var isDay = w ? w.isDay : clk.hour24 >= 6 && clk.hour24 < 19;
    var timeLabel =
      clk.hoursDisplay + ':' + clk.minutesDisplay + (clk.ampm ? ' ' + clk.ampm : '');
    var tempLabel = w ? formatTemp(w.tempC, props.units) : '';
    pins.push({
      city: spBase.city,
      isHome: spBase.isHome,
      x: spBase.x,
      y: spBase.y,
      timeLabel: timeLabel,
      tempLabel: tempLabel,
      isDay: isDay,
      arc: spBase.arc,
      labelSide: spBase.labelSide,
    });
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

  function clearAllSelections() {
    setSelectedCityId(null);
    setSelectedISS(false);
    setSelectedQuakeId(null);
    setSelectedAuroraPt(null);
    setSelectedStormId(null);
  }

  interface MapPopoverData {
    x: number;
    y: number;
    text: string;
    stroke: string;
    textColor: string;
  }

  var activePopover: MapPopoverData | null = null;
  if (selectedISS && issTrack) {
    activePopover = {
      x: issTrack.x,
      y: issTrack.y,
      text:
        'ISS · ' +
        String(Math.round(issTrack.current.altKm)) +
        ' km · ' +
        Math.round(issTrack.current.speedKmh).toLocaleString() +
        ' km/h · ' +
        (issTrack.current.sunlit ? 'Sunlit' : 'Shadow'),
      stroke: 'rgba(232, 121, 249, 0.65)',
      textColor: '#fae8ff',
    };
  } else if (selectedStorm) {
    var selStormPt = projectLonLat(
      selectedStorm.lon,
      selectedStorm.lat,
      MAP_W,
      MAP_H,
      mapCenterLon
    );
    activePopover = {
      x: selStormPt.x,
      y: selStormPt.y,
      text:
        selectedStorm.name +
        ' · ' +
        selectedStorm.category +
        (selectedStorm.windKmh > 0
          ? ' · ' + formatWind(selectedStorm.windKmh, props.units)
          : ''),
      stroke: 'rgba(244, 63, 94, 0.62)',
      textColor: '#ffe4e6',
    };
  } else if (selectedAuroraPt && aurora && showAurora) {
    activePopover = {
      x: selectedAuroraPt.x,
      y: selectedAuroraPt.y,
      text:
        'Aurora · Kp ' +
        aurora.kp.toFixed(1) +
        ' (' +
        aurora.scale +
        ') · 24h peak ' +
        aurora.maxKp24h.toFixed(1),
      stroke: 'rgba(52, 211, 153, 0.62)',
      textColor: '#d1fae5',
    };
  } else if (selectedQuake) {
    var selQuakePt = projectLonLat(
      selectedQuake.lon,
      selectedQuake.lat,
      MAP_W,
      MAP_H,
      mapCenterLon
    );
    var placeStr = selectedQuake.place || 'Earthquake';
    if (placeStr.length > 34) {
      placeStr = placeStr.slice(0, 33) + '…';
    }
    activePopover = {
      x: selQuakePt.x,
      y: selQuakePt.y,
      text:
        'M' +
        selectedQuake.mag.toFixed(1) +
        ' · ' +
        placeStr +
        ' · ' +
        String(Math.round(selectedQuake.depthKm)) +
        ' km · ' +
        formatTimeAgo(selectedQuake.timeMs, props.nowMs, true),
      stroke: 'rgba(251, 146, 60, 0.62)',
      textColor: '#ffedd5',
    };
  } else if (selectedPin && selectedPin.arc && showArcs) {
    activePopover = {
      x: selectedPin.arc.midX,
      y: selectedPin.arc.midY,
      text:
        selectedPin.arc.distKm.toLocaleString() +
        ' km · ' +
        selectedPin.arc.flightLabel,
      stroke: 'rgba(253, 230, 138, 0.58)',
      textColor: '#fef3c7',
    };
  }

  // Static graticule + Natural Earth 110m landmass tiles (rebuilt only if mapCenterLon changes)
  var staticMapLayers = useMemo(
    function () {
      var mapLeftLon = getMapLeftLon(mapCenterLon);
      var landShiftX =
        ((((MAP_LEFT_LON - mapLeftLon) % 360) + 360) % 360 / 360) * MAP_W;
      var landTileOffsets = [landShiftX - MAP_W, landShiftX];
      var latLines = [-30, 0, 30, 60];
      var lonSteps = [-180, -150, -120, -90, -60, -30, 0, 30, 60, 90, 120, 150];
      var tropicNorthY = projectLat(23.44, MAP_H);
      var tropicSouthY = projectLat(-23.44, MAP_H);

      return (
        <g>
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
            {lonSteps.map(function (lon) {
              var x = projectLonLat(lon, 0, MAP_W, MAP_H, mapCenterLon).x;
              return (
                <line
                  key={'lon-' + String(lon)}
                  x1={x.toFixed(1)}
                  y1="0"
                  x2={x.toFixed(1)}
                  y2={String(MAP_H)}
                  stroke={lon === 0 ? 'rgba(214, 234, 255, 0.16)' : 'rgba(214, 234, 255, 0.08)'}
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

          {/* High-detail Natural Earth 110m landmasses & subtle country borders (tiled seamlessly for Home centering) */}
          <g class="world-land-layer">
            {landTileOffsets.map(function (tx, tIdx) {
              return (
                <g
                  key={'land-tile-' + String(tIdx)}
                  transform={'translate(' + tx.toFixed(2) + ',0)'}
                >
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
              );
            })}
          </g>
        </g>
      );
    },
    [mapCenterLon]
  );

  // Before the first /api/world response, show placeholder cards for the
  // configured (or city-derived) pairs so the row doesn't jump on load.
  var fxCards: FXQuote[] =
    fxQuotes.length > 0
      ? fxQuotes
      : props.fxPairs.map(function (p) {
          return {
            symbol: p.symbol,
            base: p.base,
            quote: p.quote,
            label: p.label,
            rate: 0,
            change: 0,
            changePct: 0,
            sparkline: [],
          };
        });
  var isCompactFX = fxCards.length >= 5;
  var fxSparkW = isCompactFX ? 44 : 82;
  var fxSparkH = isCompactFX ? 20 : 26;

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
                    ? 'ctrl-btn ctrl-btn-mode ctrl-btn-world-icon ctrl-btn-selected world-icon-flights'
                    : 'ctrl-btn ctrl-btn-mode ctrl-btn-world-icon'
                }
                onClick={function () {
                  toggleLayer('arcs');
                }}
                aria-pressed={showArcs}
                aria-label="Toggle flight routes"
                title="Flight routes"
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
                  <path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z" />
                </svg>
              </button>
              <button
                type="button"
                class={
                  showCelestial
                    ? 'ctrl-btn ctrl-btn-mode ctrl-btn-world-icon ctrl-btn-selected world-icon-celestial'
                    : 'ctrl-btn ctrl-btn-mode ctrl-btn-world-icon'
                }
                onClick={function () {
                  toggleLayer('celestial');
                }}
                aria-pressed={showCelestial}
                aria-label="Toggle Sun and Moon markers"
                title="Sun & Moon"
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
                  <path d="M12 8a2.83 2.83 0 0 0 4 4 4 4 0 1 1-4-4" />
                  <path d="M12 2v2" />
                  <path d="M12 20v2" />
                  <path d="m4.9 4.9 1.4 1.4" />
                  <path d="m17.7 17.7 1.4 1.4" />
                  <path d="M2 12h2" />
                  <path d="M20 12h2" />
                  <path d="m6.3 17.7-1.4 1.4" />
                  <path d="m19.1 4.9-1.4 1.4" />
                </svg>
              </button>
              <button
                type="button"
                class={
                  showISS
                    ? 'ctrl-btn ctrl-btn-mode ctrl-btn-world-icon ctrl-btn-selected world-icon-iss'
                    : 'ctrl-btn ctrl-btn-mode ctrl-btn-world-icon'
                }
                onClick={function () {
                  toggleLayer('iss');
                }}
                aria-pressed={showISS}
                aria-label="Toggle International Space Station and orbit"
                title="ISS & orbit"
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
                  <path d="M13 7 9 3 5 7l4 4" />
                  <path d="m17 11 4 4-4 4-4-4" />
                  <path d="m8 12 4 4 6-6-4-4Z" />
                  <path d="m16 8 3-3" />
                  <path d="M9 21a6 6 0 0 0-6-6" />
                </svg>
              </button>
              <button
                type="button"
                class={
                  showQuakes
                    ? 'ctrl-btn ctrl-btn-mode ctrl-btn-world-icon ctrl-btn-selected world-icon-quakes'
                    : 'ctrl-btn ctrl-btn-mode ctrl-btn-world-icon'
                }
                onClick={function () {
                  toggleLayer('quakes');
                }}
                aria-pressed={showQuakes}
                aria-label="Toggle recent earthquakes"
                title="Earthquakes (M4.5+, 24h)"
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
                  <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
                </svg>
              </button>
              <button
                type="button"
                class={
                  showAurora
                    ? 'ctrl-btn ctrl-btn-mode ctrl-btn-world-icon ctrl-btn-selected world-icon-aurora'
                    : 'ctrl-btn ctrl-btn-mode ctrl-btn-world-icon'
                }
                onClick={function () {
                  toggleLayer('aurora');
                }}
                aria-pressed={showAurora}
                aria-label="Toggle Aurora Oval and geomagnetic Kp activity"
                title="Aurora Oval"
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
                  <path d="M3 18c2-6 4.5-9 7.5-9s4.5 4 7 4c1.5 0 2.5-.8 3.5-2" />
                  <path d="M3 13c2-5 4.5-7.5 7.5-7.5s4.5 3.5 7 3.5c1.5 0 2.5-.7 3.5-1.8" opacity="0.6" />
                  <path d="M18 3v3" />
                  <path d="M16.5 4.5h3" />
                </svg>
              </button>
              <button
                type="button"
                class={
                  showStorms
                    ? 'ctrl-btn ctrl-btn-mode ctrl-btn-world-icon ctrl-btn-selected world-icon-storms'
                    : 'ctrl-btn ctrl-btn-mode ctrl-btn-world-icon'
                }
                onClick={function () {
                  toggleLayer('storms');
                }}
                aria-pressed={showStorms}
                aria-label="Toggle active tropical cyclones and hurricanes"
                title="Tropical cyclones & hurricanes"
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
                  <circle cx="12" cy="12" r="3.4" />
                  <path d="M12 8.6C15.8 8.6 18.8 5.8 18.5 2.5" />
                  <path d="M12 15.4C8.2 15.4 5.2 18.2 5.5 21.5" />
                  <path d="M15.4 12C15.4 15.8 12.6 19 8.8 19.2" />
                  <path d="M8.6 12C8.6 8.2 11.4 5 15.2 4.8" />
                </svg>
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

        {/* Main Day/Night World Map */}
        <section class="world-map-card" aria-label="Live day and night world map">
          <svg
            class="world-map-svg"
            viewBox={'0 0 ' + String(MAP_W) + ' ' + String(MAP_H)}
            preserveAspectRatio={isWideMap ? 'xMidYMid slice' : 'xMidYMid meet'}
            onClick={function (e) {
              var tgt = e.target as Element | null;
              if (tgt && tgt.tagName && tgt.tagName.toLowerCase() === 'svg') {
                clearAllSelections();
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

              {staticMapLayers}

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
                  onClick={function (e) {
                    var wasSelected = Boolean(selectedAuroraPt);
                    clearAllSelections();
                    if (wasSelected) {
                      return;
                    }
                    var svgEl = (e.currentTarget as SVGElement).ownerSVGElement;
                    if (svgEl) {
                      var rect = svgEl.getBoundingClientRect();
                      if (rect.width > 0 && rect.height > 0) {
                        var scale = isWideMap
                          ? Math.max(rect.width / MAP_W, rect.height / MAP_H)
                          : Math.min(rect.width / MAP_W, rect.height / MAP_H);
                        var renderedW = MAP_W * scale;
                        var renderedH = MAP_H * scale;
                        var offX = rect.left + (rect.width - renderedW) / 2;
                        var offY = rect.top + (rect.height - renderedH) / 2;
                        var tapX = (e.clientX - offX) / scale;
                        var tapY = (e.clientY - offY) / scale;
                        setSelectedAuroraPt({
                          x: Math.max(30, Math.min(MAP_W - 30, tapX)),
                          y: Math.max(24, Math.min(MAP_H - 24, tapY)),
                        });
                        return;
                      }
                    }
                    setSelectedAuroraPt({ x: MAP_W / 2, y: 52 });
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
                    var sPt = projectLonLat(storm.lon, storm.lat, MAP_W, MAP_H, mapCenterLon);
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
                          clearAllSelections();
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
                    var qPt = projectLonLat(q.lon, q.lat, MAP_W, MAP_H, mapCenterLon);
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
                          clearAllSelections();
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
                        stroke="rgba(240, 171, 252, 0.36)"
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
                          stroke={
                            selectedISS
                              ? 'rgba(232, 121, 249, 0.42)'
                              : 'rgba(217, 70, 239, 0.24)'
                          }
                          stroke-width={selectedISS ? '5.5' : '4'}
                          stroke-linecap="round"
                        />
                        <path
                          d={seg}
                          fill="none"
                          stroke={selectedISS ? '#f5d0fe' : '#e879f9'}
                          stroke-width={selectedISS ? '2' : '1.5'}
                          stroke-linecap="round"
                          opacity="0.94"
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
                            ? 'rgba(232, 121, 249, 0.09)'
                            : 'none'
                        }
                        stroke="rgba(240, 171, 252, 0.48)"
                        stroke-width="1"
                        stroke-dasharray="3 3"
                      />
                    );
                  })}

                  {/* Interactive ISS Marker */}
                  <g
                    class="world-iss-marker"
                    transform={
                      'translate(' +
                      issTrack.x.toFixed(1) +
                      ',' +
                      issTrack.y.toFixed(1) +
                      ')'
                    }
                    onClick={function () {
                      var next = !selectedISS;
                      clearAllSelections();
                      setSelectedISS(next);
                    }}
                  >
                    <circle cx="0" cy="0" r="20" fill="transparent" />
                    <circle
                      cx="0"
                      cy="0"
                      r={selectedISS ? '14' : '11'}
                      fill={
                        selectedISS
                          ? 'rgba(232, 121, 249, 0.3)'
                          : 'rgba(232, 121, 249, 0.18)'
                      }
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
                        stroke="#fae8ff"
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
                        fill="#d946ef"
                        stroke="#091326"
                        stroke-width="0.6"
                      />
                      <rect
                        x="-5.3"
                        y="-5.5"
                        width="2.6"
                        height="11"
                        rx="0.7"
                        fill="#f0abfc"
                        stroke="#091326"
                        stroke-width="0.6"
                      />
                      <rect
                        x="2.7"
                        y="-5.5"
                        width="2.6"
                        height="11"
                        rx="0.7"
                        fill="#f0abfc"
                        stroke="#091326"
                        stroke-width="0.6"
                      />
                      <rect
                        x="6.5"
                        y="-6"
                        width="3"
                        height="12"
                        rx="0.7"
                        fill="#d946ef"
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
                      fill="#f5d0fe"
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
                          clearAllSelections();
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
                        clearAllSelections();
                        if (!pin.isHome) {
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
              {/* Contextual inline pillbox anchored next to whichever element was tapped */}
              {activePopover
                ? (function () {
                    var pillW = Math.max(
                      120,
                      Math.min(370, Math.round(activePopover.text.length * 6.0 + 24))
                    );
                    var halfW = pillW / 2;
                    var px = Math.max(
                      halfW + 14,
                      Math.min(MAP_W - halfW - 14, activePopover.x)
                    );
                    var py =
                      activePopover.y < 42
                        ? Math.min(MAP_H - 18, activePopover.y + 24)
                        : Math.max(18, activePopover.y - 22);
                    return (
                      <g
                        class="world-map-popover"
                        transform={'translate(' + px.toFixed(1) + ',' + py.toFixed(1) + ')'}
                        onClick={clearAllSelections}
                      >
                        <rect
                          x={(-halfW).toFixed(1)}
                          y="-11.5"
                          width={String(pillW)}
                          height="23"
                          rx="11.5"
                          fill="rgba(9, 17, 32, 0.9)"
                          stroke={activePopover.stroke}
                          stroke-width="1"
                        />
                        <text
                          x="0"
                          y="3.5"
                          text-anchor="middle"
                          fill={activePopover.textColor}
                          font-size="10.5"
                          font-weight="600"
                          font-family="-apple-system, BlinkMacSystemFont, Helvetica Neue, sans-serif"
                        >
                          {activePopover.text}
                        </text>
                      </g>
                    );
                  })()
                : null}
            </g>
          </svg>
        </section>

        {/* Bottom Live FX Rates Strip */}
        <section
          class={
            'world-fx-row' +
            (isCompactFX ? ' world-fx-row-compact' : '') +
            (isLoading && fxQuotes.length === 0 ? ' world-fx-loading' : '')
          }
          aria-label="Live foreign exchange rates"
        >
          {fxCards.map(function (fx) {
            var hasRate = !fx.unavailable && fx.rate > 0;
            var isUp = fx.change >= 0;
            var isFlat = Math.abs(fx.changePct) < 0.005;
            var sparkPath = buildMiniSparkPath(fx.sparkline, fxSparkW, fxSparkH);
            var sparkColor = isFlat ? '#94a3b8' : isUp ? '#34d399' : '#fb7185';
            var invHint = hasRate ? formatFXInverseHint(fx.rate, fx.base, fx.quote) : '';
            var displayLabel = isCompactFX ? fx.label.replace(/\s*\/\s*/, '/') : fx.label;

            return (
              <div class="world-fx-card" key={fx.symbol}>
                <div class="world-fx-top">
                  <div class="world-fx-pair-wrap">
                    <span class="world-fx-badge">{getCurrencySymbol(fx.quote, fx.quote)}</span>
                    <span class="world-fx-pair">{displayLabel}</span>
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
                      width={String(fxSparkW)}
                      height={String(fxSparkH)}
                      viewBox={'0 0 ' + String(fxSparkW) + ' ' + String(fxSparkH)}
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
