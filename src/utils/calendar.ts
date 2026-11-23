import type { CalendarEvent, CalendarTrip, TimeFormat } from '../types';

export var MONTHS_FULL = [
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

export var MONTHS_SHORT = [
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

export var WEEKDAYS_FULL = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];

export var WEEKDAYS_MON_START = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];

export interface CalendarDayCell {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
  dateKey: string; // YYYY-MM-DD
  inCurrentMonth: boolean;
  isWeekend: boolean;
  isToday: boolean;
}

function pad2(n: number): string {
  return n < 10 ? '0' + String(n) : String(n);
}

export function toDateKey(year: number, month: number, day: number): string {
  return String(year) + '-' + pad2(month) + '-' + pad2(day);
}

export function parseDateKey(key: string): { year: number; month: number; day: number } {
  var parts = key.split('-');
  return {
    year: parseInt(parts[0], 10) || 2026,
    month: parseInt(parts[1], 10) || 1,
    day: parseInt(parts[2], 10) || 1,
  };
}

export function getTodayParts(nowMs: number): {
  year: number;
  month: number;
  day: number;
  dateKey: string;
} {
  var d = new Date(nowMs);
  var y = d.getFullYear();
  var m = d.getMonth() + 1;
  var day = d.getDate();
  return { year: y, month: m, day: day, dateKey: toDateKey(y, m, day) };
}

/** Builds a fixed 42-day (6 rows x 7 cols) Monday-to-Sunday grid for (year, month). */
export function buildMonthGridMonday(
  year: number,
  month: number,
  todayKey: string
): CalendarDayCell[] {
  var first = new Date(year, month - 1, 1);
  // JS getDay(): 0=Sun, 1=Mon..6=Sat -> Monday-first offset 0..6
  var offset = (first.getDay() + 6) % 7;
  var cells: CalendarDayCell[] = [];
  for (var i = 0; i < 42; i++) {
    var d = new Date(year, month - 1, 1 - offset + i);
    var cy = d.getFullYear();
    var cm = d.getMonth() + 1;
    var cd = d.getDate();
    var key = toDateKey(cy, cm, cd);
    var col = i % 7;
    cells.push({
      year: cy,
      month: cm,
      day: cd,
      dateKey: key,
      inCurrentMonth: cy === year && cm === month,
      isWeekend: col === 5 || col === 6,
      isToday: key === todayKey,
    });
  }
  return cells;
}

// ============================================================================
// Built-in US Holidays (works for any past or future year)
// ============================================================================

function nthWeekdayOfMonth(
  year: number,
  month: number, // 1-12
  weekday: number, // 0=Sun..6=Sat
  n: number // 1-based positive, or -1 for last
): number {
  if (n > 0) {
    var firstWd = new Date(year, month - 1, 1).getDay();
    var diff = (weekday - firstWd + 7) % 7;
    return 1 + diff + (n - 1) * 7;
  }
  var lastDay = new Date(year, month, 0).getDate();
  var lastWd = new Date(year, month - 1, lastDay).getDay();
  var back = (lastWd - weekday + 7) % 7;
  return lastDay - back;
}

export interface USHolidayInfo {
  title: string;
  isDayOff: boolean;
}

function addObservedFederalHoliday(
  map: { [dateKey: string]: USHolidayInfo },
  year: number,
  month: number,
  day: number,
  title: string
): void {
  var key = toDateKey(year, month, day);
  map[key] = { title: title, isDayOff: true };
  var wd = new Date(year, month - 1, day).getDay();
  if (wd === 6) {
    // Saturday -> observed on Friday
    var fri = new Date(year, month - 1, day - 1);
    map[toDateKey(fri.getFullYear(), fri.getMonth() + 1, fri.getDate())] = {
      title: title + ' (Observed)',
      isDayOff: true,
    };
  } else if (wd === 0) {
    // Sunday -> observed on Monday
    var mon = new Date(year, month - 1, day + 1);
    map[toDateKey(mon.getFullYear(), mon.getMonth() + 1, mon.getDate())] = {
      title: title + ' (Observed)',
      isDayOff: true,
    };
  }
}

