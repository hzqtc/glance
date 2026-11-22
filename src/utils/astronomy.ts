import type { ISSOrbit } from '../types';

var DEG2RAD = Math.PI / 180;
var RAD2DEG = 180 / Math.PI;
var EARTH_MU = 398600.4418; // km^3 / s^2
var EARTH_RADIUS_KM = 6378.137; // WGS-84 equatorial radius
var EARTH_E2 = 0.00669437999014; // WGS-84 first eccentricity squared
var EARTH_J2 = 1.08262668e-3;

/**
 * Base pre-projected coordinates of WORLD_LAND_PATH:
 * left edge = -25°W (25°W mid-Atlantic origin), 82°N to 58°S.
 * Default initial center longitude matches Home city (Sunnyvale) so cold loads never jump.
 */
export var MAP_CENTER_LON = -122.0363;
export var MAP_LEFT_LON = -25;
export var MAP_MAX_LAT = 82;
export var MAP_MIN_LAT = -58;
export var MAP_LAT_SPAN = MAP_MAX_LAT - MAP_MIN_LAT; // 140

export interface GeoPoint {
  lat: number;
  lon: number;
}

export interface ProjectedPoint {
  x: number;
  y: number;
}

export interface GreatCircleArcResult {
  segments: string[];
  distKm: number;
  distMi: number;
  flightLabel: string;
  midX: number;
  midY: number;
}

export function wrapLon180(lon: number): number {
  var x = ((lon + 180) % 360 + 360) % 360 - 180;
  return x;
}

export function projectLat(lat: number, mapH: number): number {
  var clampedLat =
    lat > MAP_MAX_LAT ? MAP_MAX_LAT : lat < MAP_MIN_LAT ? MAP_MIN_LAT : lat;
  return ((MAP_MAX_LAT - clampedLat) / MAP_LAT_SPAN) * mapH;
}

export function getMapLeftLon(centerLon?: number): number {
  var c = typeof centerLon === 'number' && isFinite(centerLon) ? centerLon : MAP_CENTER_LON;
  return c - 180;
}

/** Projects (lon, lat) onto an equirectangular canvas centered at `centerLon` (defaults to MAP_CENTER_LON). */
export function projectLonLat(
  lon: number,
  lat: number,
  mapW: number,
  mapH: number,
  centerLon?: number
): ProjectedPoint {
  var leftLon = getMapLeftLon(centerLon);
  var shifted = ((lon - leftLon) % 360 + 360) % 360;
  return {
    x: (shifted / 360) * mapW,
    y: projectLat(lat, mapH),
  };
}

function julianDaysSinceJ2000(nowMs: number): number {
  var jd = nowMs / 86400000 + 2440587.5;
  return jd - 2451545.0;
}

function greenwichMeanSiderealDeg(n: number): number {
  return ((280.46061837 + 360.98564736629 * n) % 360 + 360) % 360;
}

/** Accurate subsolar point (latitude = solar declination, longitude includes equation of time). */
export function getSubsolarPoint(nowMs: number): GeoPoint {
  var n = julianDaysSinceJ2000(nowMs);
  var L = ((280.46 + 0.9856474 * n) % 360 + 360) % 360;
  var g = ((357.528 + 0.9856003 * n) % 360 + 360) % 360;
  var gRad = g * DEG2RAD;

  var lambda = L + 1.915 * Math.sin(gRad) + 0.02 * Math.sin(2 * gRad);
  var lambdaRad = lambda * DEG2RAD;
  var epsRad = (23.439 - 0.0000004 * n) * DEG2RAD;

  var sinDec = Math.sin(epsRad) * Math.sin(lambdaRad);
  var decDeg = Math.asin(Math.max(-1, Math.min(1, sinDec))) * RAD2DEG;
  var raDeg =
    Math.atan2(Math.cos(epsRad) * Math.sin(lambdaRad), Math.cos(lambdaRad)) * RAD2DEG;

  var gmst = greenwichMeanSiderealDeg(n);
  var lon = wrapLon180(raDeg - gmst);
  return { lat: decDeg, lon: lon };
}

