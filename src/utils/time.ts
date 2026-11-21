import type { TimeFormat } from '../types';

const WEEKDAYS_LONG = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];

const WEEKDAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const MONTHS_LONG = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

const MONTHS_SHORT = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

export interface CityClockInfo {
  hoursDisplay: string;
  minutesDisplay: string;
  ampm: string;
  hour24: number;
  minute: number;
  second: number;
  minutesSinceMidnight: number;
  longDate: string;
  shortDate: string;
  daySerial: number;
}

function pad2(n: number): string {
  return n < 10 ? '0' + String(n) : String(n);
}

/**
 * Safari 12-safe timezone clock calculation.
 * Uses Open-Meteo's exact utcOffsetSeconds (already DST-adjusted) when available,
 * avoiding outdated iOS 12 ICU timezone tables. Falls back to local Date if offset is absent.
 */
export function getCityClock(
  nowMs: number,
  utcOffsetSeconds: number | undefined,
  timeFormat: TimeFormat
): CityClockInfo {
  var offsetSec =
    typeof utcOffsetSeconds === 'number'
      ? utcOffsetSeconds
      : -new Date(nowMs).getTimezoneOffset() * 60;

  var shifted = new Date(nowMs + offsetSec * 1000);
  var year = shifted.getUTCFullYear();
  var month = shifted.getUTCMonth();
  var day = shifted.getUTCDate();
  var weekday = shifted.getUTCDay();
  var hour24 = shifted.getUTCHours();
  var minute = shifted.getUTCMinutes();
  var second = shifted.getUTCSeconds();

  var hoursDisplay: string;
  var ampm = '';
  if (timeFormat === '24h') {
    hoursDisplay = pad2(hour24);
  } else {
    ampm = hour24 >= 12 ? 'PM' : 'AM';
    var h12 = hour24 % 12;
    hoursDisplay = String(h12 === 0 ? 12 : h12);
  }

  var daySerial = Math.floor(Date.UTC(year, month, day) / 86400000);

  return {
    hoursDisplay: hoursDisplay,
    minutesDisplay: pad2(minute),
    ampm: ampm,
    hour24: hour24,
    minute: minute,
    second: second,
    minutesSinceMidnight: hour24 * 60 + minute + second / 60,
    longDate:
      WEEKDAYS_LONG[weekday] + ', ' + MONTHS_LONG[month] + ' ' + String(day),
    shortDate:
      WEEKDAYS_SHORT[weekday] + ', ' + MONTHS_SHORT[month] + ' ' + String(day),
    daySerial: daySerial,
  };
}

export function formatHourOffset(
  cityOffsetSeconds: number,
  homeOffsetSeconds: number
): string {
  var diffHours = Math.round((cityOffsetSeconds - homeOffsetSeconds) / 3600);
  if (diffHours === 0) {
    return 'SAME';
  }
  return (diffHours > 0 ? '+' : '') + String(diffHours) + 'h';
}

export function parseMinutesFromHHMM(hhmm: string, fallback: number): number {
  if (!hhmm || hhmm.indexOf(':') === -1) {
    return fallback;
  }
  var parts = hhmm.split(':');
  var h = parseInt(parts[0], 10);
  var m = parseInt(parts[1], 10);
  if (isNaN(h) || isNaN(m)) {
    return fallback;
  }
  return h * 60 + m;
}

export function formatClockHHMM(hhmm: string, timeFormat: TimeFormat): string {
  var mins = parseMinutesFromHHMM(hhmm, -1);
  if (mins < 0) {
    return hhmm;
  }
  var h = Math.floor(mins / 60) % 24;
  var m = mins % 60;
  if (timeFormat === '24h') {
    return pad2(h) + ':' + pad2(m);
  }
  var ampm = h >= 12 ? 'PM' : 'AM';
  var h12 = h % 12;
  return String(h12 === 0 ? 12 : h12) + ':' + pad2(m) + ' ' + ampm;
}