export function getUSHolidaysForYear(year: number): { [dateKey: string]: USHolidayInfo } {
  var map: { [dateKey: string]: USHolidayInfo } = {};
  // Christmas Eve (observance, may be upgraded if Dec 25 falls on Saturday)
  map[toDateKey(year, 12, 24)] = { title: 'Christmas Eve', isDayOff: false };

  // 11 Official US Federal Holidays (day off)
  addObservedFederalHoliday(map, year, 1, 1, "New Year's Day");
  map[toDateKey(year, 1, nthWeekdayOfMonth(year, 1, 1, 3))] = {
    title: 'MLK Jr. Day',
    isDayOff: true,
  };
  map[toDateKey(year, 2, nthWeekdayOfMonth(year, 2, 1, 3))] = {
    title: "Presidents' Day",
    isDayOff: true,
  };
  map[toDateKey(year, 5, nthWeekdayOfMonth(year, 5, 1, -1))] = {
    title: 'Memorial Day',
    isDayOff: true,
  };
  if (year >= 2021) {
    addObservedFederalHoliday(map, year, 6, 19, 'Juneteenth');
  }
  addObservedFederalHoliday(map, year, 7, 4, 'Independence Day');
  map[toDateKey(year, 9, nthWeekdayOfMonth(year, 9, 1, 1))] = {
    title: 'Labor Day',
    isDayOff: true,
  };
  map[toDateKey(year, 10, nthWeekdayOfMonth(year, 10, 1, 2))] = {
    title: 'Indigenous Peoples Day',
    isDayOff: true,
  };
  addObservedFederalHoliday(map, year, 11, 11, 'Veterans Day');
  map[toDateKey(year, 11, nthWeekdayOfMonth(year, 11, 4, 4))] = {
    title: 'Thanksgiving',
    isDayOff: true,
  };
  addObservedFederalHoliday(map, year, 12, 25, 'Christmas Day');

  // If next year's Jan 1 is Saturday, Dec 31 of this year is New Year's Day (Observed)
  if (new Date(year + 1, 0, 1).getDay() === 6) {
    map[toDateKey(year, 12, 31)] = {
      title: "New Year's Day (Observed)",
      isDayOff: true,
    };
  }
  return map;
}

// ============================================================================
// 24 Chinese Solar Terms (二十四节气, 1900 - 2100)
// ============================================================================

var SOLAR_TERMS = [
  '小寒', '大寒', '立春', '雨水', '惊蛰', '春分',
  '清明', '谷雨', '立夏', '小满', '芒种', '夏至',
  '小暑', '大暑', '立秋', '处暑', '白露', '秋分',
  '寒露', '霜降', '立冬', '小雪', '大雪', '冬至',
];

var SOLAR_TERM_INFO = [
  0, 21208, 42467, 63836, 85337, 107014,
  128867, 150921, 173149, 195551, 218072, 240693,
  263343, 285989, 308563, 331033, 353350, 375494,
  397447, 419210, 440795, 462224, 483532, 504758,
];

function getSolarTermDay(year: number, termIdx: number): number {
  // Base epoch: 1900-01-06 02:05:00 UTC (canonical base for SOLAR_TERM_INFO)
  var baseUtcMs = Date.UTC(1900, 0, 6, 2, 5, 0);
  var ms = 31556925974.7 * (year - 1900) + SOLAR_TERM_INFO[termIdx] * 60000 + baseUtcMs;
  return new Date(ms).getUTCDate();
}

export function getSolarTerm(year: number, month: number, day: number): string {
  if (year < 1900 || year > 2100) return '';
  var idx1 = (month - 1) * 2;
  var idx2 = idx1 + 1;
  if (getSolarTermDay(year, idx1) === day) {
    return SOLAR_TERMS[idx1];
  }
  if (getSolarTermDay(year, idx2) === day) {
    return SOLAR_TERMS[idx2];
  }
  return '';
}

// ============================================================================
// Exact Chinese Lunar Calendar (1900 - 2100, Safari 12-safe, zero Intl quirks)
// ============================================================================

