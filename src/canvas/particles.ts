import type { WeatherKind } from '../types';
import { rgbString } from './skyPalettes';
import type { SkyState } from './skyPalettes';

interface Star {
  x: number;
  y: number;
  r: number;
  phase: number;
  speed: number;
  baseAlpha: number;
  sparkle: boolean;
}

interface ShootingStar {
  active: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  duration: number;
  cooldown: number;
}

interface CloudLobe {
  ox: number;
  oy: number;
  rx: number;
  ry: number;
}

interface CloudCluster {
  x: number;
  y: number;
  speed: number;
  alpha: number;
  scale: number;
  lobes: CloudLobe[];
}

interface WindStream {
  x: number;
  y: number;
  len: number;
  amp: number;
  speed: number;
  alpha: number;
  phase: number;
}

interface Drop {
  x: number;
  y: number;
  len: number;
  speed: number;
  alpha: number;
  depth: number; // 0 = far, 1 = near
  sway: number;
}

interface FogBand {
  x: number;
  y: number;
  w: number;
  h: number;
  speed: number;
  alpha: number;
}

export interface ParticleScene {
  stars: Star[];
  shootingStar: ShootingStar;
  clouds: CloudCluster[];
  winds: WindStream[];
  drops: Drop[];
  fogBands: FogBand[];
  flashAlpha: number;
  nextFlashIn: number;
  rand: () => number;
}

