export type TempUnit = 'F' | 'C';
export type TimeFormat = '12h' | '24h';

export type StockRange = '1d' | '1w' | '1m' | 'ytd' | '1y' | '2y' | '5y' | '10y' | 'all';
export type StockFormat = 'currency' | 'points' | 'yield';
export type StockCardMetric = 'abs' | 'pct' | 'mcap';

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

export interface StockSymbolConfig {
  symbol: string;
  label: string;
  name: string;
  format: StockFormat;
}

export interface StocksConfig {
  defaultRange: StockRange;
  symbols: StockSymbolConfig[];
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
  stocks?: StocksConfig;
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
  dewPointC?: number;
  humidity: number;
  windKmh: number;
  windDirDeg?: number;
  visibilityM?: number;
  weatherCode: number;
  isDay: boolean;
  cloudCover: number;
  highC: number;
  lowC: number;
  sunrise: string;
  sunset: string;
  precipSumMm?: number;
  sunshineSeconds?: number;
  tempDeltaYesterdayC?: number | null;
  rainNowcast?: string;
  usAqi?: number | null;
  pm25?: number | null;
  uvIndex?: number | null;
  hourly: HourlyForecast[];
  daily?: DailyForecast[];
}

export interface WeatherResponse {
  version: string;
  fetchedAt: string;
  config: DashboardConfig;
  weather: CityWeather[];
}

export interface StockPoint {
  t: number;
  v: number;
}

export interface StockQuote {
  symbol: string;
  label: string;
  name: string;
  format: StockFormat;
  price: number;
  previousClose: number;
  change: number;
  changePct: number;
  marketCap?: number;
  sparkline: number[];
  unavailable?: boolean;
}

export interface StockHero {
  symbol: string;
  label: string;
  name: string;
  format: StockFormat;
  currency: string;
  exchange: string;
  marketState: string;
  range: StockRange;
  price: number;
  previousClose: number;
  baseline: number;
  change: number;
  changePct: number;
  marketCap?: number;
  dayHigh: number;
  dayLow: number;
  rangeHigh?: number;
  rangeLow?: number;
  fiftyTwoWeekHigh: number;
  fiftyTwoWeekLow: number;
  volume: number;
  points: StockPoint[];
}

export interface StocksResponse {
  version: string;
  fetchedAt: string;
  marketHours: boolean;
  defaultRange: StockRange;
  hero: StockHero | null;
  quotes?: StockQuote[];
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
