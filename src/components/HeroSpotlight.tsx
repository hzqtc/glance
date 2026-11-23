import type { ComponentChildren } from 'preact';
import type {
  CityConfig,
  CityWeather,
  HourlyForecast,
  TempUnit,
  TimeFormat,
} from '../types';
import type { CityClockInfo } from '../utils/time';
import {
  formatClockHHMM,
  formatHourlyLabel,
  parseMinutesFromHHMM,
} from '../utils/time';
import {
  describeAQI,
  describeWMO,
  formatTemp,
  formatTempDeltaYesterday,
} from '../utils/weather';
import { WeatherIcon } from './WeatherIcon';

interface HeroSpotlightProps {
  city: CityConfig;
  weather: CityWeather | undefined;
  clock: CityClockInfo;
  units: TempUnit;
  timeFormat: TimeFormat;
  isStale: boolean;
  controls?: ComponentChildren;
}

type HourlyRibbonItem =
  | {
      kind: 'hour';
      key: string;
      minute: number;
      slot: HourlyForecast;
    }
  | {
      kind: 'sun';
      key: string;
      minute: number;
      event: 'sunrise' | 'sunset';
      timeHHMM: string;
    };

function parseHourlySlotHour(isoTime: string): number {
  var tIdx = isoTime.indexOf('T');
  if (tIdx === -1 || tIdx + 3 > isoTime.length) {
    return -1;
  }
  var h = parseInt(isoTime.slice(tIdx + 1, tIdx + 3), 10);
  return isNaN(h) ? -1 : h;
}

function buildHourlyRibbonItems(
  hourly: HourlyForecast[],
  sunrise: string,
  sunset: string,
  clock: CityClockInfo
): HourlyRibbonItem[] {
  if (hourly.length === 0) {
    return [];
  }

  var nowMin = clock.hour24 * 60 + clock.minute;
  var items: HourlyRibbonItem[] = [];
  var dayOffset = 0;
  var prevHour = -1;
  var firstSlotMin = -1;
  var lastSlotMin = -1;

  for (var i = 0; i < hourly.length; i++) {
    var slot = hourly[i];
    var h = parseHourlySlotHour(slot.time);
    if (h < 0) {
      continue;
    }
    if (prevHour === -1) {
      if (h * 60 + 120 < nowMin) {
        dayOffset = 1;
      }
    } else if (h < prevHour) {
      dayOffset += 1;
    }
    prevHour = h;
    var slotMin = dayOffset * 1440 + h * 60;
    if (firstSlotMin === -1) {
      firstSlotMin = slotMin;
    }
    lastSlotMin = slotMin;
    items.push({
      kind: 'hour',
      key: slot.time,
      minute: slotMin,
      slot: slot,
    });
  }

  if (firstSlotMin === -1 || lastSlotMin === -1) {
    return items;
  }

  var windowMin = Math.max(nowMin, firstSlotMin - 60);
  var sunEvents: Array<{ event: 'sunrise' | 'sunset'; hhmm: string }> = [
    { event: 'sunrise', hhmm: sunrise },
    { event: 'sunset', hhmm: sunset },
  ];

  for (var s = 0; s < sunEvents.length; s++) {
    var ev = sunEvents[s];
    var rawMin = parseMinutesFromHHMM(ev.hhmm, -1);
    if (rawMin < 0) {
      continue;
    }
    for (var d = 0; d <= 2; d++) {
      var candidate = rawMin + d * 1440;
      if (candidate >= windowMin && candidate <= lastSlotMin) {
        items.push({
          kind: 'sun',
          key: ev.event + '-' + String(d),
          minute: candidate,
          event: ev.event,
          timeHHMM: ev.hhmm,
        });
        break;
      }
    }
  }

  items.sort(function (a, b) {
    if (a.minute !== b.minute) {
      return a.minute - b.minute;
    }
    if (a.kind === b.kind) {
      return 0;
    }
    return a.kind === 'hour' ? -1 : 1;
  });

  return items;
}

function SunEventIcon(props: { kind: 'sunrise' | 'sunset'; size?: number }) {
  var size = props.size || 30;
  var isSunrise = props.kind === 'sunrise';
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      class="weather-icon"
      aria-hidden="true"
    >
      <g class="wi-sun-rays" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round">
        {isSunrise ? (
          <g>
            <line x1="32" y1="26" x2="32" y2="12" />
            <polyline points="26,18 32,12 38,18" />
          </g>
        ) : (
          <g>
            <line x1="32" y1="12" x2="32" y2="26" />
            <polyline points="26,20 32,26 38,20" />
          </g>
        )}
        <line x1="13.5" y1="37" x2="17" y2="38.5" />
        <line x1="19" y1="28" x2="21.8" y2="30.8" />
        <line x1="45" y1="28" x2="42.2" y2="30.8" />
        <line x1="50.5" y1="37" x2="47" y2="38.5" />
      </g>
      <path d="M20.5 45 A11.5 11.5 0 0 1 43.5 45 Z" class="wi-sun-core" />
      <g class="wi-sun-rays" stroke-width="3" stroke-linecap="round">
        <line x1="10" y1="45" x2="54" y2="45" />
        <line x1="20" y1="51.5" x2="44" y2="51.5" opacity="0.55" />
      </g>
    </svg>
  );
}