var LUNAR_INFO = [
  0x04bd8, 0x04ae0, 0x0a570, 0x054d5, 0x0d260, 0x0d950, 0x16554, 0x056a0, 0x09ad0, 0x055d2,
  0x04ae0, 0x0a5b6, 0x0a4d0, 0x0d250, 0x1d255, 0x0b540, 0x0d6a0, 0x0ada2, 0x095b0, 0x14977,
  0x04970, 0x0a4b0, 0x0b4b5, 0x06a50, 0x06d40, 0x1ab54, 0x02b60, 0x09570, 0x052f2, 0x04970,
  0x06566, 0x0d4a0, 0x0ea50, 0x06e95, 0x05ad0, 0x02b60, 0x186e3, 0x092e0, 0x1c8d7, 0x0c950,
  0x0d4a0, 0x1d8a6, 0x0b550, 0x056a0, 0x1a5b4, 0x025d0, 0x092d0, 0x0d2b2, 0x0a950, 0x0b557,
  0x06ca0, 0x0b550, 0x15355, 0x04da0, 0x0a5b0, 0x14573, 0x052b0, 0x0a9a8, 0x0e950, 0x06aa0,
  0x0aea6, 0x0ab50, 0x04b60, 0x0aae4, 0x0a570, 0x05260, 0x0f263, 0x0d950, 0x05b57, 0x056a0,
  0x096d0, 0x04dd5, 0x04ad0, 0x0a4d0, 0x0d4d4, 0x0d250, 0x0d558, 0x0b540, 0x0b6a0, 0x195a6,
  0x095b0, 0x049b0, 0x0a974, 0x0a4b0, 0x0b27a, 0x06a50, 0x06d40, 0x0af46, 0x0ab60, 0x09570,
  0x04af5, 0x04970, 0x064b0, 0x074a3, 0x0ea50, 0x06b58, 0x055c0, 0x0ab60, 0x096d5, 0x092e0,
  0x0c960, 0x0d954, 0x0d4a0, 0x0da50, 0x07552, 0x056a0, 0x0abb7, 0x025d0, 0x092d0, 0x0cab5,
  0x0a950, 0x0b4a0, 0x0baa4, 0x0ad50, 0x055d9, 0x04ba0, 0x0a5b0, 0x15176, 0x052b0, 0x0a930,
  0x07954, 0x06aa0, 0x0ad50, 0x05b52, 0x04b60, 0x0a6e6, 0x0a4e0, 0x0d260, 0x0ea65, 0x0d530,
  0x05aa0, 0x076a3, 0x096d0, 0x04afb, 0x04ad0, 0x0a4d0, 0x1d0b6, 0x0d250, 0x0d520, 0x0dd45,
  0x0b5a0, 0x056d0, 0x055b2, 0x049b0, 0x0a577, 0x0a4b0, 0x0aa50, 0x1b255, 0x06d20, 0x0ada0,
  0x14b63, 0x09370, 0x049f8, 0x04970, 0x064b0, 0x168a6, 0x0ea50, 0x06b20, 0x1a6c4, 0x0aae0,
  0x0a2e0, 0x0d2e3, 0x0c960, 0x0d557, 0x0d4a0, 0x0da50, 0x05d55, 0x056a0, 0x0a6d0, 0x055d4,
  0x052d0, 0x0a9b8, 0x0a950, 0x0b4a0, 0x0b6a6, 0x0ad50, 0x055a0, 0x0aba4, 0x0a5b0, 0x052b0,
  0x0b273, 0x06930, 0x07337, 0x06aa0, 0x0ad50, 0x14b55, 0x04b60, 0x0a570, 0x054e4, 0x0d160,
  0x0e968, 0x0d520, 0x0daa0, 0x16aa6, 0x056d0, 0x04ae0, 0x0a9d4, 0x0a2d0, 0x0d150, 0x0f252,
  0x0d520,
];

var LUNAR_MONTHS = [
  '正月',
  '二月',
  '三月',
  '四月',
  '五月',
  '六月',
  '七月',
  '八月',
  '九月',
  '十月',
  '冬月',
  '腊月',
];

var LUNAR_DAYS = [
  '初一', '初二', '初三', '初四', '初五', '初六', '初七', '初八', '初九', '初十',
  '十一', '十二', '十三', '十四', '十五', '十六', '十七', '十八', '十九', '二十',
  '廿一', '廿二', '廿三', '廿四', '廿五', '廿六', '廿七', '廿八', '廿九', '三十',
];

function lunarLeapMonth(y: number): number {
  return LUNAR_INFO[y - 1900] & 0xf;
}

function lunarLeapDays(y: number): number {
  if (lunarLeapMonth(y)) {
    return (LUNAR_INFO[y - 1900] & 0x10000) !== 0 ? 30 : 29;
  }
  return 0;
}

function lunarMonthDays(y: number, m: number): number {
  return (LUNAR_INFO[y - 1900] & (0x10000 >> m)) !== 0 ? 30 : 29;
}

