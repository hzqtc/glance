var DEG2RAD = Math.PI / 180;
var RAD2DEG = 180 / Math.PI;

/** Pacific-centered projection: 155°E center -> left edge is -25°W (mid-Atlantic), 82°N to 58°S. */
export var MAP_CENTER_LON = 155;
export var MAP_LEFT_LON = MAP_CENTER_LON - 180; // -25
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

/** Projects (lon, lat) onto an equirectangular canvas centered at MAP_CENTER_LON (155°E). */
export function projectLonLat(
  lon: number,
  lat: number,
  mapW: number,
  mapH: number
): ProjectedPoint {
  var shifted = ((lon - MAP_LEFT_LON) % 360 + 360) % 360;
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
  mapH: number
): { nightPath: string; twilightPath: string; terminatorLine: string } {
  // Guard exact equinox (0° declination) to keep tan(sunLat) well-behaved
  var effLat = sunLat;
  if (Math.abs(effLat) < 0.15) {
    effLat = effLat < 0 ? -0.15 : 0.15;
  }
  var tanSun = Math.tan(effLat * DEG2RAD);
  var nightPoleY = effLat >= 0 ? mapH : 0;

  var steps = 120;
  var lineParts: string[] = [];
  var nightParts: string[] = [];
  var twiUpper: ProjectedPoint[] = [];
  var twiLower: ProjectedPoint[] = [];

  for (var i = 0; i <= steps; i++) {
    var frac = i / steps;
    var lon = MAP_LEFT_LON + frac * 360;
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
  mapH: number
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
  var midPt: ProjectedPoint = projectLonLat(lon1, lat1, mapW, mapH);

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
    var proj = projectLonLat(lon, lat, mapW, mapH);

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
