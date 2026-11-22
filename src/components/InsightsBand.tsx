import type { CityWeather, TempUnit } from '../types';
import { formatWeekdayFromISO } from '../utils/time';
import {
  describeAQI,
  describePM25,
  describeUV,
  describeWMO,
  formatDailySummary,
  formatLowVisibility,
  formatTemp,
  formatWind,
} from '../utils/weather';
import { WeatherIcon } from './WeatherIcon';

interface InsightsBandProps {
  weather: CityWeather | undefined;
  units: TempUnit;
}

export function InsightsBand(props: InsightsBandProps) {
  var weather = props.weather;
  if (!weather) {
    return null;
  }

  var daily = weather.daily ? weather.daily.slice(0, 5) : [];
  var weekMin = 999;
  var weekMax = -999;
  for (var i = 0; i < daily.length; i++) {
    if (daily[i].lowC < weekMin) weekMin = daily[i].lowC;
    if (daily[i].highC > weekMax) weekMax = daily[i].highC;
  }
  var weekSpan = Math.max(1, weekMax - weekMin);

  var aqiVal = typeof weather.usAqi === 'number' ? weather.usAqi : null;
  var aqiDesc = aqiVal !== null ? describeAQI(aqiVal) : null;
  var pm25Val = typeof weather.pm25 === 'number' ? weather.pm25 : null;
  var pm25Desc = pm25Val !== null ? describePM25(pm25Val) : null;
  var pm25Text =
    pm25Val !== null
      ? pm25Val < 10
        ? pm25Val.toFixed(1)
        : String(Math.round(pm25Val))
      : null;

  var showUV = weather.isDay;
  var uvVal =
    typeof weather.uvIndex === 'number'
      ? weather.uvIndex
      : daily.length > 0
        ? daily[0].uvIndexMax
        : null;
  var uvDesc = uvVal !== null ? describeUV(uvVal) : null;

  var lowVis = formatLowVisibility(weather.visibilityM, props.units);

  var dailySummary = formatDailySummary(
    weather.precipSumMm,
    weather.sunshineSeconds,
    props.units
  );

  return (
    <section class="insights-band" aria-label="5-day forecast and air conditions">
      <div class="insights-card insights-forecast">
        <div class="insights-header">
          <span class="insights-title">5-Day Forecast</span>
          {dailySummary ? <span class="insights-sub">{dailySummary}</span> : null}
        </div>

        <div class="daily-grid">
          {daily.map(function (day, idx) {
            var desc = describeWMO(day.weatherCode);
            var leftPct = Math.round(((day.lowC - weekMin) / weekSpan) * 100);
            var widthPct = Math.max(
              14,
              Math.round(((day.highC - day.lowC) / weekSpan) * 100)
            );
            if (leftPct + widthPct > 100) {
              widthPct = 100 - leftPct;
            }

            return (
              <div class="daily-col" key={day.date}>
                <div class={idx === 0 ? 'daily-day daily-day-today' : 'daily-day'}>
                  {formatWeekdayFromISO(day.date, idx === 0)}
                </div>
                <div class="daily-icon-wrap">
                  <WeatherIcon kind={desc.kind} isDay={true} size={28} />
                </div>
                <div class="daily-precip">
                  {day.precipProbMax >= 20 ? String(day.precipProbMax) + '%' : '\u00A0'}
                </div>
                <div class="daily-bar-track">
                  <div
                    class="daily-bar-fill"
                    style={{
                      left: String(leftPct) + '%',
                      width: String(widthPct) + '%',
                    }}
                  />
                </div>
                <div class="daily-temps">
                  <span class="daily-high">{formatTemp(day.highC, props.units)}</span>
                  <span class="daily-low">{formatTemp(day.lowC, props.units)}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div
        class={
          aqiVal !== null && aqiVal >= 101
            ? 'insights-card insights-atmosphere insights-alert-aqi'
            : 'insights-card insights-atmosphere'
        }
      >
        <div class="insights-header">
          <span class="insights-title">Air &amp; Conditions</span>
          {lowVis ? <span class="insights-sub">{lowVis}</span> : null}
        </div>

        <div class="atmos-metrics">
          <div class="atmos-metric-box">
            <div class="atmos-metric-label">
              Air Quality
              {showUV && pm25Text !== null ? (
                <span class="atmos-metric-inline-sub">
                  {' '}· PM2.5 {pm25Text}
                </span>
              ) : null}
            </div>
            {aqiVal !== null && aqiDesc ? (
              <div class="atmos-metric-value-row">
                <span
                  class="metric-dot"
                  style={{ backgroundColor: aqiDesc.color }}
                />
                <span class="atmos-metric-num">{aqiVal}</span>
                <span class="atmos-metric-tag">{aqiDesc.label}</span>
              </div>
            ) : (
              <div class="atmos-metric-value-row">
                <span class="atmos-metric-tag">Unavailable</span>
              </div>
            )}
          </div>

          <div class="atmos-metric-divider" />

          <div class="atmos-metric-box">
            {showUV ? (
              <div>
                <div class="atmos-metric-label">UV Index</div>
                {uvVal !== null && uvDesc ? (
                  <div class="atmos-metric-value-row">
                    <span
                      class="metric-dot"
                      style={{ backgroundColor: uvDesc.color }}
                    />
                    <span class="atmos-metric-num">{Math.round(uvVal)}</span>
                    <span class="atmos-metric-tag">{uvDesc.label}</span>
                  </div>
                ) : (
                  <div class="atmos-metric-value-row">
                    <span class="atmos-metric-tag">—</span>
                  </div>
                )}
              </div>
            ) : (
              <div>
                <div class="atmos-metric-label">
                  PM2.5
                  <span class="atmos-metric-inline-sub"> µg/m³</span>
                </div>
                {pm25Text !== null && pm25Desc ? (
                  <div class="atmos-metric-value-row">
                    <span
                      class="metric-dot"
                      style={{ backgroundColor: pm25Desc.color }}
                    />
                    <span class="atmos-metric-num">{pm25Text}</span>
                    <span class="atmos-metric-tag">{pm25Desc.label}</span>
                  </div>
                ) : (
                  <div class="atmos-metric-value-row">
                    <span class="atmos-metric-tag">—</span>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <div class="daylight-block">
          <div class="daylight-row">
            <div class="daylight-item">
              <span class="daylight-item-label">Feels Like</span>
              <span class="daylight-item-value">
                {formatTemp(weather.feelsLikeC, props.units)}
              </span>
            </div>
            <div class="daylight-item">
              <span class="daylight-item-label">Wind</span>
              <span class="daylight-item-value">
                {formatWind(weather.windKmh, props.units)}
              </span>
            </div>
            <div class="daylight-item daylight-item-right">
              <span class="daylight-item-label">Humidity</span>
              <span class="daylight-item-value">
                {String(weather.humidity) + '%'}
              </span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
