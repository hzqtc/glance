import type { DailyForecast, TempUnit, WeatherKind } from '../types';
import { formatWeekdayFromISO } from './time';

export interface WeatherDescriptor {
  label: string;
  shortLabel: string;
  kind: WeatherKind;
}

export function describeWMO(code: number): WeatherDescriptor {
  if (code === 0) {
    return { label: 'Clear Sky', shortLabel: 'Clear', kind: 'clear' };
  }
  if (code === 1) {
    return { label: 'Mostly Clear', shortLabel: 'Mostly Clear', kind: 'clear' };
  }
  if (code === 2) {
    return { label: 'Partly Cloudy', shortLabel: 'Partly Cloudy', kind: 'partly-cloudy' };
  }
  if (code === 3) {
    return { label: 'Overcast', shortLabel: 'Overcast', kind: 'cloudy' };
  }
  if (code === 45 || code === 48) {
    return { label: 'Foggy', shortLabel: 'Fog', kind: 'fog' };
  }
  if (code === 51 || code === 53 || code === 55 || code === 56 || code === 57) {
    return { label: 'Light Drizzle', shortLabel: 'Drizzle', kind: 'drizzle' };
  }
  if (code === 61 || code === 80) {
    return { label: 'Light Rain', shortLabel: 'Light Rain', kind: 'rain' };
  }
  if (code === 63 || code === 66 || code === 81) {
    return { label: 'Rain', shortLabel: 'Rain', kind: 'rain' };
  }
  if (code === 65 || code === 67 || code === 82) {
    return { label: 'Heavy Rain', shortLabel: 'Heavy Rain', kind: 'rain' };
  }
  if (
    code === 71 ||
    code === 73 ||
    code === 75 ||
    code === 77 ||
    code === 85 ||
    code === 86
  ) {
    return { label: 'Snow', shortLabel: 'Snow', kind: 'snow' };
  }
  if (code === 95 || code === 96 || code === 99) {
    return { label: 'Thunderstorm', shortLabel: 'Storm', kind: 'storm' };
  }
  return { label: 'Partly Cloudy', shortLabel: 'Cloudy', kind: 'partly-cloudy' };
}

export function convertTemp(tempC: number, units: TempUnit): number {
  if (units === 'C') {
    return Math.round(tempC);
  }
  return Math.round((tempC * 9) / 5 + 32);
}

export function formatTemp(tempC: number, units: TempUnit): string {
  return String(convertTemp(tempC, units)) + '°';
}

export function formatWind(windKmh: number, units: TempUnit): string {
  if (units === 'C') {
    return String(Math.round(windKmh)) + ' km/h';
  }
  return String(Math.round(windKmh * 0.621371)) + ' mph';
}

export function formatTempDeltaYesterday(
  deltaC: number | null | undefined,
  units: TempUnit
): string | null {
  if (typeof deltaC !== 'number' || isNaN(deltaC)) {
    return null;
  }
  var delta = units === 'C' ? Math.round(deltaC) : Math.round((deltaC * 9) / 5);
  if (delta === 0) {
    return 'Same as yesterday';
  }
  if (delta > 0) {
    return '+' + String(delta) + '° vs yesterday';
  }
  return String(delta) + '° vs yesterday';
}

/**
 * Formats visibility only when noticeably reduced by fog/haze (< 8 km / 5 mi).
 */
export function formatLowVisibility(
  meters: number | undefined,
  units: TempUnit
): string | null {
  if (typeof meters !== 'number' || isNaN(meters) || meters <= 0 || meters >= 8000) {
    return null;
  }
  if (units === 'C') {
    var km = meters / 1000;
    return 'Vis ' + (km < 2 ? km.toFixed(1) : String(Math.round(km))) + ' km';
  }
  var mi = meters / 1609.34;
  return 'Vis ' + (mi < 2 ? mi.toFixed(1) : String(Math.round(mi))) + ' mi';
}

export function formatDailySummary(
  precipSumMm: number | undefined,
  sunshineSeconds: number | undefined,
  units: TempUnit
): string | null {
  if (typeof precipSumMm === 'number' && precipSumMm >= 0.5) {
    if (units === 'C') {
      var mmStr = precipSumMm < 10 ? precipSumMm.toFixed(1) : String(Math.round(precipSumMm));
      return mmStr + ' mm rain today';
    }
    var inches = precipSumMm / 25.4;
    var inStr = inches < 1 ? inches.toFixed(2) : inches.toFixed(1);
    return inStr + ' in rain today';
  }
  if (typeof sunshineSeconds === 'number' && sunshineSeconds >= 3600) {
    var hrs = Math.round((sunshineSeconds / 3600) * 2) / 2;
    var hrStr = hrs % 1 === 0 ? String(hrs) : hrs.toFixed(1);
    return hrStr + 'h sun today';
  }
  return null;
}