function seededRand(seed: number): () => number {
  var s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return function () {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

export function createParticleScene(): ParticleScene {
  var rand = seededRand(42019);

  var stars: Star[] = [];
  for (var i = 0; i < 92; i++) {
    var big = i < 14;
    stars.push({
      x: rand(),
      y: rand() * 0.64,
      r: big ? 1.25 + rand() * 0.65 : 0.55 + rand() * 0.85,
      phase: rand() * Math.PI * 2,
      speed: 0.7 + rand() * 1.6,
      baseAlpha: big ? 0.75 + rand() * 0.25 : 0.35 + rand() * 0.55,
      sparkle: big,
    });
  }

  var clouds: CloudCluster[] = [];
  for (var j = 0; j < 8; j++) {
    var lobes: CloudLobe[] = [
      { ox: -0.075, oy: 0.012, rx: 0.075, ry: 0.038 },
      { ox: -0.025, oy: -0.016, rx: 0.095, ry: 0.052 },
      { ox: 0.04, oy: -0.008, rx: 0.088, ry: 0.046 },
      { ox: 0.092, oy: 0.016, rx: 0.068, ry: 0.034 },
    ];
    clouds.push({
      x: (j / 8) * 1.35 - 0.15 + (rand() - 0.5) * 0.1,
      y: 0.08 + (j % 4) * 0.11 + rand() * 0.05,
      speed: 0.014 + rand() * 0.016,
      alpha: 0.55 + rand() * 0.35,
      scale: 0.75 + rand() * 0.55,
      lobes: lobes,
    });
  }

  var winds: WindStream[] = [];
  for (var w = 0; w < 7; w++) {
    winds.push({
      x: rand() * 1.4 - 0.2,
      y: 0.12 + rand() * 0.58,
      len: 0.16 + rand() * 0.2,
      amp: 0.008 + rand() * 0.016,
      speed: 0.09 + rand() * 0.09,
      alpha: 0.14 + rand() * 0.18,
      phase: rand() * Math.PI * 2,
    });
  }

  var drops: Drop[] = [];
  for (var k = 0; k < 105; k++) {
    var depth = rand();
    drops.push({
      x: rand(),
      y: rand(),
      len: 0.028 + depth * 0.045,
      speed: 0.45 + depth * 0.58,
      alpha: 0.24 + depth * 0.44,
      depth: depth,
      sway: rand() * Math.PI * 2,
    });
  }

  var fogBands: FogBand[] = [];
  for (var f = 0; f < 5; f++) {
    fogBands.push({
      x: rand() * 1.2 - 0.1,
      y: 0.42 + f * 0.12,
      w: 0.48 + rand() * 0.28,
      h: 0.12 + rand() * 0.08,
      speed: 0.018 + rand() * 0.02,
      alpha: 0.22 + rand() * 0.14,
    });
  }

  return {
    stars: stars,
    shootingStar: {
      active: false,
      x: 0.2,
      y: 0.15,
      vx: 0.45,
      vy: 0.18,
      age: 0,
      duration: 0.75,
      cooldown: 4.5,
    },
    clouds: clouds,
    winds: winds,
    drops: drops,
    fogBands: fogBands,
    flashAlpha: 0,
    nextFlashIn: 7 + rand() * 9,
    rand: rand,
  };
}

function drawMoonHalo(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  visibility: number,
  elapsed: number,
  moonPhase: number
): void {
  if (visibility <= 0.04) return;

  // Illumination fraction: 0 at New Moon (0.0), 1 at Full Moon (0.5)
  var illum = 0.5 * (1 - Math.cos(moonPhase * Math.PI * 2));
  var glowScale = 0.35 + 0.65 * illum;
  var breath = 0.94 + 0.06 * Math.sin(elapsed * 0.7);
  var haloR = radius * (5.2 + 1.8 * illum) * breath;

  // Soft outer moonlight atmosphere scaled by illumination (crisp moon disc is rendered as vector SVG)
  var halo = ctx.createRadialGradient(x, y, radius * 0.35, x, y, haloR);
  halo.addColorStop(
    0,
    'rgba(220,235,255,' + (0.42 * visibility * glowScale).toFixed(3) + ')'
  );
  halo.addColorStop(
    0.28,
    'rgba(155,192,250,' + (0.18 * visibility * glowScale).toFixed(3) + ')'
  );
  halo.addColorStop(1, 'rgba(120,165,240,0)');
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(x, y, haloR, 0, Math.PI * 2);
  ctx.fill();
}

function drawSun(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  visibility: number,
  elapsed: number,
  glowRGB: [number, number, number]
): void {
  if (visibility <= 0.04) return;

  var breath = 0.95 + 0.05 * Math.sin(elapsed * 0.9);
  var outerR = radius * 8.0 * breath;

  // Warm atmospheric bloom
  var halo = ctx.createRadialGradient(x, y, radius * 0.3, x, y, outerR);
  halo.addColorStop(0, rgbString(glowRGB, 0.72 * visibility));
  halo.addColorStop(0.24, rgbString(glowRGB, 0.32 * visibility));
  halo.addColorStop(0.6, rgbString(glowRGB, 0.09 * visibility));
  halo.addColorStop(1, rgbString(glowRGB, 0));
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(x, y, outerR, 0, Math.PI * 2);
  ctx.fill();

  // Slowly rotating subtle light rays
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(elapsed * 0.06);
  var rayCount = 10;
  for (var i = 0; i < rayCount; i++) {
    var angle = (i / rayCount) * Math.PI * 2;
    ctx.save();
    ctx.rotate(angle);
    var rayGrad = ctx.createLinearGradient(0, 0, radius * 4.6, 0);
    rayGrad.addColorStop(0, rgbString(glowRGB, 0.24 * visibility));
    rayGrad.addColorStop(1, rgbString(glowRGB, 0));
    ctx.fillStyle = rayGrad;
    ctx.beginPath();
    ctx.moveTo(0, -radius * 0.22);
    ctx.lineTo(radius * 4.6, -radius * 0.65);
    ctx.lineTo(radius * 4.6, radius * 0.65);
    ctx.lineTo(0, radius * 0.22);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
  ctx.restore();

  // Bright solar core
  var core = ctx.createRadialGradient(x, y, 0, x, y, radius * 1.15);
  core.addColorStop(0, 'rgba(255,254,242,' + (0.95 * visibility).toFixed(3) + ')');
  core.addColorStop(0.65, rgbString(glowRGB, 0.82 * visibility));
  core.addColorStop(1, rgbString(glowRGB, 0));
  ctx.fillStyle = core;
  ctx.beginPath();
  ctx.arc(x, y, radius * 1.15, 0, Math.PI * 2);
  ctx.fill();
}

export function renderAtmosphereFrame(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  dt: number,
  elapsed: number,
  sky: SkyState,
  weatherKind: WeatherKind,
  cloudCover: number,
  windKmh: number,
  moonPhase: number,
  isNightQuiet: boolean,
  scene: ParticleScene
): void {
  var minDim = Math.min(width, height);
  var windFactor = Math.max(0.6, Math.min(3.0, 0.65 + windKmh / 18));

  // 1. Vertical 3-stop atmospheric sky gradient
  var grad = ctx.createLinearGradient(0, 0, 0, height);
  grad.addColorStop(0, rgbString(sky.top));
  grad.addColorStop(0.52, rgbString(sky.mid));
  grad.addColorStop(1, rgbString(sky.bottom));
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, height);

  // 2. Twinkling starfield + occasional shooting star (night / dusk)
  if (sky.starAlpha > 0.03) {
    for (var i = 0; i < scene.stars.length; i++) {
      var st = scene.stars[i];
      var twinkle = 0.45 + 0.55 * Math.sin(elapsed * st.speed + st.phase);
      var a = sky.starAlpha * st.baseAlpha * twinkle;
      if (a <= 0.03) continue;

      var sx = st.x * width;
      var sy = st.y * height;
      ctx.fillStyle = 'rgba(235,245,255,' + a.toFixed(3) + ')';
      ctx.beginPath();
      ctx.arc(sx, sy, st.r, 0, Math.PI * 2);
      ctx.fill();

      // Subtle 4-point glint on the brightest stars
      if (st.sparkle && a > 0.45) {
        var glintLen = st.r * 3.1 * twinkle;
        ctx.strokeStyle = 'rgba(235,245,255,' + (a * 0.45).toFixed(3) + ')';
        ctx.lineWidth = 0.7;
        ctx.beginPath();
        ctx.moveTo(sx - glintLen, sy);
        ctx.lineTo(sx + glintLen, sy);
        ctx.moveTo(sx, sy - glintLen);
        ctx.lineTo(sx, sy + glintLen);
        ctx.stroke();
      }
    }

    // Occasional gentle shooting star on clear/partly cloudy nights
    if (!isNightQuiet && sky.starAlpha > 0.35 && (weatherKind === 'clear' || weatherKind === 'partly-cloudy')) {
      var ss = scene.shootingStar;
      if (!ss.active) {
        ss.cooldown -= dt;
        if (ss.cooldown <= 0) {
          ss.active = true;
          ss.age = 0;
          ss.duration = 0.65 + scene.rand() * 0.35;
          ss.x = 0.15 + scene.rand() * 0.55;
          ss.y = 0.06 + scene.rand() * 0.24;
          ss.vx = 0.38 + scene.rand() * 0.22;
          ss.vy = 0.12 + scene.rand() * 0.1;
          ss.cooldown = 9 + scene.rand() * 11;
        }
      } else {
        ss.age += dt;
        var prog = ss.age / ss.duration;
        if (prog >= 1) {
          ss.active = false;
        } else {
          var hx = (ss.x + ss.vx * ss.age) * width;
          var hy = (ss.y + ss.vy * ss.age) * height;
          var tail = 0.14;
          var tx = (ss.x + ss.vx * Math.max(0, ss.age - tail)) * width;
          var ty = (ss.y + ss.vy * Math.max(0, ss.age - tail)) * height;
          var ssAlpha = Math.sin(prog * Math.PI) * sky.starAlpha * 0.85;
          var ssGrad = ctx.createLinearGradient(hx, hy, tx, ty);
          ssGrad.addColorStop(0, 'rgba(255,255,255,' + ssAlpha.toFixed(3) + ')');
          ssGrad.addColorStop(1, 'rgba(200,225,255,0)');
          ctx.strokeStyle = ssGrad;
          ctx.lineWidth = 1.4;
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(hx, hy);
          ctx.lineTo(tx, ty);
          ctx.stroke();
        }
      }
    }
  }

  // 3. Visible Moon (night) or Sun (day) — only when sky is clear or partly cloudy
  var celestialObscure =
    weatherKind === 'clear'
      ? 1.0
      : weatherKind === 'partly-cloudy'
        ? 0.8
        : 0;

  var orbX = sky.orbX * width;
  var orbY = sky.orbY * height;
  var orbRadius = minDim * 0.056;

  if (sky.isNight > 0.15) {
    drawMoonHalo(
      ctx,
      orbX,
      orbY,
      orbRadius,
      sky.isNight * celestialObscure,
      elapsed,
      moonPhase
    );
  }
  if (sky.isNight < 0.85) {
    drawSun(
      ctx,
      orbX,
      orbY,
      orbRadius * 1.05,
      (1 - sky.isNight) * celestialObscure,
      elapsed,
      sky.glow
    );
  }

  // 4. Multi-puff drifting clouds (speed scaled by real wind)
  var weatherCloudFloor =
    weatherKind === 'cloudy' ||
    weatherKind === 'fog' ||
    weatherKind === 'rain' ||
    weatherKind === 'storm'
      ? 0.92
      : weatherKind === 'drizzle' || weatherKind === 'snow'
        ? 0.8
        : weatherKind === 'partly-cloudy'
          ? 0.62
          : 0.34;
  var effectiveCloudFactor = Math.max(cloudCover / 100, weatherCloudFloor);
  var visibleClouds = Math.max(3, Math.round(scene.clouds.length * effectiveCloudFactor));

  for (var c = 0; c < visibleClouds; c++) {
    var cl = scene.clouds[c];
    cl.x += cl.speed * windFactor * dt;
    if (cl.x > 1.24) {
      cl.x = -0.26;
    }

    var baseCx = cl.x * width;
    var baseCy = (weatherKind === 'fog' ? cl.y + 0.18 : cl.y) * height;
    var cAlpha = sky.cloudAlpha * cl.alpha * (0.55 + 0.45 * effectiveCloudFactor);

    for (var l = 0; l < cl.lobes.length; l++) {
      var lobe = cl.lobes[l];
      var lx = baseCx + lobe.ox * width * cl.scale;
      var ly = baseCy + lobe.oy * height * cl.scale;
      var rx = lobe.rx * width * cl.scale;
      var ry = lobe.ry * height * cl.scale;

      ctx.save();
      ctx.translate(lx, ly);
      ctx.scale(1, ry / rx);
      var cGrad = ctx.createRadialGradient(0, 0, rx * 0.1, 0, 0, rx);
      cGrad.addColorStop(0, rgbString(sky.cloudTint, cAlpha));
      cGrad.addColorStop(0.55, rgbString(sky.cloudTint, cAlpha * 0.48));
      cGrad.addColorStop(1, rgbString(sky.cloudTint, 0));
      ctx.fillStyle = cGrad;
      ctx.beginPath();
      ctx.arc(0, 0, rx, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  // 5. Flowing wind ribbons / atmospheric breeze wisps
  var windCount =
    windKmh >= 24 ? 7 : windKmh >= 12 ? 5 : windKmh >= 5 ? 3 : 2;
  var windAlphaBoost = Math.min(1.5, 0.65 + windKmh / 24);
  ctx.lineCap = 'round';

  for (var w = 0; w < windCount; w++) {
    var ws = scene.winds[w];
    ws.x += ws.speed * windFactor * dt;
    if (ws.x > 1.25) {
      ws.x = -ws.len - 0.12;
      ws.y = 0.1 + ((w * 0.13 + elapsed * 0.03) % 0.56);
    }

    var wx1 = ws.x * width;
    var wx2 = (ws.x + ws.len) * width;
    var wy = ws.y * height;
    var wave = Math.sin(elapsed * 1.4 + ws.phase) * ws.amp * height;
    var wAlpha = ws.alpha * windAlphaBoost * (isNightQuiet ? 0.5 : 1);

    var wRgb = sky.isNight < 0.35 ? '255,255,255' : '226,238,255';
    var wGrad = ctx.createLinearGradient(wx1, wy, wx2, wy);
    wGrad.addColorStop(0, 'rgba(' + wRgb + ',0)');
    wGrad.addColorStop(0.45, 'rgba(' + wRgb + ',' + Math.min(0.6, wAlpha * (sky.isNight < 0.35 ? 1.45 : 1)).toFixed(3) + ')');
    wGrad.addColorStop(0.8, 'rgba(' + wRgb + ',' + Math.min(0.4, wAlpha * 0.8).toFixed(3) + ')');
    wGrad.addColorStop(1, 'rgba(' + wRgb + ',0)');

    ctx.strokeStyle = wGrad;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(wx1, wy);
    ctx.quadraticCurveTo((wx1 + wx2) * 0.5, wy + wave, wx2, wy - wave * 0.45);
    ctx.stroke();
  }

  // 6. Rolling low-altitude mist banks for Fog
  if (weatherKind === 'fog') {
    for (var f = 0; f < scene.fogBands.length; f++) {
      var fb = scene.fogBands[f];
      fb.x += fb.speed * windFactor * dt;
      if (fb.x - fb.w * 0.5 > 1.15) {
        fb.x = -fb.w * 0.5 - 0.1;
      }
      var fx = fb.x * width;
      var fy = fb.y * height;
      var frx = fb.w * width * 0.5;
      var fry = fb.h * height;
      ctx.save();
      ctx.translate(fx, fy);
      ctx.scale(1, fry / frx);
      var fGrad = ctx.createRadialGradient(0, 0, frx * 0.1, 0, 0, frx);
      fGrad.addColorStop(0, 'rgba(218,230,242,' + fb.alpha.toFixed(3) + ')');
      fGrad.addColorStop(0.6, 'rgba(205,220,235,' + (fb.alpha * 0.42).toFixed(3) + ')');
      fGrad.addColorStop(1, 'rgba(205,220,235,0)');
      ctx.fillStyle = fGrad;
      ctx.beginPath();
      ctx.arc(0, 0, frx, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  // 7. Precipitation: Rain / Drizzle / Storm / Snow
  if (weatherKind === 'drizzle' || weatherKind === 'rain' || weatherKind === 'storm') {
    var dropCount = weatherKind === 'drizzle' ? 48 : weatherKind === 'rain' ? 84 : 105;
    var speedScale = weatherKind === 'drizzle' ? 0.72 : weatherKind === 'storm' ? 1.28 : 1.05;
    var slant = 0.14 + Math.min(0.24, windKmh / 100);
    ctx.lineCap = 'round';

    for (var r = 0; r < dropCount; r++) {
      var d = scene.drops[r];
      d.y += d.speed * speedScale * dt;
      d.x -= d.speed * slant * dt;
      if (d.y > 1.08) {
        d.y = -0.06;
        d.x = ((d.x % 1) + 1) % 1;
      }
      if (d.x < -0.06) {
        d.x += 1.12;
      }

      var x1 = d.x * width;
      var y1 = d.y * height;
      var dy = d.len * height;
      var dx = -dy * slant * 1.15;
      ctx.lineWidth = weatherKind === 'drizzle' ? 0.9 : 0.85 + d.depth * 0.9;
      ctx.strokeStyle =
        sky.isNight < 0.35
          ? 'rgba(56,92,138,' + (d.alpha * 0.72).toFixed(3) + ')'
          : 'rgba(214,234,255,' + d.alpha.toFixed(3) + ')';
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x1 + dx, y1 + dy);
      ctx.stroke();
    }

    // Periodic soft sheet lightning for thunderstorms (disabled during quiet hours)
    if (weatherKind === 'storm' && !isNightQuiet) {
      scene.nextFlashIn -= dt;
      if (scene.nextFlashIn <= 0) {
        scene.flashAlpha = 0.28;
        scene.nextFlashIn = 6 + scene.rand() * 10;
      }
      if (scene.flashAlpha > 0.005) {
        ctx.fillStyle = 'rgba(225,238,255,' + scene.flashAlpha.toFixed(3) + ')';
        ctx.fillRect(0, 0, width, height);
        scene.flashAlpha *= Math.pow(0.03, dt);
      }
    }
  } else if (weatherKind === 'snow') {
    for (var s = 0; s < 78; s++) {
      var fl = scene.drops[s];
      fl.y += (0.09 + fl.depth * 0.12) * dt;
      fl.x += (Math.sin(elapsed * 1.1 + fl.sway) * 0.024 + 0.01 * windFactor) * dt;
      if (fl.y > 1.05) {
        fl.y = -0.04;
      }
      if (fl.x > 1.05) fl.x -= 1.1;
      if (fl.x < -0.05) fl.x += 1.1;

      var fx2 = fl.x * width;
      var fy2 = fl.y * height;
      var fr = 1.2 + fl.depth * 2.1;
      var flGrad = ctx.createRadialGradient(fx2, fy2, 0, fx2, fy2, fr * 1.6);
      flGrad.addColorStop(0, 'rgba(255,255,255,' + Math.min(0.95, fl.alpha * 1.35).toFixed(3) + ')');
      flGrad.addColorStop(1, 'rgba(224,242,255,0)');
      ctx.fillStyle = flGrad;
      ctx.beginPath();
      ctx.arc(fx2, fy2, fr * 1.6, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // 8. Subtle bottom scrim only at night/twilight so daytime stays bright & airy
  if (sky.isNight > 0.15) {
    var scrimAlpha = 0.28 * sky.isNight;
    var scrim = ctx.createLinearGradient(0, height * 0.44, 0, height);
    scrim.addColorStop(0, 'rgba(6,11,22,0)');
    scrim.addColorStop(1, 'rgba(6,11,22,' + scrimAlpha.toFixed(3) + ')');
    ctx.fillStyle = scrim;
    ctx.fillRect(0, 0, width, height);
  }
}