/** Low-precision sublunar point (~0.3° accuracy — crisp for world map display). */
export function getSublunarPoint(nowMs: number): GeoPoint {
  var n = julianDaysSinceJ2000(nowMs);
  var Lm = ((218.316 + 13.176396 * n) % 360 + 360) % 360;
  var Mm = ((134.963 + 13.064993 * n) % 360 + 360) % 360;
  var F = ((93.272 + 13.22935 * n) % 360 + 360) % 360;

  var lamRad = (Lm + 6.289 * Math.sin(Mm * DEG2RAD)) * DEG2RAD;
  var betRad = 5.128 * Math.sin(F * DEG2RAD) * DEG2RAD;
  var epsRad = (23.439 - 0.0000004 * n) * DEG2RAD;

  var sinDec =
    Math.sin(betRad) * Math.cos(epsRad) +
    Math.cos(betRad) * Math.sin(epsRad) * Math.sin(lamRad);
  var decDeg = Math.asin(Math.max(-1, Math.min(1, sinDec))) * RAD2DEG;

  var y = Math.sin(lamRad) * Math.cos(epsRad) - Math.tan(betRad) * Math.sin(epsRad);
  var x = Math.cos(lamRad);
  var raDeg = Math.atan2(y, x) * RAD2DEG;

  var gmst = greenwichMeanSiderealDeg(n);
  var lon = wrapLon180(raDeg - gmst);
  return { lat: decDeg, lon: lon };
}

/**
 * Builds the smooth SVG night-shadow polygon and glowing terminator line
 * across [MAP_LEFT_LON, MAP_LEFT_LON + 360].
 */
export function buildTerminatorPaths(
  sunLat: number,
  sunLon: number,
  mapW: number,
  mapH: number,
  centerLon?: number
): { nightPath: string; twilightPath: string; terminatorLine: string } {
  // Guard exact equinox (0° declination) to keep tan(sunLat) well-behaved
  var effLat = sunLat;
  if (Math.abs(effLat) < 0.15) {
    effLat = effLat < 0 ? -0.15 : 0.15;
  }
  var tanSun = Math.tan(effLat * DEG2RAD);
  var nightPoleY = effLat >= 0 ? mapH : 0;
  var leftLon = getMapLeftLon(centerLon);

  var steps = 120;
  var lineParts: string[] = [];
  var nightParts: string[] = [];
  var twiUpper: ProjectedPoint[] = [];
  var twiLower: ProjectedPoint[] = [];

  for (var i = 0; i <= steps; i++) {
    var frac = i / steps;
    var lon = leftLon + frac * 360;
    var dLonRad = (lon - sunLon) * DEG2RAD;
    var termLat = Math.atan(-Math.cos(dLonRad) / tanSun) * RAD2DEG;
    var x = frac * mapW;
    var y = projectLat(termLat, mapH);

    lineParts.push((i === 0 ? 'M ' : 'L ') + x.toFixed(1) + ' ' + y.toFixed(1));
    nightParts.push((i === 0 ? 'M ' : 'L ') + x.toFixed(1) + ' ' + y.toFixed(1));

    // Subtle twilight ribbon (+/- 5.5° around the solar terminator)
    twiUpper.push({ x: x, y: projectLat(termLat + 5.5, mapH) });
    twiLower.push({ x: x, y: projectLat(termLat - 5.5, mapH) });
  }

  nightParts.push('L ' + mapW.toFixed(1) + ' ' + nightPoleY.toFixed(1));
  nightParts.push('L 0 ' + nightPoleY.toFixed(1));
  nightParts.push('Z');

  var twiParts: string[] = [];
  for (var u = 0; u < twiUpper.length; u++) {
    twiParts.push(
      (u === 0 ? 'M ' : 'L ') +
        twiUpper[u].x.toFixed(1) +
        ' ' +
        twiUpper[u].y.toFixed(1)
    );
  }
  for (var l = twiLower.length - 1; l >= 0; l--) {
    twiParts.push(
      'L ' + twiLower[l].x.toFixed(1) + ' ' + twiLower[l].y.toFixed(1)
    );
  }
  twiParts.push('Z');

  return {
    nightPath: nightParts.join(' '),
    twilightPath: twiParts.join(' '),
    terminatorLine: lineParts.join(' '),
  };
}

