import type { WeatherKind } from '../types';

type RGB = [number, number, number];

export interface SkyState {
  top: RGB;
  mid: RGB;
  bottom: RGB;
  glow: RGB;
  starAlpha: number;
  cloudTint: RGB;
  cloudAlpha: number;
  orbX: number; // 0..1 normalized X
  orbY: number; // 0..1 normalized Y
  isNight: number; // 0 = day sun, 1 = night moon
}

type BaseSky = Omit<SkyState, 'orbX' | 'orbY'>;

const NIGHT: BaseSky = {
  top: [6, 11, 26],
  mid: [14, 26, 56],
  bottom: [26, 46, 84],
  glow: [165, 198, 255],
  starAlpha: 0.95,
  cloudTint: [118, 152, 212],
  cloudAlpha: 0.3,
  isNight: 1,
};

const DAWN: BaseSky = {
  top: [22, 36, 78],
  mid: [94, 78, 128],
  bottom: [224, 144, 108],
  glow: [255, 196, 134],
  starAlpha: 0.25,
  cloudTint: [252, 200, 174],
  cloudAlpha: 0.44,
  isNight: 0.25,
};

const MORNING: BaseSky = {
  top: [96, 166, 232],
  mid: [148, 202, 246],
  bottom: [216, 236, 252],
  glow: [255, 246, 202],
  starAlpha: 0.0,
  cloudTint: [255, 255, 255],
  cloudAlpha: 0.68,
  isNight: 0,
};

const DAY: BaseSky = {
  top: [82, 158, 232],
  mid: [138, 198, 246],
  bottom: [206, 232, 250],
  glow: [255, 248, 212],
  starAlpha: 0.0,
  cloudTint: [255, 255, 255],
  cloudAlpha: 0.68,
  isNight: 0,
};

const SUNSET: BaseSky = {
  top: [24, 38, 88],
  mid: [128, 70, 112],
  bottom: [232, 126, 82],
  glow: [255, 176, 102],
  starAlpha: 0.14,
  cloudTint: [255, 186, 152],
  cloudAlpha: 0.46,
  isNight: 0.2,
};

const DUSK: BaseSky = {
  top: [12, 20, 48],
  mid: [38, 52, 92],
  bottom: [94, 76, 118],
  glow: [192, 166, 224],
  starAlpha: 0.6,
  cloudTint: [148, 152, 202],
  cloudAlpha: 0.34,
  isNight: 0.8,
};

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpRGB(a: RGB, b: RGB, t: number): RGB {
  return [
    lerp(a[0], b[0], t),
    lerp(a[1], b[1], t),
    lerp(a[2], b[2], t),
  ];
}

function blendBase(a: BaseSky, b: BaseSky, t: number): BaseSky {
  var k = clamp01(t);
  return {
    top: lerpRGB(a.top, b.top, k),
    mid: lerpRGB(a.mid, b.mid, k),
    bottom: lerpRGB(a.bottom, b.bottom, k),
    glow: lerpRGB(a.glow, b.glow, k),
    starAlpha: lerp(a.starAlpha, b.starAlpha, k),
    cloudTint: lerpRGB(a.cloudTint, b.cloudTint, k),
    cloudAlpha: lerp(a.cloudAlpha, b.cloudAlpha, k),
    isNight: lerp(a.isNight, b.isNight, k),
  };
}

