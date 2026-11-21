import type { ComponentChildren } from 'preact';
import type { CityConfig, CityWeather, TempUnit, TimeFormat } from '../types';
import type { CityClockInfo } from '../utils/time';
import { formatHourlyLabel } from '../utils/time';
import { describeAQI, describeWMO, formatTemp, formatWind } from '../utils/weather';
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
  var hourly = weather ? weather.hourly.slice(0, 8) : [];
  var hasHourlyPrecip = hourly.some(function (slot) {
    return slot.precipProb >= 15;
  });

  var rainHeadsUp = getRainHeadsUp(weather, timeFormat);
  var aqiVal = weather && typeof weather.usAqi === 'number' ? weather.usAqi : null;
  var aqiHeadsUp =
    aqiVal !== null && aqiVal >= 101
      ? 'AQI ' + String(aqiVal) + ' · ' + describeAQI(aqiVal).label
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
                  H {formatTemp(weather.highC, units)}
                </span>
                <span class="hero-meta-sep">·</span>
                <span class="hero-meta-item">
                  L {formatTemp(weather.lowC, units)}
                </span>
                <span class="hero-meta-sep">·</span>
                <span class="hero-meta-item">
                  Feels {formatTemp(weather.feelsLikeC, units)}
                </span>
              </div>
              <div class="hero-meta-row hero-meta-secondary">
                <span class="hero-meta-item">
                  Wind {formatWind(weather.windKmh, units)}
                </span>
                <span class="hero-meta-sep">·</span>
                <span class="hero-meta-item">Humidity {weather.humidity}%</span>
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
