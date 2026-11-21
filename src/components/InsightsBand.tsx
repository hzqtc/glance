import type { CityWeather, TempUnit, TimeFormat, TripWidgetItem } from '../types';
import type { CityClockInfo } from '../utils/time';
import {
  computeDaylightProgress,
  formatClockHHMM,
  formatWeekdayFromISO,
  parseMinutesFromHHMM,
} from '../utils/time';
import {
  describeAQI,
  describeDewPoint,
  describeUV,
  describeWMO,
  formatDailySummary,
  formatTemp,
} from '../utils/weather';
import { WeatherIcon } from './WeatherIcon';

interface InsightsBandProps {
  weather: CityWeather | undefined;
  clock: CityClockInfo;
  units: TempUnit;
  timeFormat: TimeFormat;
  trips: TripWidgetItem[];
}

function getNextUpcomingTrip(trips: TripWidgetItem[]): { title: string; daysLeft: number; emoji: string } | null {
  if (!trips || trips.length === 0) return null;
  var now = Date.now();
  var best: { title: string; daysLeft: number; emoji: string } | null = null;
  for (var i = 0; i < trips.length; i++) {
    var t = trips[i];
    var parts = (t.date || '').split('-');
    if (parts.length !== 3) continue;
    var y = parseInt(parts[0], 10);
    var m = parseInt(parts[1], 10);
    var d = parseInt(parts[2], 10);
    if (isNaN(y) || isNaN(m) || isNaN(d)) continue;
    var targetMs = Date.UTC(y, m - 1, d);
    var days = Math.ceil((targetMs - now) / 86400000);
    if (days >= 0 && (!best || days < best.daysLeft)) {
      best = { title: t.title, daysLeft: days, emoji: t.emoji || '' };
    }
  }
  return best;
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

  var showUV = weather.isDay;
  var uvVal =
    typeof weather.uvIndex === 'number'
      ? weather.uvIndex
      : daily.length > 0
        ? daily[0].uvIndexMax
        : null;
  var uvDesc = uvVal !== null ? describeUV(uvVal) : null;

  var dewVal = typeof weather.dewPointC === 'number' ? weather.dewPointC : null;
  var dewDesc = dewVal !== null ? describeDewPoint(dewVal) : null;

  var sunriseMin = parseMinutesFromHHMM(weather.sunrise, 390);
  var sunsetMin = parseMinutesFromHHMM(weather.sunset, 1110);
  var daylight = computeDaylightProgress(
    props.clock.minutesSinceMidnight,
    sunriseMin,
    sunsetMin
  );

  var dailySummary = formatDailySummary(
    weather.precipSumMm,
    weather.sunshineSeconds,
    props.units
  );
  var nextTrip = getNextUpcomingTrip(props.trips);

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
          <span class="insights-title">
            {nextTrip ? 'Air, Daylight & Trip' : 'Air & Daylight'}
          </span>
          {nextTrip ? (
            <span class="trip-pill">
              {nextTrip.emoji ? nextTrip.emoji + ' ' : ''}
              {nextTrip.title} · {nextTrip.daysLeft === 0 ? 'Today' : String(nextTrip.daysLeft) + 'd'}
            </span>
          ) : (
            <span class="insights-sub">{daylight.durationText}</span>
          )}
        </div>

        <div class="atmos-metrics">
          <div class="atmos-metric-box">
            <div class="atmos-metric-label">
              Air Quality
              {pm25Val !== null ? (
                <span class="atmos-metric-inline-sub">
                  {' '}· PM2.5 {pm25Val < 10 ? pm25Val.toFixed(1) : String(Math.round(pm25Val))}
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
                <div class="atmos-metric-label">Dew Point</div>
                {dewVal !== null && dewDesc ? (
                  <div class="atmos-metric-value-row">
                    <span
                      class="metric-dot"
                      style={{ backgroundColor: dewDesc.color }}
                    />
                    <span class="atmos-metric-num">
                      {formatTemp(dewVal, props.units)}
                    </span>
                    <span class="atmos-metric-tag">{dewDesc.label}</span>
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
              <span class="daylight-item-label">Sunrise</span>
              <span class="daylight-item-value">
                {formatClockHHMM(weather.sunrise, props.timeFormat)}
              </span>
            </div>
            <div class="daylight-item">
              <span class="daylight-item-label">Sunset</span>
              <span class="daylight-item-value">
                {formatClockHHMM(weather.sunset, props.timeFormat)}
              </span>
            </div>
            <div class="daylight-item daylight-item-right">
              <span class="daylight-item-label">
                {daylight.isDaylight ? 'Until Sunset' : 'Until Sunrise'}
              </span>
              <span class="daylight-item-value">{daylight.remainingDuration}</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
