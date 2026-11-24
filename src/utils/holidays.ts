// ============================================================================
// Seasonal holiday themes for the Photos frame (US + Chinese festivals)
// ============================================================================
//
// Each theme has a date window. On a holiday's own day ("peak") it beats any
// other theme's lead-up window; otherwise the earlier entry in HOLIDAY_THEMES
// wins. Lunar festivals use the bundled Chinese calendar (1900-2100).

import { getChineseLunarDate, toDateKey } from './calendar';
import type { LunarDateInfo } from './calendar';

export type HolidayThemeId =
  | 'lunar-new-year'
  | 'lantern'
  | 'dragon-boat'
  | 'qixi'
  | 'mid-autumn'
  | 'new-year'
  | 'valentines'
  | 'st-patricks'
  | 'easter'
  | 'mothers-day'
  | 'fathers-day'
  | 'independence'
  | 'halloween'
  | 'thanksgiving'
  | 'christmas';

export interface ActiveHolidayTheme {
  id: HolidayThemeId;
  name: string;
  isPeak: boolean;
}

interface DayInfo {
  year: number;
  month: number; // 1-12
  day: number;
  /** Days since epoch (local calendar day), for offset comparisons */
  dayNum: number;
  lunar: LunarDateInfo | null;
}

interface HolidayThemeDef {
  id: HolidayThemeId;
  name: string;
  /** Returns 'peak' on the holiday itself, 'window' during lead-up, or null */
  match: (d: DayInfo) => 'peak' | 'window' | null;
}

function dayNumOf(year: number, month: number, day: number): number {
  return Math.round(Date.UTC(year, month - 1, day) / 86400000);
}

function nthWeekday(year: number, month: number, weekday: number, n: number): number {
  var firstWd = new Date(year, month - 1, 1).getDay();
  return 1 + ((weekday - firstWd + 7) % 7) + (n - 1) * 7;
}

/** Anonymous Gregorian algorithm (Meeus/Jones/Butcher) */
function easterSunday(year: number): { month: number; day: number } {
  var a = year % 19;
  var b = Math.floor(year / 100);
  var c = year % 100;
  var d = Math.floor(b / 4);
  var e = b % 4;
  var f = Math.floor((b + 8) / 25);
  var g = Math.floor((b - f + 1) / 3);
  var h = (19 * a + b - d - g + 15) % 30;
  var i = Math.floor(c / 4);
  var k = c % 4;
  var l = (32 + 2 * e + 2 * i - h - k) % 7;
  var m = Math.floor((a + 11 * h + 22 * l) / 451);
  var month = Math.floor((h + l - 7 * m + 114) / 31);
  var day = ((h + l - 7 * m + 114) % 31) + 1;
  return { month: month, day: day };
}

/** Window of [peak - before, peak + after] days around a fixed-per-year solar date */
function aroundDate(
  d: DayInfo,
  peakMonth: number,
  peakDay: number,
  before: number,
  after: number
): 'peak' | 'window' | null {
  var diff = d.dayNum - dayNumOf(d.year, peakMonth, peakDay);
  if (diff === 0) return 'peak';
  if (diff >= -before && diff <= after) return 'window';
  return null;
}

/** Lunar month/day range within a single (non-leap) lunar month */
function lunarRange(
  d: DayInfo,
  lMonth: number,
  fromDay: number,
  peakDay: number,
  toDay: number
): 'peak' | 'window' | null {
  var l = d.lunar;
  if (!l || l.isLeapMonth || l.lunarMonth !== lMonth) return null;
  if (l.lunarDay === peakDay) return 'peak';
  if (l.lunarDay >= fromDay && l.lunarDay <= toDay) return 'window';
  return null;
}

