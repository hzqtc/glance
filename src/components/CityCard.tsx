import type { CityConfig, CityWeather, TempUnit } from '../types';
import type { CityClockInfo } from '../utils/time';
import { formatHourOffset } from '../utils/time';
import { describeAQI, describeWMO, formatTemp, formatWind } from '../utils/weather';
import { WeatherIcon } from './WeatherIcon';

interface CityCardProps {
  city: CityConfig;
  weather: CityWeather | undefined;
  clock: CityClockInfo;
  homeDaySerial: number;
  homeOffsetSeconds: number;
  units: TempUnit;
  isHome: boolean;
  isSelected: boolean;
  compact: boolean;
  onSelect: (cityId: string) => void;
}

export function CityCard(props: CityCardProps) {
  var city = props.city;
  var weather = props.weather;
  var clock = props.clock;
  var units = props.units;

  var desc = weather ? describeWMO(weather.weatherCode) : null;
  var dayDiff = clock.daySerial - props.homeDaySerial;
  var dayBadge =
    dayDiff > 0 ? '+' + String(dayDiff) + 'd' : dayDiff < 0 ? String(dayDiff) + 'd' : '';

  var offsetLabel = props.isHome
    ? 'HOME'
    : weather
      ? formatHourOffset(weather.utcOffsetSeconds, props.homeOffsetSeconds)
      : '';

  var aqiVal = weather && typeof weather.usAqi === 'number' ? weather.usAqi : null;
  var aqiDesc = aqiVal !== null ? describeAQI(aqiVal) : null;

  var cardClass = 'city-card';
  if (props.isSelected) {
    cardClass += ' city-card-selected';
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      props.onSelect(city.id);
    }
  }

  return (
    <div
      role="button"
      tabIndex={0}
      class={cardClass}
      onClick={function () {
        props.onSelect(city.id);
      }}
      onKeyDown={handleKeyDown}
      aria-pressed={props.isSelected}
    >
      <div class="city-card-header">
        <div class="city-card-title-group">
          <div class="city-card-name-row">
            {props.isSelected ? <span class="city-active-dot" /> : null}
            <span class="city-card-name">{city.name}</span>
          </div>
          {city.region ? <div class="city-card-region">{city.region}</div> : null}
        </div>
        <div class="city-card-badges">
          {dayBadge ? <span class="badge badge-day">{dayBadge}</span> : null}
          {offsetLabel ? (
            <span class={props.isHome ? 'badge badge-home' : 'badge'}>
              {offsetLabel}
            </span>
          ) : null}
        </div>
      </div>

      <div class="city-card-body">
        <div class="city-card-time-block">
          <div class="city-card-clock">
            <span class="city-clock-digits">
              {clock.hoursDisplay}:{clock.minutesDisplay}
            </span>
            {clock.ampm ? <span class="city-clock-ampm">{clock.ampm}</span> : null}
          </div>
          <div class="city-card-date">{clock.shortDate}</div>
        </div>

        <div class="city-card-weather">
          {weather && desc ? (
            <div class="city-weather-inner">
              <div class="city-weather-top">
                <WeatherIcon
                  kind={desc.kind}
                  isDay={weather.isDay}
                  size={props.compact ? 22 : 28}
                />
                <span class="city-card-temp">{formatTemp(weather.tempC, units)}</span>
                <span class="city-card-cond">{desc.shortLabel}</span>
              </div>
              <div class="city-card-hl">
                H {formatTemp(weather.highC, units)} · L {formatTemp(weather.lowC, units)}
              </div>
            </div>
          ) : (
            <div class="city-card-cond">—</div>
          )}
        </div>
      </div>

      {weather ? (
        <div class="city-card-footer">
          <div class="city-stat">
            <span class="city-stat-label">Feels</span>
            <span class="city-stat-value">{formatTemp(weather.feelsLikeC, units)}</span>
          </div>
          <div class="city-stat">
            <span class="city-stat-label">Wind</span>
            <span class="city-stat-value">{formatWind(weather.windKmh, units)}</span>
          </div>
          <div class="city-stat">
            <span class="city-stat-label">Humid</span>
            <span class="city-stat-value">{weather.humidity}%</span>
          </div>
          <div class="city-stat">
            <span class="city-stat-label">AQI</span>
            <span class="city-stat-value city-stat-aqi">
              {aqiVal !== null && aqiDesc ? (
                <span>
                  <span
                    class="city-aqi-dot"
                    style={{ backgroundColor: aqiDesc.color }}
                  />
                  {aqiVal}
                </span>
              ) : (
                '—'
              )}
            </span>
          </div>
        </div>
      ) : null}
    </div>
  );
}