export function computeTargetSky(
  minutesSinceMidnight: number,
  sunriseMin: number,
  sunsetMin: number,
  weatherKind: WeatherKind,
  cloudCover: number
): SkyState {
  var m = minutesSinceMidnight;
  var sr = sunriseMin;
  var ss = sunsetMin;
  var dayLen = Math.max(240, ss - sr);

  var base: BaseSky;
  // Keep celestial body visible in the open upper sky center-right
  var orbX = 0.56;
  var orbY = 0.19;

  if (m < sr - 55) {
    base = NIGHT;
    orbX = 0.56;
    orbY = 0.18;
  } else if (m < sr - 10) {
    base = blendBase(NIGHT, DAWN, (m - (sr - 55)) / 45);
    orbX = 0.44;
    orbY = 0.34;
  } else if (m < sr + 50) {
    base = blendBase(DAWN, MORNING, (m - (sr - 10)) / 60);
    var p = (m - (sr - 10)) / 60;
    orbX = lerp(0.42, 0.48, p);
    orbY = lerp(0.34, 0.22, p);
  } else if (m < sr + dayLen * 0.32) {
    base = blendBase(
      MORNING,
      DAY,
      (m - (sr + 50)) / Math.max(30, dayLen * 0.32 - 50)
    );
    var dp1 = clamp01((m - sr) / dayLen);
    orbX = lerp(0.42, 0.64, dp1);
    orbY = 0.28 - Math.sin(dp1 * Math.PI) * 0.12;
  } else if (m < ss - 65) {
    base = DAY;
    var dp2 = clamp01((m - sr) / dayLen);
    orbX = lerp(0.42, 0.64, dp2);
    orbY = 0.28 - Math.sin(dp2 * Math.PI) * 0.12;
  } else if (m < ss + 5) {
    base = blendBase(DAY, SUNSET, (m - (ss - 65)) / 70);
    var sp = clamp01((m - (ss - 65)) / 70);
    orbX = lerp(0.58, 0.62, sp);
    orbY = lerp(0.22, 0.36, sp);
  } else if (m < ss + 45) {
    base = blendBase(SUNSET, DUSK, (m - (ss + 5)) / 40);
    orbX = 0.6;
    orbY = 0.34;
  } else if (m < ss + 90) {
    base = blendBase(DUSK, NIGHT, (m - (ss + 45)) / 45);
    orbX = 0.56;
    orbY = 0.2;
  } else {
    base = NIGHT;
    orbX = 0.56;
    orbY = 0.18;
  }

  var state: SkyState = {
    top: base.top.slice() as RGB,
    mid: base.mid.slice() as RGB,
    bottom: base.bottom.slice() as RGB,
    glow: base.glow.slice() as RGB,
    starAlpha: base.starAlpha,
    cloudTint: base.cloudTint.slice() as RGB,
    cloudAlpha: base.cloudAlpha,
    orbX: orbX,
    orbY: orbY,
    isNight: base.isNight,
  };

  var isNightish = m < sr - 15 || m > ss + 35;

  if (weatherKind === 'cloudy' || weatherKind === 'fog') {
    var overcastTop: RGB = isNightish ? [14, 22, 38] : [142, 166, 194];
    var overcastMid: RGB = isNightish ? [26, 38, 58] : [182, 200, 218];
    var overcastBot: RGB = isNightish ? [42, 54, 76] : [218, 228, 238];
    var amount = weatherKind === 'fog' ? 0.68 : 0.54;
    state.top = lerpRGB(state.top, overcastTop, amount);
    state.mid = lerpRGB(state.mid, overcastMid, amount);
    state.bottom = lerpRGB(state.bottom, overcastBot, amount);
    state.starAlpha = 0;
    state.cloudAlpha = Math.max(state.cloudAlpha, isNightish ? 0.52 : 0.68);
  } else if (weatherKind === 'drizzle' || weatherKind === 'rain') {
    var rainTop: RGB = isNightish ? [10, 18, 34] : [116, 144, 174];
    var rainMid: RGB = isNightish ? [18, 32, 54] : [156, 178, 202];
    var rainBot: RGB = isNightish ? [28, 46, 72] : [196, 210, 226];
    state.top = lerpRGB(state.top, rainTop, 0.72);
    state.mid = lerpRGB(state.mid, rainMid, 0.72);
    state.bottom = lerpRGB(state.bottom, rainBot, 0.72);
    state.starAlpha = 0;
    state.cloudAlpha = Math.max(state.cloudAlpha, isNightish ? 0.54 : 0.66);
  } else if (weatherKind === 'storm') {
    state.top = lerpRGB(state.top, isNightish ? [10, 14, 28] : [92, 114, 144], 0.8);
    state.mid = lerpRGB(state.mid, isNightish ? [22, 28, 52] : [132, 152, 178], 0.8);
    state.bottom = lerpRGB(state.bottom, isNightish ? [38, 46, 72] : [174, 190, 210], 0.8);
    state.starAlpha = 0;
    state.cloudAlpha = 0.64;
  } else if (weatherKind === 'snow') {
    var snowTop: RGB = isNightish ? [18, 28, 52] : [150, 176, 206];
    var snowMid: RGB = isNightish ? [34, 48, 76] : [190, 208, 228];
    var snowBot: RGB = isNightish ? [56, 74, 106] : [224, 234, 244];
    state.top = lerpRGB(state.top, snowTop, 0.6);
    state.mid = lerpRGB(state.mid, snowMid, 0.6);
    state.bottom = lerpRGB(state.bottom, snowBot, 0.6);
    state.starAlpha = 0;
  }

  var clearFrac = clamp01(1 - cloudCover / 100);
  state.starAlpha *= 0.3 + 0.7 * clearFrac;

  return state;
}

export function lerpSkyState(cur: SkyState, target: SkyState, factor: number): SkyState {
  var k = clamp01(factor);
  return {
    top: lerpRGB(cur.top, target.top, k),
    mid: lerpRGB(cur.mid, target.mid, k),
    bottom: lerpRGB(cur.bottom, target.bottom, k),
    glow: lerpRGB(cur.glow, target.glow, k),
    starAlpha: lerp(cur.starAlpha, target.starAlpha, k),
    cloudTint: lerpRGB(cur.cloudTint, target.cloudTint, k),
    cloudAlpha: lerp(cur.cloudAlpha, target.cloudAlpha, k),
    orbX: lerp(cur.orbX, target.orbX, k),
    orbY: lerp(cur.orbY, target.orbY, k),
    isNight: lerp(cur.isNight, target.isNight, k),
  };
}

export function rgbString(c: RGB, alpha?: number): string {
  var r = Math.round(c[0]);
  var g = Math.round(c[1]);
  var b = Math.round(c[2]);
  if (typeof alpha === 'number') {
    return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha.toFixed(3) + ')';
  }
  return 'rgb(' + r + ',' + g + ',' + b + ')';
}

type SkyThemeMode = 'day' | 'twilight' | 'night';

export function getSkyThemeMode(
  minutesSinceMidnight: number,
  sunriseMin: number,
  sunsetMin: number
): SkyThemeMode {
  if (minutesSinceMidnight < sunriseMin - 45 || minutesSinceMidnight > sunsetMin + 55) {
    return 'night';
  }
  if (
    minutesSinceMidnight < sunriseMin + 35 ||
    minutesSinceMidnight > sunsetMin - 55
  ) {
    return 'twilight';
  }
  return 'day';
}