function getRainHeadsUp(
  weather: CityWeather | undefined,
  timeFormat: TimeFormat
): string | null {
  if (!weather) return null;
  if (weather.rainNowcast) {
    return weather.rainNowcast;
  }
  var desc = describeWMO(weather.weatherCode);
  if (desc.kind === 'storm') {
    return 'Thunderstorm active';
  }
  var next3 = weather.hourly ? weather.hourly.slice(0, 3) : [];
  for (var i = 0; i < next3.length; i++) {
    if (next3[i].precipProb >= 60) {
      return (
        'Rain ' +
        String(next3[i].precipProb) +
        '% at ' +
        formatHourlyLabel(next3[i].time, timeFormat)
      );
    }
  }
  return null;
}

export function HeroSpotlight(props: HeroSpotlightProps) {
  var city = props.city;
  var weather = props.weather;
  var clock = props.clock;
  var units = props.units;
  var timeFormat = props.timeFormat;

  var desc = weather ? describeWMO(weather.weatherCode) : null;
  var hourly = weather ? weather.hourly.slice(0, 24) : [];
  var ribbonItems = weather
    ? buildHourlyRibbonItems(hourly, weather.sunrise, weather.sunset, clock)
    : [];

  var rainHeadsUp = getRainHeadsUp(weather, timeFormat);
  var aqiVal = weather && typeof weather.usAqi === 'number' ? weather.usAqi : null;
  var aqiHeadsUp =
    aqiVal !== null && aqiVal >= 101
      ? 'AQI ' + String(aqiVal) + ' · ' + describeAQI(aqiVal).label
      : null;

  var deltaText = weather
    ? formatTempDeltaYesterday(weather.tempDeltaYesterdayC, units)
    : null;

  return (
    <section class="hero">
      <div class="hero-top">
        {props.controls ? (
          <div class="hero-top-center">{props.controls}</div>
        ) : null}

        <div class="hero-left">
          <div class="hero-location-row">
            <span
              class={props.isStale ? 'status-dot status-dot-stale' : 'status-dot'}
              title={props.isStale ? 'Using cached weather' : 'Live'}
            />
            <span class="hero-location-label">
              {city.name}
              {city.region ? ', ' + city.region : ''}
            </span>
            {rainHeadsUp ? (
              <span class="headsup-pill headsup-rain">{rainHeadsUp}</span>
            ) : null}
            {aqiHeadsUp ? (
              <span class="headsup-pill headsup-aqi">{aqiHeadsUp}</span>
            ) : null}
          </div>

          <div class="hero-clock-row">
            <span class="hero-clock-digits">{clock.hoursDisplay}</span>
            <span class="hero-clock-colon">:</span>
            <span class="hero-clock-digits">{clock.minutesDisplay}</span>
            {clock.ampm ? <span class="hero-clock-ampm">{clock.ampm}</span> : null}
          </div>

          <div class="hero-date">{clock.longDate}</div>
        </div>

        <div class="hero-right">
          {weather && desc ? (
            <div class="hero-weather-block">
              <div class="hero-weather-main">
                <WeatherIcon kind={desc.kind} isDay={weather.isDay} size={74} />
                <span class="hero-temp">{formatTemp(weather.tempC, units)}</span>
              </div>
              <div class="hero-condition">{desc.label}</div>
              <div class="hero-meta-row">
                <span class="hero-meta-item">
                  Feels {formatTemp(weather.feelsLikeC, units)}
                </span>
                <span class="hero-meta-sep">·</span>
                <span class="hero-meta-item">
                  H {formatTemp(weather.highC, units)}
                </span>
                <span class="hero-meta-sep">·</span>
                <span class="hero-meta-item">
                  L {formatTemp(weather.lowC, units)}
                </span>
                {deltaText ? (
                  <span>
                    <span class="hero-meta-sep">·</span>
                    <span class="hero-meta-item">{deltaText}</span>
                  </span>
                ) : null}
              </div>
            </div>
          ) : (
            <div class="hero-weather-loading">Loading weather…</div>
          )}
        </div>
      </div>

      {weather && ribbonItems.length > 0 ? (
        <div class={rainHeadsUp ? 'hourly-ribbon hourly-ribbon-rain' : 'hourly-ribbon'}>
          <div class="hourly-slots">
            {ribbonItems.map(function (item) {
              if (item.kind === 'sun') {
                return (
                  <div class="hourly-slot hourly-slot-sun" key={item.key}>
                    <div class="hourly-time hourly-time-sun">
                      {formatClockHHMM(item.timeHHMM, timeFormat)}
                    </div>
                    <div class="hourly-icon-wrap">
                      <SunEventIcon kind={item.event} size={30} />
                    </div>
                    <div class="hourly-temp-row">
                      <span class="hourly-sun-label">
                        {item.event === 'sunrise' ? 'Sunrise' : 'Sunset'}
                      </span>
                    </div>
                  </div>
                );
              }
              var slot = item.slot;
              var slotDesc = describeWMO(slot.weatherCode);
              return (
                <div class="hourly-slot" key={item.key}>
                  <div class="hourly-time">
                    {formatHourlyLabel(slot.time, timeFormat)}
                  </div>
                  <div class="hourly-icon-wrap">
                    <WeatherIcon kind={slotDesc.kind} isDay={slot.isDay} size={30} />
                  </div>
                  <div class="hourly-temp-row">
                    <span class="hourly-temp">{formatTemp(slot.tempC, units)}</span>
                    {slot.precipProb >= 15 ? (
                      <span class="hourly-precip">
                        {String(slot.precipProb) + '%'}
                      </span>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
    </section>
  );
}
