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

export interface RatingDescriptor {
  label: string;
  color: string;
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
