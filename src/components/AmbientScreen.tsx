import { useEffect, useRef } from 'preact/hooks';
import type { CityWeather, TempUnit, TimeFormat } from '../types';
import type { CityClockInfo } from '../utils/time';
import { formatClockHHMM, parseMinutesFromHHMM } from '../utils/time';
import { describeWMO, formatTemp } from '../utils/weather';
import { WeatherIcon } from './WeatherIcon';

interface AmbientScreenProps {
  clock: CityClockInfo;
  cityName: string;
  weather: CityWeather | undefined;
  units: TempUnit;
  timeFormat: TimeFormat;
  onWake: () => void;
}

// "6h 12m" / "45m" until the next sunrise (tomorrow's is ~today's time)
function formatUntil(minutes: number): string {
  var h = Math.floor(minutes / 60);
  var m = minutes % 60;
  if (h === 0) return String(m) + 'm';
  return String(h) + 'h ' + (m < 10 ? '0' : '') + String(m) + 'm';
}

// A few pixels of drift per minute so the static night layout doesn't sit on
// the same LCD pixels all night.
var DRIFT = [
  [0, 0],
  [6, -4],
  [-5, 5],
  [4, 6],
  [-6, -3],
  [3, -6],
  [-3, 4],
  [6, 3],
];

// Point on the dial (viewBox 0..200, centre 100) at `deg` clockwise from 12
function dialPoint(deg: number, radius: number): [number, number] {
  var rad = ((deg - 90) * Math.PI) / 180;
  return [100 + radius * Math.cos(rad), 100 + radius * Math.sin(rad)];
}

function n(v: number): string {
  return v.toFixed(2);
}

// Precompute the 60 static SVG dial marks once at module load
var DIAL_MARKS = (function () {
  var list = [];
  for (var i = 0; i < 60; i++) {
    var deg = i * 6;
    if (i % 5 === 0) {
      var major = i % 15 === 0;
      var a = dialPoint(deg, major ? 80 : 83);
      var b = dialPoint(deg, 90);
      list.push(
        <line
          key={'h' + i}
          x1={n(a[0])}
          y1={n(a[1])}
          x2={n(b[0])}
          y2={n(b[1])}
          class={major ? 'ambient-mark ambient-mark-major' : 'ambient-mark'}
        />
      );
    } else {
      var p = dialPoint(deg, 89);
      list.push(<circle key={'m' + i} cx={n(p[0])} cy={n(p[1])} r="0.7" class="ambient-dot" />);
    }
  }
  return list;
})();

interface AnalogClockProps {
  hour24: number;
  minute: number;
  label: string; // printed on the dial below 12 (the city)
}

function secondHandTransform(): string {
  return 'rotate(' + String(new Date().getSeconds() * 6) + ' 100 100)';
}

// Minimal analog dial: hour bars, minute dots, rounded hour/minute hands, and a
// ticking second hand. The second hand is rotated directly once a second (no Preact
// re-render), so ticking stays cheap on the iPad mini 2.
function AnalogClock(props: AnalogClockProps) {
  var secondRef = useRef<SVGGElement | null>(null);

  useEffect(function () {
    var timerId: number | null = null;
    function tick() {
      if (secondRef.current) {
        secondRef.current.setAttribute('transform', secondHandTransform());
      }
      // Re-align to the next whole second each time so it never drifts
      timerId = window.setTimeout(tick, 1000 - (Date.now() % 1000) + 5);
    }
    tick();
    return function () {
      if (timerId !== null) window.clearTimeout(timerId);
    };
  }, []);

  var hourDeg = ((props.hour24 % 12) + props.minute / 60) * 30;
  var minuteDeg = props.minute * 6;
  var hourTip = dialPoint(hourDeg, 48);
  var hourTail = dialPoint(hourDeg + 180, 9);
  var minuteTip = dialPoint(minuteDeg, 72);
  var minuteTail = dialPoint(minuteDeg + 180, 12);

  return (
    <svg class="ambient-dial" viewBox="0 0 200 200" aria-hidden="true">
      <defs>
        <radialGradient id="ambientFace" cx="50%" cy="42%" r="62%">
          <stop offset="0%" stop-color="#16213a" stop-opacity="0.55" />
          <stop offset="100%" stop-color="#05080f" stop-opacity="0" />
        </radialGradient>
      </defs>
      <circle cx="100" cy="100" r="98" fill="url(#ambientFace)" />
      <circle cx="100" cy="100" r="96" class="ambient-ring" />
      {DIAL_MARKS}
      {props.label ? (
        <text x="100" y="62" text-anchor="middle" class="ambient-dial-label">
          {props.label.toUpperCase()}
        </text>
      ) : null}
      <line
        x1={n(hourTail[0])}
        y1={n(hourTail[1])}
        x2={n(hourTip[0])}
        y2={n(hourTip[1])}
        class="ambient-hand ambient-hand-hour"
      />
      <line
        x1={n(minuteTail[0])}
        y1={n(minuteTail[1])}
        x2={n(minuteTip[0])}
        y2={n(minuteTip[1])}
        class="ambient-hand ambient-hand-minute"
      />
      <g ref={secondRef} transform={secondHandTransform()}>
        <line x1="100" y1="116" x2="100" y2="17" class="ambient-hand-second" />
        <circle cx="100" cy="116" r="2.2" class="ambient-second-weight" />
      </g>
      <circle cx="100" cy="100" r="4" class="ambient-cap" />
      <circle cx="100" cy="100" r="1.6" class="ambient-cap-dot" />
    </svg>
  );
}