/**
 * One-line outlook for the days after today (today's own rain/sun total is
 * shown on the Air & Conditions card). Priority: the next wet spell, then a
 * notable temperature swing, then a dry stretch; null when nothing stands out.
 */
export function formatWeekOutlook(daily: DailyForecast[], units: TempUnit): string | null {
  if (!daily || daily.length < 2) return null;
  var ahead = daily.slice(1);

  function dayName(idx: number): string {
    return idx === 0 ? 'tomorrow' : formatWeekdayFromISO(ahead[idx].date, false);
  }

  // 1. Next wet spell (>= 50% chance), named by its weather (rain, snow, storms)
  for (var i = 0; i < ahead.length; i++) {
    if (ahead[i].precipProbMax >= 50) {
      var end = i;
      while (end + 1 < ahead.length && ahead[end + 1].precipProbMax >= 50) end++;
      var kind = describeWMO(ahead[i].weatherCode).kind;
      var noun = kind === 'snow' ? 'Snow' : kind === 'storm' ? 'Storms' : 'Rain';
      var when = end > i ? dayName(i) + '–' + dayName(end) : dayName(i);
      if (i === 0 && end > i) when = 'from tomorrow';
      return noun + ' likely ' + when;
    }
  }

  // 2. Notable warm-up or cool-down (>= 5°C / 9°F) versus today's high
  var todayHigh = daily[0].highC;
  var warmIdx = 0;
  var coolIdx = 0;
  for (var j = 1; j < ahead.length; j++) {
    if (ahead[j].highC > ahead[warmIdx].highC) warmIdx = j;
    if (ahead[j].highC < ahead[coolIdx].highC) coolIdx = j;
  }
  var warmDelta = ahead[warmIdx].highC - todayHigh;
  var coolDelta = todayHigh - ahead[coolIdx].highC;
  if (warmDelta >= 5 && warmDelta >= coolDelta) {
    return 'Warming to ' + formatTemp(ahead[warmIdx].highC, units) + ' by ' + dayName(warmIdx);
  }
  if (coolDelta >= 5) {
    return 'Cooling to ' + formatTemp(ahead[coolIdx].highC, units) + ' by ' + dayName(coolIdx);
  }

  // 3. A dry stretch (every remaining day under 20%)
  var allDry = true;
  for (var k = 0; k < ahead.length; k++) {
    if (ahead[k].precipProbMax >= 20) allDry = false;
  }
  if (allDry) {
    return 'Dry through ' + dayName(ahead.length - 1);
  }
  return null;
}

export interface RatingDescriptor {
  label: string;
  color: string;
}

export function describePM25(pm25: number): RatingDescriptor {
  if (pm25 <= 9) {
    return { label: 'Good', color: '#4ade80' };
  }
  if (pm25 <= 35.4) {
    return { label: 'Moderate', color: '#facc15' };
  }
  if (pm25 <= 55.4) {
    return { label: 'Sensitive', color: '#fb923c' };
  }
  if (pm25 <= 125.4) {
    return { label: 'Unhealthy', color: '#f87171' };
  }
  if (pm25 <= 225.4) {
    return { label: 'Very Unhealthy', color: '#c084fc' };
  }
  return { label: 'Hazardous', color: '#f43f5e' };
}

export function describeAQI(aqi: number): RatingDescriptor {
  if (aqi <= 50) {
    return { label: 'Good', color: '#4ade80' };
  }
  if (aqi <= 100) {
    return { label: 'Moderate', color: '#facc15' };
  }
  if (aqi <= 150) {
    return { label: 'Sensitive', color: '#fb923c' };
  }
  if (aqi <= 200) {
    return { label: 'Unhealthy', color: '#f87171' };
  }
  if (aqi <= 300) {
    return { label: 'Very Unhealthy', color: '#c084fc' };
  }
  return { label: 'Hazardous', color: '#f43f5e' };
}

export function describeUV(uv: number): RatingDescriptor {
  if (uv < 3) {
    return { label: 'Low', color: '#4ade80' };
  }
  if (uv < 6) {
    return { label: 'Moderate', color: '#facc15' };
  }
  if (uv < 8) {
    return { label: 'High', color: '#fb923c' };
  }
  if (uv < 11) {
    return { label: 'Very High', color: '#f87171' };
  }
  return { label: 'Extreme', color: '#c084fc' };
}
