import { useEffect, useRef } from 'preact/hooks';
import type { WeatherKind } from '../types';
import { computeTargetSky, lerpSkyState } from './skyPalettes';
import type { SkyState } from './skyPalettes';
import { createParticleScene, renderAtmosphereFrame } from './particles';

interface AtmosphereCanvasProps {
  minutesSinceMidnight: number;
  sunriseMinutes: number;
  sunsetMinutes: number;
  weatherKind: WeatherKind;
  cloudCover: number;
  windKmh: number;
  moonPhase: number;
  isNightQuiet: boolean;
  animated: boolean;
}

function buildMoonLitPath(moonPhase: number, r: number): string {
  var waxing = moonPhase < 0.5;
  var k = Math.cos(moonPhase * Math.PI * 2);
  var rx = Math.abs(k) * r;
  var outerSweep = waxing ? 1 : 0;

  if (rx < 0.4) {
    // Exact First or Last Quarter
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

  var innerSweep: number;
  if (waxing) {
    innerSweep = k > 0 ? 0 : 1;
  } else {
    innerSweep = k > 0 ? 1 : 0;
  }

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

function skyCloseEnough(a: SkyState, b: SkyState): boolean {
  return (
    Math.abs(a.top[0] - b.top[0]) < 0.25 &&
    Math.abs(a.top[1] - b.top[1]) < 0.25 &&
    Math.abs(a.top[2] - b.top[2]) < 0.25 &&
    Math.abs(a.mid[0] - b.mid[0]) < 0.25 &&
    Math.abs(a.mid[1] - b.mid[1]) < 0.25 &&
    Math.abs(a.mid[2] - b.mid[2]) < 0.25 &&
    Math.abs(a.bottom[0] - b.bottom[0]) < 0.25 &&
    Math.abs(a.bottom[1] - b.bottom[1]) < 0.25 &&
    Math.abs(a.bottom[2] - b.bottom[2]) < 0.25 &&
    Math.abs(a.starAlpha - b.starAlpha) < 0.002 &&
    Math.abs(a.cloudAlpha - b.cloudAlpha) < 0.002 &&
    Math.abs(a.isNight - b.isNight) < 0.002 &&
    Math.abs(a.orbX - b.orbX) < 0.001 &&
    Math.abs(a.orbY - b.orbY) < 0.001
  );
}

export function AtmosphereCanvas(props: AtmosphereCanvasProps) {
  var canvasRef = useRef<HTMLCanvasElement>(null);
  var sceneRef = useRef<ReturnType<typeof createParticleScene> | null>(null);
  var propsRef = useRef<AtmosphereCanvasProps>(props);
  propsRef.current = props;

  if (!sceneRef.current) {
    sceneRef.current = createParticleScene();
  }

  // Animated mode: smooth 30 FPS RAF loop.
  // Static mode: 0 FPS idle (no RAF loop at all — keeps iPad mini 2 completely cool).
  useEffect(
    function () {
      var canvas = canvasRef.current;
      if (!canvas) {
        return;
      }
      var ctx = canvas.getContext('2d');
      if (!ctx) {
        return;
      }
      var scene = sceneRef.current!;

      function syncCanvasSize() {
        if (!canvas) return;
        var w = Math.min(960, Math.max(400, Math.round(window.innerWidth * 0.65)));
        var h = Math.min(720, Math.max(300, Math.round(window.innerHeight * 0.65)));
        if (canvas.width !== w || canvas.height !== h) {
          canvas.width = w;
          canvas.height = h;
        }
      }

      function drawSingleStaticFrame() {
        if (!canvas || !ctx) return;
        syncCanvasSize();
        var p = propsRef.current;
        var sky = computeTargetSky(
          p.minutesSinceMidnight,
          p.sunriseMinutes,
          p.sunsetMinutes,
          p.weatherKind,
          p.cloudCover
        );
        renderAtmosphereFrame(
          ctx,
          canvas.width,
          canvas.height,
          0,
          0,
          sky,
          p.weatherKind,
          p.cloudCover,
          p.windKmh,
          p.moonPhase,
          p.isNightQuiet,
          scene
        );
      }

      if (!props.animated) {
        drawSingleStaticFrame();
        window.addEventListener('resize', drawSingleStaticFrame);
        return function () {
          window.removeEventListener('resize', drawSingleStaticFrame);
        };
      }

      var p0 = propsRef.current;
      var targetSky: SkyState = computeTargetSky(
        p0.minutesSinceMidnight,
        p0.sunriseMinutes,
        p0.sunsetMinutes,
        p0.weatherKind,
        p0.cloudCover
      );
      var currentSky: SkyState = targetSky;
      var skySettled = true;
      var lastMin = p0.minutesSinceMidnight;
      var lastSunrise = p0.sunriseMinutes;
      var lastSunset = p0.sunsetMinutes;
      var lastKind = p0.weatherKind;
      var lastCloud = p0.cloudCover;

      syncCanvasSize();
      window.addEventListener('resize', syncCanvasSize);

      var rafId = 0;
      var lastRenderTime = 0;
      var startTime = performance.now();

      function loop(now: number) {
        rafId = window.requestAnimationFrame(loop);
        var p = propsRef.current;
        var targetFrameMs = 1000 / 30;

        if (lastRenderTime !== 0 && now - lastRenderTime < targetFrameMs) {
          return;
        }

        var dt = lastRenderTime === 0 ? 0.033 : Math.min(0.25, (now - lastRenderTime) / 1000);
        lastRenderTime = now;
        var elapsed = (now - startTime) / 1000;

        if (
          p.minutesSinceMidnight !== lastMin ||
          p.sunriseMinutes !== lastSunrise ||
          p.sunsetMinutes !== lastSunset ||
          p.weatherKind !== lastKind ||
          p.cloudCover !== lastCloud
        ) {
          lastMin = p.minutesSinceMidnight;
          lastSunrise = p.sunriseMinutes;
          lastSunset = p.sunsetMinutes;
          lastKind = p.weatherKind;
          lastCloud = p.cloudCover;
          targetSky = computeTargetSky(
            p.minutesSinceMidnight,
            p.sunriseMinutes,
            p.sunsetMinutes,
            p.weatherKind,
            p.cloudCover
          );
          skySettled = false;
        }

        // Smooth atmospheric crossfade (~2.5s settle time), then idle without allocations
        if (!skySettled) {
          currentSky = lerpSkyState(currentSky, targetSky, Math.min(1, dt * 1.4));
          if (skyCloseEnough(currentSky, targetSky)) {
            currentSky = targetSky;
            skySettled = true;
          }
        }

        if (canvas && ctx) {
          renderAtmosphereFrame(
            ctx,
            canvas.width,
            canvas.height,
            dt,
            elapsed,
            currentSky,
            p.weatherKind,
            p.cloudCover,
            p.windKmh,
            p.moonPhase,
            p.isNightQuiet,
            scene
          );
        }
      }

      rafId = window.requestAnimationFrame(loop);

      return function () {
        window.cancelAnimationFrame(rafId);
        window.removeEventListener('resize', syncCanvasSize);
      };
    },
    [
      props.animated,
      props.animated ? 0 : Math.floor(props.minutesSinceMidnight / 5),
      props.animated ? 0 : props.sunriseMinutes,
      props.animated ? 0 : props.sunsetMinutes,
      props.animated ? '' : props.weatherKind,
      props.animated ? 0 : props.cloudCover,
      props.animated ? 0 : Math.round(props.windKmh),
      props.animated ? 0 : Math.round(props.moonPhase * 100),
      props.animated ? false : props.isNightQuiet,
    ]
  );

  // Vector Retina-sharp Moon synced with canvas sky position & visibility
  var skyNow = computeTargetSky(
    props.minutesSinceMidnight,
    props.sunriseMinutes,
    props.sunsetMinutes,
    props.weatherKind,
    props.cloudCover
  );
  var moonClear =
    props.weatherKind === 'clear'
      ? 1.0
      : props.weatherKind === 'partly-cloudy'
        ? 0.85
        : 0;
  var moonOpacity = skyNow.isNight > 0.35 ? skyNow.isNight * moonClear : 0;
  var showMoon = moonOpacity > 0.01;
  var illum = showMoon ? 0.5 * (1 - Math.cos(props.moonPhase * Math.PI * 2)) : 0;
  var isFull = showMoon && Math.abs(props.moonPhase - 0.5) < 0.015;
  var isNew = showMoon && (props.moonPhase < 0.015 || props.moonPhase > 0.985);
  var litPath = showMoon && !isFull && !isNew ? buildMoonLitPath(props.moonPhase, 44) : '';

  return (
    <div class="atmosphere-layer" aria-hidden="true">
      <canvas ref={canvasRef} class="atmosphere-canvas" />
      {showMoon ? (
        <div
          class="celestial-moon"
          style={{
            left: (skyNow.orbX * 100).toFixed(2) + '%',
            top: (skyNow.orbY * 100).toFixed(2) + '%',
            opacity: moonOpacity.toFixed(3),
          }}
        >
          <svg viewBox="-50 -50 100 100" class="celestial-moon-svg">
            <defs>
              <radialGradient id="glance-moon-lit" cx="38%" cy="34%" r="70%">
                <stop offset="0%" stop-color="#ffffff" />
                <stop offset="65%" stop-color="#eaf2ff" />
                <stop offset="100%" stop-color="#c4d9f7" />
              </radialGradient>
              <clipPath id="glance-moon-lit-clip">
                {isFull ? (
                  <circle cx="0" cy="0" r="44" />
                ) : isNew ? (
                  <circle cx="0" cy="0" r="0" />
                ) : (
                  <path d={litPath} />
                )}
              </clipPath>
            </defs>

            {/* Dark side with subtle earthshine */}
            <circle cx="0" cy="0" r="44" fill="rgba(12, 22, 48, 0.82)" />
            <circle cx="0" cy="0" r="44" fill="rgba(170, 200, 245, 0.12)" />

            {/* Illuminated phase */}
            {isFull ? (
              <circle cx="0" cy="0" r="44" fill="url(#glance-moon-lit)" />
            ) : isNew ? null : (
              <path d={litPath} fill="url(#glance-moon-lit)" />
            )}

            {/* Subtle lunar maria clipped strictly to illuminated region */}
            {illum > 0.1 ? (
              <g clip-path="url(#glance-moon-lit-clip)" fill="rgba(140, 166, 206, 0.22)">
                <circle cx="-11" cy="-8" r="11" />
                <circle cx="10" cy="7" r="9.5" />
                <circle cx="4" cy="-16" r="6.5" />
                <circle cx="-4" cy="15" r="7" />
              </g>
            ) : null}

            {/* Crisp thin rim */}
            <circle
              cx="0"
              cy="0"
              r="43.6"
              fill="none"
              stroke="rgba(220, 236, 255, 0.28)"
              stroke-width="0.9"
            />
          </svg>
        </div>
      ) : null}
    </div>
  );
}