// Night-time ambient mode: an analog clock (left) and current weather (right).
// Any tap or swipe wakes the rotating dashboards.
export function AmbientScreen(props: AmbientScreenProps) {
  var clock = props.clock;
  var w = props.weather;
  var desc = w ? describeWMO(w.weatherCode) : null;

  var sunriseMin = w && w.sunrise ? parseMinutesFromHHMM(w.sunrise, -1) : -1;
  var untilSunrise = -1;
  if (sunriseMin >= 0) {
    var nowMin = clock.hour24 * 60 + clock.minute;
    untilSunrise = (sunriseMin - nowMin + 1440) % 1440;
  }

  // "Sunday, November 22" -> weekday / rest
  var dateParts = clock.longDate.split(', ');
  var weekday = dateParts.length > 1 ? dateParts[0] : '';
  var dateRest = dateParts.length > 1 ? dateParts.slice(1).join(', ') : clock.longDate;

  var drift = DRIFT[clock.minute % DRIFT.length];

  function wake(e: Event) {
    // Don't let this tap/swipe also act on the dashboard underneath
    e.preventDefault();
    e.stopPropagation();
    props.onWake();
  }

  return (
    <div
      class="ambient-screen"
      role="button"
      aria-label={
        'Night clock, ' + clock.hoursDisplay + ':' + clock.minutesDisplay + ' ' + clock.ampm + '. Tap to show dashboards.'
      }
      onClick={wake}
      onTouchEnd={wake}
    >
      <div
        class="ambient-layout"
        style={{ transform: 'translate3d(' + drift[0] + 'px, ' + drift[1] + 'px, 0)' }}
      >
        <div class="ambient-left">
          <AnalogClock
            hour24={clock.hour24}
            minute={clock.minute}
            label={props.cityName}
          />
        </div>

        <div class="ambient-right">
          <div class="ambient-date">
            {weekday ? <div class="ambient-weekday">{weekday}</div> : null}
            <div class="ambient-day">{dateRest}</div>
          </div>

          {w && desc ? (
            <div class="ambient-weather">
              <div class="ambient-temp-row">
                <span class="ambient-temp">{formatTemp(w.tempC, props.units)}</span>
                <WeatherIcon kind={desc.kind} isDay={w.isDay} size={52} />
              </div>
              <div class="ambient-cond">{desc.label}</div>
            </div>
          ) : null}

          {untilSunrise >= 0 && w ? (
            <div class="ambient-sunrise">
              <span class="ambient-sunrise-dot" aria-hidden="true" />
              <div>
                <div class="ambient-sunrise-time">
                  Sunrise {formatClockHHMM(w.sunrise, props.timeFormat)}
                </div>
                <div class="ambient-sunrise-in">in {formatUntil(untilSunrise)}</div>
              </div>
            </div>
          ) : null}

        </div>
      </div>
      <div class="ambient-hint">Tap to show dashboards</div>
    </div>
  );
}
