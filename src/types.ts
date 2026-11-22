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

export type CarouselSlideName = 'weather' | 'stocks' | 'calendar' | 'photos';

export interface CarouselScheduleStep {
  slide: CarouselSlideName | 'stock' | 'photo';
  seconds: number;
}

export interface CarouselConfig {
  autoRotate: boolean;
  intervalSeconds: number;
  manualPauseSeconds: number;
  schedule?: CarouselScheduleStep[];
}

export interface PhotosConfig {
  slideIntervalSeconds: number;
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

export interface DashboardConfig {
  units: TempUnit;
  timeFormat: TimeFormat;
  hero: HeroConfig;
  nightMode: NightModeConfig;
  refresh: RefreshConfig;
  carousel?: CarouselConfig;
  photos?: PhotosConfig;
  cities: CityConfig[];
  stocks?: StocksConfig;
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
  marketTime?: number;
  range: StockRange;
  price: number;
  previousClose: number;
  baseline: number;
  change: number;
  changePct: number;
  marketCap?: number;
  extendedLabel?: string;
  extendedPrice?: number;
  extendedChange?: number;
  extendedChangePct?: number;
  sessionStart?: number;
  regularStart?: number;
  regularEnd?: number;
  sessionEnd?: number;
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

export interface CalendarMeta {
  id: string;
  name: string;
  color: string;
}

export interface CalendarEvent {
  id: string;
  calendarId: string;
  calendarName: string;
  color: string;
  title: string;
  location?: string;
  date: string; // YYYY-MM-DD
  allDay: boolean;
  startMs: number;
  endMs: number;
  startTime?: string; // HH:MM
  endTime?: string; // HH:MM
  isHoliday?: boolean;
}

export interface CalendarTrip {
  id: string;
  calendarId: string;
  calendarName: string;
  color: string;
  title: string;
  displayName: string;
  location?: string;
  startDate: string; // YYYY-MM-DD inclusive
  endDate: string; // YYYY-MM-DD inclusive
  days: number;
}

export interface CalendarResponse {
  version: string;
  fetchedAt: string;
  timezone: string;
  year: number;
  month: number;
  configured: boolean;
  calendars: CalendarMeta[];
  events: CalendarEvent[];
  nextEvent?: CalendarEvent | null;
  upcomingTrips?: CalendarTrip[];
  warnings?: string[];
}

export interface PhotoItem {
  id: string;
  fullUrl: string;
  tileUrl: string;
  width: number;
  height: number;
  aspect: number;
}

export interface PhotosResponse {
  fetchedAt: string;
  configured: boolean;
  albumCount: number;
  photoCount: number;
  photos: PhotoItem[];
  warnings?: string[];
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
