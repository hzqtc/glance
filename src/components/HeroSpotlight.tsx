import type { ComponentChildren } from 'preact';
import type { CityConfig, CityWeather, TempUnit, TimeFormat } from '../types';
import type { CityClockInfo } from '../utils/time';
import { formatHourlyLabel } from '../utils/time';
import {
  describeAQI,
  describeWMO,
  formatLowVisibility,
  formatTemp,
  formatTempDeltaYesterday,
  formatWind,
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

function MetaThermometerIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      class="hero-meta-icon"
      aria-hidden="true"
    >
      <path d="M14 14.76V3.5a2.5 2.5 0 0 0-5 0v11.26a4.5 4.5 0 1 0 5 0z" />
    </svg>
  );
}

function MetaWindIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      class="hero-meta-icon"
      aria-hidden="true"
    >
      <path d="M9.59 4.59A2 2 0 1 1 11 8H2" />
      <path d="M12.59 19.41A2 2 0 1 0 14 16H2" />
      <path d="M17.73 7.73A2.5 2.5 0 1 1 19.5 12H2" />
    </svg>
  );
}

function MetaDropletIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      class="hero-meta-icon"
      aria-hidden="true"
    >
      <path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z" />
    </svg>
  );
}

function MetaEyeIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      class="hero-meta-icon"
      aria-hidden="true"
    >
      <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

export function HeroSpotlight(props: HeroSpotlightProps) {
  var city = props.city;
  var weather = props.weather;
  var clock = props.clock;
  var units = props.units;
  var timeFormat = props.timeFormat;

  var desc = weather ? describeWMO(weather.weatherCode) : null;
  var hourly = weather ? weather.hourly.slice(0, 24) : [];
  var hasHourlyPrecip = hourly.some(function (slot) {
    return slot.precipProb >= 15;
  });

  var rainHeadsUp = getRainHeadsUp(weather, timeFormat);
  var aqiVal = weather && typeof weather.usAqi === 'number' ? weather.usAqi : null;
  var aqiHeadsUp =
    aqiVal !== null && aqiVal >= 101
      ? 'AQI ' + String(aqiVal) + ' · ' + describeAQI(aqiVal).label
      : null;

  var deltaText = weather
    ? formatTempDeltaYesterday(weather.tempDeltaYesterdayC, units)
    : null;
  var lowVis = weather ? formatLowVisibility(weather.visibilityM, units) : null;

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
                ) : (
                  <span>
                    <span class="hero-meta-sep">·</span>
                    <span class="hero-meta-item">
                      Feels {formatTemp(weather.feelsLikeC, units)}
                    </span>
                  </span>
                )}
              </div>
              <div class="hero-meta-row hero-meta-secondary">
                {deltaText ? (
                  <span class="hero-meta-group" title="Feels like">
                    <MetaThermometerIcon />
                    <span class="hero-meta-item">
                      {formatTemp(weather.feelsLikeC, units)}
                    </span>
                    <span class="hero-meta-sep">·</span>
                  </span>
                ) : null}
                <span class="hero-meta-group" title="Wind">
                  <MetaWindIcon />
                  <span class="hero-meta-item">
                    {formatWind(weather.windKmh, units)}
                  </span>
                </span>
                <span class="hero-meta-sep">·</span>
                {lowVis ? (
                  <span class="hero-meta-group" title="Visibility">
                    <MetaEyeIcon />
                    <span class="hero-meta-item">{lowVis.replace(/^Vis\s+/, '')}</span>
                  </span>
                ) : (
                  <span class="hero-meta-group" title="Humidity">
                    <MetaDropletIcon />
                    <span class="hero-meta-item">
                      {String(weather.humidity) + '%'}
                    </span>
                  </span>
                )}
              </div>
            </div>
          ) : (
            <div class="hero-weather-loading">Loading weather…</div>
          )}
        </div>
      </div>

      {weather && hourly.length > 0 ? (
        <div class={rainHeadsUp ? 'hourly-ribbon hourly-ribbon-rain' : 'hourly-ribbon'}>
          <div class="hourly-slots">
            {hourly.map(function (slot) {
              var slotDesc = describeWMO(slot.weatherCode);
              return (
                <div class="hourly-slot" key={slot.time}>
                  <div class="hourly-time">
                    {formatHourlyLabel(slot.time, timeFormat)}
                  </div>
                  <div class="hourly-icon-wrap">
                    <WeatherIcon kind={slotDesc.kind} isDay={slot.isDay} size={30} />
                  </div>
                  <div class="hourly-temp">{formatTemp(slot.tempC, units)}</div>
                  {hasHourlyPrecip ? (
                    <div class="hourly-precip">
                      {slot.precipProb >= 15 ? String(slot.precipProb) + '%' : '\u00A0'}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
    </section>
  );
}