export function formatHourlyLabel(isoTime: string, timeFormat: TimeFormat): string {
  var tIdx = isoTime.indexOf('T');
  if (tIdx === -1 || tIdx + 3 > isoTime.length) {
    return isoTime;
  }
  var h = parseInt(isoTime.slice(tIdx + 1, tIdx + 3), 10);
  if (isNaN(h)) {
    return isoTime;
  }
  if (timeFormat === '24h') {
    return pad2(h) + ':00';
  }
  var ampm = h >= 12 ? 'PM' : 'AM';
  var h12 = h % 12;
  return String(h12 === 0 ? 12 : h12) + ' ' + ampm;
}

export function isNightQuietHours(
  hour24: number,
  startHour: number,
  endHour: number
): boolean {
  if (startHour === endHour) {
    return false;
  }
  if (startHour > endHour) {
    return hour24 >= startHour || hour24 < endHour;
  }
  return hour24 >= startHour && hour24 < endHour;
}

export function formatWeekdayFromISO(isoDate: string, isFirstDay: boolean): string {
  if (isFirstDay) {
    return 'Today';
  }
  var parts = isoDate.split('-');
  if (parts.length !== 3) {
    return isoDate;
  }
  var y = parseInt(parts[0], 10);
  var m = parseInt(parts[1], 10);
  var d = parseInt(parts[2], 10);
  if (isNaN(y) || isNaN(m) || isNaN(d)) {
    return isoDate;
  }
  var dt = new Date(Date.UTC(y, m - 1, d));
  return WEEKDAYS_SHORT[dt.getUTCDay()];
}

export interface DaylightProgress {
  isDaylight: boolean;
  progress: number; // 0..1 across daylight (or night)
  remainingDuration: string;
  remainingText: string;
  durationText: string;
}

function formatDurationMinutes(totalMinutes: number): string {
  var mins = Math.max(0, Math.round(totalMinutes));
  var h = Math.floor(mins / 60);
  var m = mins % 60;
  if (h === 0) {
    return String(m) + 'm';
  }
  return String(h) + 'h ' + String(m) + 'm';
}

export function computeDaylightProgress(
  minutesSinceMidnight: number,
  sunriseMin: number,
  sunsetMin: number
): DaylightProgress {
  var daySpan = Math.max(60, sunsetMin - sunriseMin);
  var durationText = formatDurationMinutes(daySpan) + ' daylight';

  if (minutesSinceMidnight >= sunriseMin && minutesSinceMidnight <= sunsetMin) {
    var prog = (minutesSinceMidnight - sunriseMin) / daySpan;
    var left = sunsetMin - minutesSinceMidnight;
    var leftStr = formatDurationMinutes(left);
    return {
      isDaylight: true,
      progress: prog < 0 ? 0 : prog > 1 ? 1 : prog,
      remainingDuration: leftStr,
      remainingText: leftStr + ' until sunset',
      durationText: durationText,
    };
  }

  var nightSpan = Math.max(60, 1440 - daySpan);
  var sinceSunset =
    minutesSinceMidnight > sunsetMin
      ? minutesSinceMidnight - sunsetMin
      : minutesSinceMidnight + (1440 - sunsetMin);
  var untilSunrise =
    minutesSinceMidnight < sunriseMin
      ? sunriseMin - minutesSinceMidnight
      : 1440 - minutesSinceMidnight + sunriseMin;
  var nightProg = sinceSunset / nightSpan;
  var untilStr = formatDurationMinutes(untilSunrise);

  return {
    isDaylight: false,
    progress: nightProg < 0 ? 0 : nightProg > 1 ? 1 : nightProg,
    remainingDuration: untilStr,
    remainingText: untilStr + ' until sunrise',
    durationText: durationText,
  };
}

/**
 * Returns the astronomical lunar phase in [0, 1):
 * 0.00 = New Moon, 0.25 = First Quarter, 0.50 = Full Moon, 0.75 = Last Quarter.
 */
export function getMoonPhase(nowMs: number): number {
  var knownNewMoonMs = 947182440000; // 2000-01-06T18:14:00Z
  var synodicMonthMs = 29.53058867 * 86400000;
  var cycles = (nowMs - knownNewMoonMs) / synodicMonthMs;
  var phase = cycles - Math.floor(cycles);
  return phase < 0 ? phase + 1 : phase;
}