function lunarYearDays(y: number): number {
  var sum = 348;
  var info = LUNAR_INFO[y - 1900];
  for (var i = 0x8000; i > 0x8; i >>= 1) {
    if ((info & i) !== 0) sum += 1;
  }
  return sum + lunarLeapDays(y);
}

export interface LunarDateInfo {
  label: string;
  fullLabel: string;
  festival: string;
  solarTerm: string;
  isFestival: boolean;
  isSolarTerm: boolean;
}

// Each date is computed once: the 3-month calendar strip asks for 126 dates
// per render, and the computation walks lunar years from 1900.
var lunarDateCache: { [key: number]: LunarDateInfo | null } = {};

export function getChineseLunarDate(
  year: number,
  month: number,
  day: number
): LunarDateInfo | null {
  var cacheKey = year * 10000 + month * 100 + day;
  if (cacheKey in lunarDateCache) {
    return lunarDateCache[cacheKey];
  }
  var result = computeChineseLunarDate(year, month, day);
  lunarDateCache[cacheKey] = result;
  return result;
}

function computeChineseLunarDate(
  year: number,
  month: number,
  day: number
): LunarDateInfo | null {
  if (year < 1900 || year > 2100) {
    return null;
  }

  var baseMs = Date.UTC(1900, 0, 31);
  var targetMs = Date.UTC(year, month - 1, day);
  var offset = Math.floor((targetMs - baseMs) / 86400000);
  if (offset < 0) return null;

  var lYear = 1900;
  var daysInYear = 0;
  for (; lYear <= 2100 && offset > 0; lYear++) {
    daysInYear = lunarYearDays(lYear);
    if (offset < daysInYear) {
      break;
    }
    offset -= daysInYear;
  }

  var leap = lunarLeapMonth(lYear);
  var isLeap = false;
  var leapDone = false;
  var lMonth = 1;
  var daysInMonth = 0;
  for (; lMonth <= 12 && offset >= 0; lMonth++) {
    if (leap > 0 && lMonth === leap + 1 && !isLeap && !leapDone) {
      lMonth--;
      isLeap = true;
      daysInMonth = lunarLeapDays(lYear);
    } else {
      daysInMonth = lunarMonthDays(lYear, lMonth);
    }
    if (offset < daysInMonth) {
      break;
    }
    offset -= daysInMonth;
    if (isLeap && lMonth === leap) {
      isLeap = false;
      leapDone = true;
    }
  }

  var lDay = offset + 1;
  var monthStr = (isLeap ? '闰' : '') + LUNAR_MONTHS[lMonth - 1];
  var dayStr = LUNAR_DAYS[lDay - 1] || '';
  var solarTerm = getSolarTerm(year, month, day);

  // Traditional Chinese festivals (农历传统节日 + 清明节)
  var festival = '';
  if (!isLeap) {
    if (lMonth === 1 && lDay === 1) festival = '春节';
    else if (lMonth === 1 && lDay === 15) festival = '元宵节';
    else if (lMonth === 2 && lDay === 2) festival = '龙抬头';
    else if (lMonth === 5 && lDay === 5) festival = '端午节';
    else if (lMonth === 7 && lDay === 7) festival = '七夕';
    else if (lMonth === 7 && lDay === 15) festival = '中元节';
    else if (lMonth === 8 && lDay === 15) festival = '中秋节';
    else if (lMonth === 9 && lDay === 9) festival = '重阳节';
    else if (lMonth === 12 && lDay === 8) festival = '腊八节';
    else if (lMonth === 12 && lDay === 23) festival = '小年';
    else if (lMonth === 12 && lDay === lunarMonthDays(lYear, 12)) festival = '除夕';
  }
  if (!festival && solarTerm === '清明') {
    festival = '清明节';
  }

  var label = festival
    ? festival
    : solarTerm
      ? solarTerm
      : lDay === 1
        ? monthStr
        : dayStr;

  var fullParts = ['农历' + monthStr + dayStr];
  if (festival) {
    fullParts.push(festival);
  }
  if (solarTerm && solarTerm !== '清明') {
    fullParts.push(solarTerm);
  }

  return {
    label: label,
    fullLabel: fullParts.join(' · '),
    festival: festival,
    solarTerm: solarTerm,
    isFestival: Boolean(festival),
    isSolarTerm: Boolean(solarTerm) && !festival,
  };
}

// ============================================================================
// Formatting Helpers
// ============================================================================