/** Computes spherical geodesic arc, great-circle distance, and estimated nonstop flight time. */
export function computeGreatCircleArc(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
  mapW: number,
  mapH: number,
  centerLon?: number
): GreatCircleArcResult {
  var p1Lat = lat1 * DEG2RAD;
  var p1Lon = lon1 * DEG2RAD;
  var p2Lat = lat2 * DEG2RAD;
  var p2Lon = lon2 * DEG2RAD;

  var x1 = Math.cos(p1Lat) * Math.cos(p1Lon);
  var y1 = Math.cos(p1Lat) * Math.sin(p1Lon);
  var z1 = Math.sin(p1Lat);

  var x2 = Math.cos(p2Lat) * Math.cos(p2Lon);
  var y2 = Math.cos(p2Lat) * Math.sin(p2Lon);
  var z2 = Math.sin(p2Lat);

  var dot = Math.max(-1, Math.min(1, x1 * x2 + y1 * y2 + z1 * z2));
  var omega = Math.acos(dot);
  var distKm = Math.round(6371 * omega);
  var distMi = Math.round(distKm * 0.621371);

  // Commercial long-haul cruise (~840 km/h) + ~33 min climb/approach
  var flightHours = distKm / 840 + 0.55;
  var totalMins = Math.round(flightHours * 60);
  var fh = Math.floor(totalMins / 60);
  var fm = Math.round((totalMins % 60) / 5) * 5;
  if (fm === 60) {
    fh += 1;
    fm = 0;
  }
  var flightLabel =
    fh > 0
      ? '~' + String(fh) + 'h ' + (fm > 0 ? String(fm) + 'm' : '')
      : '~' + String(Math.max(20, fm)) + 'm';
  flightLabel = flightLabel.trim();

  var segments: string[] = [];
  var curParts: string[] = [];
  var prevX = -9999;
  var steps = 40;
  var sinOmega = Math.sin(omega);
  var midPt: ProjectedPoint = projectLonLat(lon1, lat1, mapW, mapH, centerLon);

  for (var i = 0; i <= steps; i++) {
    var t = i / steps;
    var px: number;
    var py: number;
    var pz: number;
    if (sinOmega < 1e-6) {
      px = x1;
      py = y1;
      pz = z1;
    } else {
      var a = Math.sin((1 - t) * omega) / sinOmega;
      var b = Math.sin(t * omega) / sinOmega;
      px = a * x1 + b * x2;
      py = a * y1 + b * y2;
      pz = a * z1 + b * z2;
    }
    var lat = Math.atan2(pz, Math.sqrt(px * px + py * py)) * RAD2DEG;
    var lon = Math.atan2(py, px) * RAD2DEG;
    var proj = projectLonLat(lon, lat, mapW, mapH, centerLon);

    if (i === Math.floor(steps / 2)) {
      midPt = proj;
    }

    if (prevX !== -9999 && Math.abs(proj.x - prevX) > mapW * 0.45) {
      if (curParts.length > 1) {
        segments.push(curParts.join(' '));
      }
      curParts = ['M ' + proj.x.toFixed(1) + ' ' + proj.y.toFixed(1)];
    } else {
      curParts.push(
        (curParts.length === 0 ? 'M ' : 'L ') +
          proj.x.toFixed(1) +
          ' ' +
          proj.y.toFixed(1)
      );
    }
    prevX = proj.x;
  }

  if (curParts.length > 1) {
    segments.push(curParts.join(' '));
  }

  return {
    segments: segments,
    distKm: distKm,
    distMi: distMi,
    flightLabel: flightLabel,
    midX: midPt.x,
    midY: midPt.y,
  };
}