var HOLIDAY_THEMES: HolidayThemeDef[] = [
  {
    // 小年 (腊月廿三) through 初七 (人日)
    id: 'lunar-new-year',
    name: 'Lunar New Year',
    match: function (d) {
      var l = d.lunar;
      if (!l || l.isLeapMonth) return null;
      if (l.isLastDayOfYear || (l.lunarMonth === 1 && l.lunarDay === 1)) return 'peak';
      if (l.lunarMonth === 12 && l.lunarDay >= 23) return 'window';
      if (l.lunarMonth === 1 && l.lunarDay <= 7) return 'window';
      return null;
    },
  },
  {
    id: 'lantern',
    name: 'Lantern Festival',
    match: function (d) {
      return lunarRange(d, 1, 13, 15, 15);
    },
  },
  {
    id: 'dragon-boat',
    name: 'Dragon Boat Festival',
    match: function (d) {
      return lunarRange(d, 5, 1, 5, 5);
    },
  },
  {
    id: 'qixi',
    name: 'Qixi Festival',
    match: function (d) {
      return lunarRange(d, 7, 5, 7, 7);
    },
  },
  {
    id: 'mid-autumn',
    name: 'Mid-Autumn Festival',
    match: function (d) {
      return lunarRange(d, 8, 10, 15, 16);
    },
  },
  {
    // Dec 27 - Jan 2
    id: 'new-year',
    name: "New Year's",
    match: function (d) {
      if (d.month === 12 && d.day === 31) return 'peak';
      if (d.month === 1 && d.day === 1) return 'peak';
      if (d.month === 12 && d.day >= 27) return 'window';
      if (d.month === 1 && d.day <= 2) return 'window';
      return null;
    },
  },
  {
    id: 'valentines',
    name: "Valentine's Day",
    match: function (d) {
      return aroundDate(d, 2, 14, 4, 0);
    },
  },
  {
    id: 'st-patricks',
    name: "St. Patrick's Day",
    match: function (d) {
      return aroundDate(d, 3, 17, 3, 0);
    },
  },
  {
    // Palm Sunday through Easter Sunday
    id: 'easter',
    name: 'Easter',
    match: function (d) {
      var e = easterSunday(d.year);
      return aroundDate(d, e.month, e.day, 7, 0);
    },
  },
  {
    // Thursday through 2nd Sunday of May
    id: 'mothers-day',
    name: "Mother's Day",
    match: function (d) {
      return aroundDate(d, 5, nthWeekday(d.year, 5, 0, 2), 3, 0);
    },
  },
  {
    // Thursday through 3rd Sunday of June
    id: 'fathers-day',
    name: "Father's Day",
    match: function (d) {
      return aroundDate(d, 6, nthWeekday(d.year, 6, 0, 3), 3, 0);
    },
  },
  {
    id: 'independence',
    name: 'Independence Day',
    match: function (d) {
      return aroundDate(d, 7, 4, 3, 0);
    },
  },
  {
    id: 'halloween',
    name: 'Halloween',
    match: function (d) {
      return aroundDate(d, 10, 31, 14, 0);
    },
  },
  {
    // Monday through Sunday of Thanksgiving week
    id: 'thanksgiving',
    name: 'Thanksgiving',
    match: function (d) {
      return aroundDate(d, 11, nthWeekday(d.year, 11, 4, 4), 3, 3);
    },
  },
  {
    // Monday after Thanksgiving weekend through Dec 26
    id: 'christmas',
    name: 'Christmas',
    match: function (d) {
      if (d.month === 12 && (d.day === 24 || d.day === 25)) return 'peak';
      var start = dayNumOf(d.year, 11, nthWeekday(d.year, 11, 4, 4)) + 4;
      if (d.dayNum >= start && d.dayNum <= dayNumOf(d.year, 12, 26)) return 'window';
      return null;
    },
  },
];

function buildDayInfo(year: number, month: number, day: number): DayInfo {
  return {
    year: year,
    month: month,
    day: day,
    dayNum: dayNumOf(year, month, day),
    lunar: getChineseLunarDate(year, month, day),
  };
}

function toActive(def: HolidayThemeDef, d: DayInfo, isPeak: boolean): ActiveHolidayTheme {
  return {
    id: def.id,
    name: def.name,
    isPeak: isPeak,
  };
}

export function getHolidayThemeForDate(
  year: number,
  month: number,
  day: number
): ActiveHolidayTheme | null {
  var d = buildDayInfo(year, month, day);
  var windowHit: HolidayThemeDef | null = null;
  for (var i = 0; i < HOLIDAY_THEMES.length; i++) {
    var def = HOLIDAY_THEMES[i];
    var res = def.match(d);
    if (res === 'peak') return toActive(def, d, true);
    if (res === 'window' && !windowHit) windowHit = def;
  }
  return windowHit ? toActive(windowHit, d, false) : null;
}

var cachedKey = '';
var cachedTheme: ActiveHolidayTheme | null = null;

/**
 * Active theme for the local calendar day of `nowMs`. `?holiday=<id>` forces
 * a theme for previewing; `?holiday=off` disables the frame.
 */
export function getActiveHolidayTheme(nowMs: number): ActiveHolidayTheme | null {
  var forced = getForcedHolidayParam();
  if (forced === 'off') return null;
  var now = new Date(nowMs);
  var y = now.getFullYear();
  var m = now.getMonth() + 1;
  var dd = now.getDate();
  if (forced) {
    for (var i = 0; i < HOLIDAY_THEMES.length; i++) {
      if (HOLIDAY_THEMES[i].id === forced) {
        return toActive(HOLIDAY_THEMES[i], buildDayInfo(y, m, dd), true);
      }
    }
  }
  var key = toDateKey(y, m, dd);
  if (key !== cachedKey) {
    cachedKey = key;
    cachedTheme = getHolidayThemeForDate(y, m, dd);
  }
  return cachedTheme;
}

function getForcedHolidayParam(): string {
  if (typeof window === 'undefined' || !window.location) return '';
  var match = /[?&]holiday=([a-z-]+)/i.exec(window.location.search || '');
  return match ? match[1].toLowerCase() : '';
}