export function formatHHMM(hhmm: string | undefined, timeFormat: TimeFormat): string {
  if (!hhmm) return '';
  var parts = hhmm.split(':');
  var h = parseInt(parts[0], 10);
  var m = parseInt(parts[1], 10);
  if (isNaN(h) || isNaN(m)) return hhmm;
  if (timeFormat === '24h') {
    return pad2(h) + ':' + pad2(m);
  }
  var ampm = h >= 12 ? 'PM' : 'AM';
  var h12 = h % 12;
  return String(h12 === 0 ? 12 : h12) + ':' + pad2(m) + ' ' + ampm;
}

export function formatEventTimeRange(ev: CalendarEvent, timeFormat: TimeFormat): string {
  if (ev.allDay) return 'All Day';
  var start = formatHHMM(ev.startTime, timeFormat);
  var end = formatHHMM(ev.endTime, timeFormat);
  if (!end || end === start) return start;
  return start + ' – ' + end;
}

export function diffDateKeys(fromKey: string, toKey: string): number {
  var a = parseDateKey(fromKey);
  var b = parseDateKey(toKey);
  return Math.round(
    (Date.UTC(b.year, b.month - 1, b.day) - Date.UTC(a.year, a.month - 1, a.day)) /
      86400000
  );
}

export interface TripCountdownInfo {
  badge: string;
  dateLabel: string;
  daysUntil: number;
  isOngoing: boolean;
  isSoon: boolean;
}

export function formatTripCountdown(
  trip: CalendarTrip,
  todayKey: string
): TripCountdownInfo {
  var daysUntil = diffDateKeys(todayKey, trip.startDate);
  var p = parseDateKey(trip.startDate);
  var dateLabel = MONTHS_SHORT[p.month - 1] + ' ' + String(p.day);

  if (daysUntil < 0) {
    var dayNum = -daysUntil + 1;
    var badge =
      trip.days > 1
        ? 'Day ' + String(dayNum) + '/' + String(trip.days)
        : 'Today';
    return {
      badge: badge,
      dateLabel: '',
      daysUntil: daysUntil,
      isOngoing: true,
      isSoon: true,
    };
  }
  if (daysUntil === 0) {
    return {
      badge: 'Today',
      dateLabel: '',
      daysUntil: 0,
      isOngoing: true,
      isSoon: true,
    };
  }
  if (daysUntil === 1) {
    return {
      badge: 'Tomorrow',
      dateLabel: '',
      daysUntil: 1,
      isOngoing: false,
      isSoon: true,
    };
  }
  return {
    badge: 'In ' + String(daysUntil) + 'd',
    dateLabel: dateLabel,
    daysUntil: daysUntil,
    isOngoing: false,
    isSoon: daysUntil <= 7,
  };
}

export function formatRelativeDayLabel(selectedKey: string, todayKey: string): string {
  if (selectedKey === todayKey) return 'Today';
  var diffDays = diffDateKeys(todayKey, selectedKey);
  if (diffDays === 1) return 'Tomorrow';
  if (diffDays === -1) return 'Yesterday';
  if (diffDays > 1 && diffDays <= 30) return 'In ' + String(diffDays) + 'd';
  if (diffDays < -1 && diffDays >= -30) return String(-diffDays) + 'd ago';
  return '';
}

export function formatNextEventCountdown(
  ev: CalendarEvent,
  nowMs: number,
  todayKey: string,
  timeFormat: TimeFormat
): string {
  if (nowMs >= ev.startMs && nowMs < ev.endMs) {
    return 'Now';
  }
  var diffMin = Math.max(1, Math.round((ev.startMs - nowMs) / 60000));
  if (diffMin < 60) {
    return 'in ' + String(diffMin) + 'm';
  }
  if (diffMin < 12 * 60 && ev.date === todayKey) {
    var hrs = Math.floor(diffMin / 60);
    var mins = diffMin % 60;
    return mins > 0 ? 'in ' + String(hrs) + 'h ' + String(mins) + 'm' : 'in ' + String(hrs) + 'h';
  }
  var rel = formatRelativeDayLabel(ev.date, todayKey);
  if (rel === 'Tomorrow') {
    return 'Tomorrow ' + formatHHMM(ev.startTime, timeFormat);
  }
  var p = parseDateKey(ev.date);
  return MONTHS_SHORT[p.month - 1] + ' ' + String(p.day) + ' · ' + formatHHMM(ev.startTime, timeFormat);
}