export function formatCoordLat(lat: number): string {
  var hemi = lat >= 0 ? 'N' : 'S';
  return Math.abs(lat).toFixed(1) + '°' + hemi;
}

export function formatCoordLon(lon: number): string {
  var hemi = lon >= 0 ? 'E' : 'W';
  return Math.abs(lon).toFixed(1) + '°' + hemi;
}

export function formatFXRate(rate: number, quote: string): string {
  if (!isFinite(rate) || rate <= 0) return '—';
  if (quote === 'JPY' || quote === 'KRW' || rate >= 50) {
    return rate.toFixed(2);
  }
  return rate.toFixed(4);
}

export function formatFXInverseHint(rate: number, base: string, quote: string): string {
  if (!isFinite(rate) || rate <= 0) return '';
  var baseSym = base === 'USD' ? '$' : base + ' ';
  if (quote === 'JPY' || rate >= 50) {
    var per1000 = 1000 / rate;
    return '1,000 ' + quote + ' = ' + baseSym + per1000.toFixed(2);
  }
  if (rate >= 2) {
    var per100 = 100 / rate;
    return '100 ' + quote + ' = ' + baseSym + per100.toFixed(2);
  }
  var per1 = 1 / rate;
  return '1 ' + quote + ' = ' + baseSym + per1.toFixed(2);
}

export function formatUTCClock(nowMs: number): string {
  var d = new Date(nowMs);
  var h = d.getUTCHours();
  var m = d.getUTCMinutes();
  var hs = h < 10 ? '0' + String(h) : String(h);
  var ms = m < 10 ? '0' + String(m) : String(m);
  return hs + ':' + ms + ' UTC';
}

export interface ISSPosition {
  lat: number;
  lon: number;
  altKm: number;
  speedKmh: number;
  sunlit: boolean;
}

export interface ISSTrackResult {
  current: ISSPosition;
  x: number;
  y: number;
  headingDeg: number;
  pastSegments: string[];
  futureSegments: string[];
  footprintSegments: string[];
}

/**
 * Propagates the ISS TLE orbital elements to `timeMs` using a J2-perturbed
 * Keplerian model (nodal + apsidal precession, drag term, WGS-84 geodetic lat/alt).
 */
