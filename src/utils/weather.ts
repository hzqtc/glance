import type { TempUnit, WeatherKind } from '../types';

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
    return String(delta) + '° warmer than yesterday';
  }
  return String(Math.abs(delta)) + '° cooler than yesterday';
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

export interface RatingDescriptor {
  label: string;
  color: string;
}

export function describeDewPoint(dewPointC: number): RatingDescriptor {
  if (dewPointC < 10) {
    return { label: 'Crisp', color: '#60a5fa' };
  }
  if (dewPointC < 15.5) {
    return { label: 'Comfy', color: '#4ade80' };
  }
  if (dewPointC < 18.5) {
    return { label: 'Mild', color: '#a3e635' };
  }
  if (dewPointC < 21) {
    return { label: 'Humid', color: '#facc15' };
  }
  return { label: 'Muggy', color: '#fb923c' };
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
