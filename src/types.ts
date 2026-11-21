export type TempUnit = 'F' | 'C';
export type TimeFormat = '12h' | '24h';

export interface HeroConfig {
  lockFirstCity: boolean;
}

export interface NightModeConfig {
  enabled: boolean;
  startHour: number;
  endHour: number;
  dimOpacity: number;
}

export interface RefreshConfig {
  pollMinutes: number;
  dailyReloadHour: number;
}

export interface CityConfig {
  id: string;
  name: string;
  region: string;
  lat: number;
  lon: number;
  timezone: string;
}

export interface TripWidgetItem {
  id: string;
  title: string;
  date: string;
  emoji?: string;
}

export interface CalendarWidgetConfig {
  enabled: boolean;
}

export interface WidgetsConfig {
  trips: TripWidgetItem[];
  calendar: CalendarWidgetConfig;
}

export interface DashboardConfig {
  units: TempUnit;
  timeFormat: TimeFormat;
  hero: HeroConfig;
  nightMode: NightModeConfig;
  refresh: RefreshConfig;
  cities: CityConfig[];
  widgets: WidgetsConfig;
}

export interface HourlyForecast {
  time: string;
  tempC: number;
  weatherCode: number;
  precipProb: number;
  isDay: boolean;
}

export interface DailyForecast {
  date: string;
  weatherCode: number;
  highC: number;
  lowC: number;
  precipProbMax: number;
  uvIndexMax: number;
}

export interface CityWeather {
  cityId: string;
  utcOffsetSeconds: number;
  tempC: number;
  feelsLikeC: number;
  humidity: number;
  windKmh: number;
  weatherCode: number;
  isDay: boolean;
  cloudCover: number;
  highC: number;
  lowC: number;
  sunrise: string;
  sunset: string;
  usAqi?: number | null;
  uvIndex?: number | null;
  hourly: HourlyForecast[];
  daily?: DailyForecast[];
}

export interface DashboardResponse {
  version: string;
  fetchedAt: string;
  config: DashboardConfig;
  weather: CityWeather[];
}

export type WeatherKind =
  | 'clear'
  | 'partly-cloudy'
  | 'cloudy'
  | 'fog'
  | 'drizzle'
  | 'rain'
  | 'snow'
  | 'storm';