export function propagateISS(
  orbit: ISSOrbit,
  timeMs: number,
  includeSunlit?: boolean
): ISSPosition {
  var dtDays = (timeMs - orbit.epochMs) / 86400000;
  var dtSec = dtDays * 86400;

  var inc = orbit.inclinationDeg * DEG2RAD;
  var e = orbit.eccentricity;
  var n0 = (orbit.meanMotionRevPerDay * 2 * Math.PI) / 86400; // rad/s
  var a = Math.pow(EARTH_MU / (n0 * n0), 1 / 3);
  var p = a * (1 - e * e);

  // J2 secular precession rates (rad/s)
  var j2Factor = 1.5 * EARTH_J2 * Math.pow(EARTH_RADIUS_KM / p, 2) * n0;
  var cosInc = Math.cos(inc);
  var sinInc = Math.sin(inc);
  var raanDot = -j2Factor * cosInc;
  var argPDot = 0.5 * j2Factor * (5 * cosInc * cosInc - 1);

  var raan = orbit.raanDeg * DEG2RAD + raanDot * dtSec;
  var argP = orbit.argPerigeeDeg * DEG2RAD + argPDot * dtSec;

  // Mean anomaly with secular drag term (ndot in rev/day^2)
  var mRev =
    orbit.meanAnomalyDeg / 360 +
    orbit.meanMotionRevPerDay * dtDays +
    orbit.meanMotionDot * dtDays * dtDays;
  var M = ((mRev % 1) + 1) % 1 * 2 * Math.PI;

  // Solve Kepler's equation E - e*sin(E) = M
  var E = M;
  for (var iter = 0; iter < 4; iter++) {
    E = E - (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
  }

  var cosE = Math.cos(E);
  var sinE = Math.sin(E);
  var xOrb = a * (cosE - e);
  var yOrb = a * Math.sqrt(1 - e * e) * sinE;
  var r = Math.sqrt(xOrb * xOrb + yOrb * yOrb);
  var nu = Math.atan2(yOrb, xOrb);
  var u = argP + nu;

  var cosO = Math.cos(raan);
  var sinO = Math.sin(raan);
  var cosU = Math.cos(u);
  var sinU = Math.sin(u);

  // ECI position (km)
  var xEci = r * (cosO * cosU - sinO * sinU * cosInc);
  var yEci = r * (sinO * cosU + cosO * sinU * cosInc);
  var zEci = r * (sinU * sinInc);

  // Rotate ECI -> ECEF via GMST
  var gmst = greenwichMeanSiderealDeg(julianDaysSinceJ2000(timeMs)) * DEG2RAD;
  var cosG = Math.cos(gmst);
  var sinG = Math.sin(gmst);
  var xEcef = xEci * cosG + yEci * sinG;
  var yEcef = -xEci * sinG + yEci * cosG;
  var zEcef = zEci;

  var lon = wrapLon180(Math.atan2(yEcef, xEcef) * RAD2DEG);
  var rho = Math.sqrt(xEcef * xEcef + yEcef * yEcef);
  var latRad = Math.atan2(zEcef, rho);
  var N = EARTH_RADIUS_KM;
  for (var gIter = 0; gIter < 3; gIter++) {
    var sinLat = Math.sin(latRad);
    N = EARTH_RADIUS_KM / Math.sqrt(1 - EARTH_E2 * sinLat * sinLat);
    latRad = Math.atan2(zEcef + EARTH_E2 * N * sinLat, rho);
  }
  var cosLat = Math.cos(latRad);
  var altKm =
    Math.abs(cosLat) > 1e-6
      ? rho / cosLat - N
      : Math.abs(zEcef) / Math.abs(Math.sin(latRad)) - N * (1 - EARTH_E2);

  // Orbital velocity via vis-viva equation
  var speedKmS = Math.sqrt(Math.max(0, EARTH_MU * (2 / r - 1 / a)));
  var speedKmh = speedKmS * 3600;

  var sunlit = true;
  if (includeSunlit) {
    var sun = getSubsolarPoint(timeMs);
    var sLat = sun.lat * DEG2RAD;
    var sLon = sun.lon * DEG2RAD;
    var sx = Math.cos(sLat) * Math.cos(sLon);
    var sy = Math.cos(sLat) * Math.sin(sLon);
    var sz = Math.sin(sLat);
    var dotSun = xEcef * sx + yEcef * sy + zEcef * sz;
    if (dotSun < 0) {
      var rSq = xEcef * xEcef + yEcef * yEcef + zEcef * zEcef;
      var perpSq = rSq - dotSun * dotSun;
      sunlit = perpSq > EARTH_RADIUS_KM * EARTH_RADIUS_KM;
    }
  }

  return {
    lat: latRad * RAD2DEG,
    lon: lon,
    altKm: altKm,
    speedKmh: speedKmh,
    sunlit: sunlit,
  };
}

function buildWrappedPolylineSegments(
  points: ProjectedPoint[],
  mapW: number
): string[] {
  var segments: string[] = [];
  var cur: string[] = [];
  var prevX = -9999;

  for (var i = 0; i < points.length; i++) {
    var pt = points[i];
    if (prevX !== -9999 && Math.abs(pt.x - prevX) > mapW * 0.45) {
      if (cur.length > 1) {
        segments.push(cur.join(' '));
      }
      cur = ['M ' + pt.x.toFixed(1) + ' ' + pt.y.toFixed(1)];
    } else {
      cur.push((cur.length === 0 ? 'M ' : 'L ') + pt.x.toFixed(1) + ' ' + pt.y.toFixed(1));
    }
    prevX = pt.x;
  }
  if (cur.length > 1) {
    segments.push(cur.join(' '));
  }
  return segments;
}

/** Builds live ISS position, past trail (-45m), future orbit (+95m), and horizon footprint. */
export function buildISSTrack(
  orbit: ISSOrbit,
  nowMs: number,
  mapW: number,
  mapH: number,
  centerLon?: number
): ISSTrackResult {
  var current = propagateISS(orbit, nowMs, true);
  var curPt = projectLonLat(current.lon, current.lat, mapW, mapH, centerLon);

  // Sample 15s ahead for map-space heading angle
  var ahead = propagateISS(orbit, nowMs + 15000);
  var aheadPt = projectLonLat(ahead.lon, ahead.lat, mapW, mapH, centerLon);
  var dx = aheadPt.x - curPt.x;
  if (dx > mapW * 0.5) dx -= mapW;
  if (dx < -mapW * 0.5) dx += mapW;
  var dy = aheadPt.y - curPt.y;
  var headingDeg = Math.atan2(dy, dx) * RAD2DEG;

  // Past trail: -45 minutes to now (every 1.5 min)
  var pastPts: ProjectedPoint[] = [];
  var pastSteps = 30;
  for (var p = pastSteps; p >= 0; p--) {
    var posP = propagateISS(orbit, nowMs - p * 90000);
    pastPts.push(projectLonLat(posP.lon, posP.lat, mapW, mapH, centerLon));
  }

  // Future trajectory: now to +95 minutes (~1 full orbit, every 1.5 min)
  var futurePts: ProjectedPoint[] = [];
  var futureSteps = 64;
  for (var f = 0; f <= futureSteps; f++) {
    var posF = propagateISS(orbit, nowMs + f * 90000);
    futurePts.push(projectLonLat(posF.lon, posF.lat, mapW, mapH, centerLon));
  }

  // Horizon visibility footprint circle on the sphere
  var clampedAlt = Math.max(200, Math.min(800, current.altKm));
  var angRad = Math.acos(EARTH_RADIUS_KM / (EARTH_RADIUS_KM + clampedAlt));
  var lat0 = current.lat * DEG2RAD;
  var lon0 = current.lon * DEG2RAD;
  var sinLat0 = Math.sin(lat0);
  var cosLat0 = Math.cos(lat0);
  var sinAng = Math.sin(angRad);
  var cosAng = Math.cos(angRad);

  var footPts: ProjectedPoint[] = [];
  var footSteps = 48;
  for (var k = 0; k <= footSteps; k++) {
    var brng = (k / footSteps) * 2 * Math.PI;
    var fLat = Math.asin(
      Math.max(-1, Math.min(1, sinLat0 * cosAng + cosLat0 * sinAng * Math.cos(brng)))
    );
    var fLon =
      lon0 +
      Math.atan2(
        Math.sin(brng) * sinAng * cosLat0,
        cosAng - sinLat0 * Math.sin(fLat)
      );
    footPts.push(
      projectLonLat(wrapLon180(fLon * RAD2DEG), fLat * RAD2DEG, mapW, mapH, centerLon)
    );
  }

  return {
    current: current,
    x: curPt.x,
    y: curPt.y,
    headingDeg: headingDeg,
    pastSegments: buildWrappedPolylineSegments(pastPts, mapW),
    futureSegments: buildWrappedPolylineSegments(futurePts, mapW),
    footprintSegments: buildWrappedPolylineSegments(footPts, mapW),
  };
}

export interface AuroraOvalPaths {
  northOuter: string;
  northCore: string;
  southOuter: string;
  southCore: string;
  intensity: number; // 0..1 visual intensity from Kp
  isStorm: boolean;
}

function solvePolarRingLat(
  poleLatDeg: number,
  poleLonDeg: number,
  colatDeg: number,
  lonDeg: number
): number {
  var pLat = Math.abs(poleLatDeg) * DEG2RAD;
  var dLon = (lonDeg - poleLonDeg) * DEG2RAD;
  var A = Math.sin(pLat);
  var B = Math.cos(pLat) * Math.cos(dLon);
  var R = Math.sqrt(A * A + B * B);
  var alpha = Math.atan2(B, A);
  var ratio = Math.cos(colatDeg * DEG2RAD) / R;
  if (ratio > 1) ratio = 1;
  if (ratio < -1) ratio = -1;
  var northLat = (Math.asin(ratio) - alpha) * RAD2DEG;
  return poleLatDeg >= 0 ? northLat : -northLat;
}

function buildAuroraBandPolygon(
  poleLatDeg: number,
  poleLonDeg: number,
  kp: number,
  sunLon: number,
  widthScale: number,
  mapW: number,
  mapH: number,
  centerLon?: number
): string {
  var clampedKp = Math.max(0, Math.min(9, kp));
  var leftLon = getMapLeftLon(centerLon);
  var steps = 120;
  var upperPts: ProjectedPoint[] = [];
  var lowerPts: ProjectedPoint[] = [];
  var anyVisible = false;

  for (var i = 0; i <= steps; i++) {
    var frac = i / steps;
    var lon = leftLon + frac * 360;
    // Nightside expansion factor: 0 at solar noon, 1 at solar midnight
    var nightFactor = 0.5 * (1 - Math.cos((lon - sunLon) * DEG2RAD));
    var centerColat = 15.2 + 2.25 * clampedKp + 4.4 * nightFactor;
    var halfWidth = (2.6 + 0.48 * clampedKp) * widthScale;

    var innerColat = Math.max(9.5, centerColat - halfWidth);
    var outerColat = Math.min(54, centerColat + halfWidth);

    var innerLat = solvePolarRingLat(poleLatDeg, poleLonDeg, innerColat, lon);
    var outerLat = solvePolarRingLat(poleLatDeg, poleLonDeg, outerColat, lon);

    if (
      (innerLat <= MAP_MAX_LAT && innerLat >= MAP_MIN_LAT) ||
      (outerLat <= MAP_MAX_LAT && outerLat >= MAP_MIN_LAT)
    ) {
      anyVisible = true;
    }

    var x = frac * mapW;
    upperPts.push({ x: x, y: projectLat(innerLat, mapH) });
    lowerPts.push({ x: x, y: projectLat(outerLat, mapH) });
  }

  if (!anyVisible) {
    return '';
  }

  var parts: string[] = [];
  for (var u = 0; u < upperPts.length; u++) {
    parts.push(
      (u === 0 ? 'M ' : 'L ') +
        upperPts[u].x.toFixed(1) +
        ' ' +
        upperPts[u].y.toFixed(1)
    );
  }
  for (var l = lowerPts.length - 1; l >= 0; l--) {
    parts.push('L ' + lowerPts[l].x.toFixed(1) + ' ' + lowerPts[l].y.toFixed(1));
  }
  parts.push('Z');
  return parts.join(' ');
}

/**
 * Computes geomagnetic northern and southern aurora ovals (Feldstein-Starkov
 * dipole model expanded dynamically by live NOAA planetary Kp & solar midnight).
 */
export function buildAuroraOvalPaths(
  kp: number,
  sunLon: number,
  mapW: number,
  mapH: number,
  centerLon?: number
): AuroraOvalPaths {
  var clampedKp = Math.max(0, Math.min(9, kp));
  var intensity = Math.max(0.28, Math.min(0.95, 0.28 + (clampedKp / 8) * 0.67));
  return {
    northOuter: buildAuroraBandPolygon(80.8, -72.8, clampedKp, sunLon, 1.45, mapW, mapH, centerLon),
    northCore: buildAuroraBandPolygon(80.8, -72.8, clampedKp, sunLon, 0.72, mapW, mapH, centerLon),
    southOuter: buildAuroraBandPolygon(-80.8, 107.2, clampedKp, sunLon, 1.45, mapW, mapH, centerLon),
    southCore: buildAuroraBandPolygon(-80.8, 107.2, clampedKp, sunLon, 0.72, mapW, mapH, centerLon),
    intensity: intensity,
    isStorm: clampedKp >= 5,
  };
}
