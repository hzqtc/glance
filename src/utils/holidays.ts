// ============================================================================
// Seasonal holiday themes for the Photos frame (US + Chinese festivals)
// ============================================================================
//
// Each theme has a configurable enabled flag and start/end date window via
// `photos.holidayThemes` in dashboard.config.json. Supported date formats:
//   - Solar month-day:     "MM-DD" (e.g. "12-01", wraps across New Year)
//   - Exact solar date:    "YYYY-MM-DD" (e.g. "2026-12-01")
//   - Chinese lunar date:  "lunar-MM-DD" (e.g. "lunar-12-23", wraps across 腊月->正月)
//   - Floating anchor:     "easter", "mothers-day", "fathers-day", "thanksgiving"
//                          with optional day offset like "easter-7d" or "thanksgiving+4d"
//
// On a holiday's own day ("peak") it beats any other theme's lead-up window;
// otherwise the earlier entry in HOLIDAY_THEMES wins.

import type { HolidayThemeConfig } from '../types';
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
  defaultStart: string;
  defaultEnd: string;
  isPeak: (d: DayInfo) => boolean;
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
  var k = c % 100;
  var l = (32 + 2 * e + 2 * i - h - k) % 7;
  var m = Math.floor((a + 11 * h + 22 * l) / 451);
  var month = Math.floor((h + l - 7 * m + 114) / 31);
  var day = ((h + l - 7 * m + 114) % 31) + 1;
  return { month: month, day: day };
}

type ParsedSpec =
  | { kind: 'lunar'; md: number }
  | { kind: 'exact'; dayNum: number }
  | { kind: 'solar'; dayNum: number };

function parseDateSpec(raw: string, year: number): ParsedSpec | null {
  var s = (raw || '').trim().toLowerCase();
  if (!s) return null;

  // Lunar month-day: "lunar-MM-DD"
  var lm = /^lunar-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (lm) {
    var lMonth = parseInt(lm[1], 10);
    var lDay = parseInt(lm[2], 10);
    if (lMonth >= 1 && lMonth <= 12 && lDay >= 1 && lDay <= 30) {
      return { kind: 'lunar', md: lMonth * 100 + lDay };
    }
    return null;
  }

  // Exact solar date: "YYYY-MM-DD"
  var em = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (em) {
    var ey = parseInt(em[1], 10);
    var eMon = parseInt(em[2], 10);
    var eDay = parseInt(em[3], 10);
    if (eMon >= 1 && eMon <= 12 && eDay >= 1 && eDay <= 31) {
      return { kind: 'exact', dayNum: dayNumOf(ey, eMon, eDay) };
    }
    return null;
  }

  // Recurring solar month-day: "MM-DD"
  var sm = /^(\d{1,2})-(\d{1,2})$/.exec(s);
  if (sm) {
    var sMon = parseInt(sm[1], 10);
    var sDay = parseInt(sm[2], 10);
    if (sMon >= 1 && sMon <= 12 && sDay >= 1 && sDay <= 31) {
      return { kind: 'solar', dayNum: dayNumOf(year, sMon, sDay) };
    }
    return null;
  }

  // Floating holiday anchor with optional day offset, e.g. "easter-7d", "thanksgiving+4d"
  var am = /^(easter|mothers-day|fathers-day|thanksgiving)(?:([+-]\d+)d?)?$/.exec(s);
  if (am) {
    var anchor = am[1];
    var offset = am[2] ? parseInt(am[2], 10) : 0;
    var baseNum = 0;
    if (anchor === 'easter') {
      var ea = easterSunday(year);
      baseNum = dayNumOf(year, ea.month, ea.day);
    } else if (anchor === 'mothers-day') {
      baseNum = dayNumOf(year, 5, nthWeekday(year, 5, 0, 2));
    } else if (anchor === 'fathers-day') {
      baseNum = dayNumOf(year, 6, nthWeekday(year, 6, 0, 3));
    } else if (anchor === 'thanksgiving') {
      baseNum = dayNumOf(year, 11, nthWeekday(year, 11, 4, 4));
    }
    return { kind: 'solar', dayNum: baseNum + offset };
  }

  return null;
}

function isInConfiguredWindow(d: DayInfo, startStr: string, endStr: string): boolean {
  var startSpec = parseDateSpec(startStr, d.year);
  var endSpec = parseDateSpec(endStr, d.year);
  if (!startSpec || !endSpec) return false;

  if (startSpec.kind === 'lunar' && endSpec.kind === 'lunar') {
    var l = d.lunar;
    if (!l || l.isLeapMonth) return false;
    var curMD = l.lunarMonth * 100 + l.lunarDay;
    if (startSpec.md <= endSpec.md) {
      return curMD >= startSpec.md && curMD <= endSpec.md;
    }
    // Wraps across lunar year boundary (e.g. lunar-12-23 through lunar-01-07)
    return curMD >= startSpec.md || curMD <= endSpec.md;
  }

  if (startSpec.kind !== 'lunar' && endSpec.kind !== 'lunar') {
    if (startSpec.kind === 'exact' || endSpec.kind === 'exact') {
      return d.dayNum >= startSpec.dayNum && d.dayNum <= endSpec.dayNum;
    }
    if (startSpec.dayNum <= endSpec.dayNum) {
      return d.dayNum >= startSpec.dayNum && d.dayNum <= endSpec.dayNum;
    }
    // Wraps across solar year boundary (e.g. 12-27 through 01-02)
    return d.dayNum >= startSpec.dayNum || d.dayNum <= endSpec.dayNum;
  }

  return false;
}

var HOLIDAY_THEMES: HolidayThemeDef[] = [
  {
    // 小年 (腊月廿三) through 初七 (人日)
    id: 'lunar-new-year',
    name: 'Lunar New Year',
    defaultStart: 'lunar-12-23',
    defaultEnd: 'lunar-01-07',
    isPeak: function (d) {
      var l = d.lunar;
      return Boolean(l && !l.isLeapMonth && (l.isLastDayOfYear || (l.lunarMonth === 1 && l.lunarDay === 1)));
    },
  },
  {
    id: 'lantern',
    name: 'Lantern Festival',
    defaultStart: 'lunar-01-13',
    defaultEnd: 'lunar-01-15',
    isPeak: function (d) {
      var l = d.lunar;
      return Boolean(l && !l.isLeapMonth && l.lunarMonth === 1 && l.lunarDay === 15);
    },
  },
  {
    id: 'dragon-boat',
    name: 'Dragon Boat Festival',
    defaultStart: 'lunar-05-01',
    defaultEnd: 'lunar-05-05',
    isPeak: function (d) {
      var l = d.lunar;
      return Boolean(l && !l.isLeapMonth && l.lunarMonth === 5 && l.lunarDay === 5);
    },
  },
  {
    id: 'qixi',
    name: 'Qixi Festival',
    defaultStart: 'lunar-07-05',
    defaultEnd: 'lunar-07-07',
    isPeak: function (d) {
      var l = d.lunar;
      return Boolean(l && !l.isLeapMonth && l.lunarMonth === 7 && l.lunarDay === 7);
    },
  },
  {
    id: 'mid-autumn',
    name: 'Mid-Autumn Festival',
    defaultStart: 'lunar-08-10',
    defaultEnd: 'lunar-08-16',
    isPeak: function (d) {
      var l = d.lunar;
      return Boolean(l && !l.isLeapMonth && l.lunarMonth === 8 && l.lunarDay === 15);
    },
  },
  {
    id: 'new-year',
    name: "New Year's",
    defaultStart: '12-27',
    defaultEnd: '01-02',
    isPeak: function (d) {
      return (d.month === 12 && d.day === 31) || (d.month === 1 && d.day === 1);
    },
  },
  {
    id: 'valentines',
    name: "Valentine's Day",
    defaultStart: '02-10',
    defaultEnd: '02-14',
    isPeak: function (d) {
      return d.month === 2 && d.day === 14;
    },
  },
  {
    id: 'st-patricks',
    name: "St. Patrick's Day",
    defaultStart: '03-14',
    defaultEnd: '03-17',
    isPeak: function (d) {
      return d.month === 3 && d.day === 17;
    },
  },
  {
    id: 'easter',
    name: 'Easter',
    defaultStart: 'easter-7d',
    defaultEnd: 'easter+0d',
    isPeak: function (d) {
      var e = easterSunday(d.year);
      return d.month === e.month && d.day === e.day;
    },
  },
  {
    id: 'mothers-day',
    name: "Mother's Day",
    defaultStart: 'mothers-day-3d',
    defaultEnd: 'mothers-day+0d',
    isPeak: function (d) {
      return d.month === 5 && d.day === nthWeekday(d.year, 5, 0, 2);
    },
  },
  {
    id: 'fathers-day',
    name: "Father's Day",
    defaultStart: 'fathers-day-3d',
    defaultEnd: 'fathers-day+0d',
    isPeak: function (d) {
      return d.month === 6 && d.day === nthWeekday(d.year, 6, 0, 3);
    },
  },
  {
    id: 'independence',
    name: 'Independence Day',
    defaultStart: '07-01',
    defaultEnd: '07-04',
    isPeak: function (d) {
      return d.month === 7 && d.day === 4;
    },
  },
  {
    id: 'halloween',
    name: 'Halloween',
    defaultStart: '10-17',
    defaultEnd: '10-31',
    isPeak: function (d) {
      return d.month === 10 && d.day === 31;
    },
  },
  {
    id: 'thanksgiving',
    name: 'Thanksgiving',
    defaultStart: 'thanksgiving-3d',
    defaultEnd: 'thanksgiving+3d',
    isPeak: function (d) {
      return d.month === 11 && d.day === nthWeekday(d.year, 11, 4, 4);
    },
  },
  {
    id: 'christmas',
    name: 'Christmas',
    defaultStart: 'thanksgiving+4d',
    defaultEnd: '12-26',
    isPeak: function (d) {
      return d.month === 12 && (d.day === 24 || d.day === 25);
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

function toActive(def: HolidayThemeDef, isPeak: boolean): ActiveHolidayTheme {
  return {
    id: def.id,
    name: def.name,
    isPeak: isPeak,
  };
}

export function getHolidayThemeForDate(
  year: number,
  month: number,
  day: number,
  config?: { [id: string]: HolidayThemeConfig }
): ActiveHolidayTheme | null {
  var d = buildDayInfo(year, month, day);
  var windowHit: HolidayThemeDef | null = null;
  for (var i = 0; i < HOLIDAY_THEMES.length; i++) {
    var def = HOLIDAY_THEMES[i];
    var cfg = config ? config[def.id] : undefined;
    if (cfg && cfg.enabled === false) {
      continue;
    }
    var startStr = cfg && cfg.start ? cfg.start : def.defaultStart;
    var endStr = cfg && cfg.end ? cfg.end : def.defaultEnd;
    if (!isInConfiguredWindow(d, startStr, endStr)) {
      continue;
    }
    if (def.isPeak(d)) {
      return toActive(def, true);
    }
    if (!windowHit) {
      windowHit = def;
    }
  }
  return windowHit ? toActive(windowHit, false) : null;
}

var cachedKey = '';
var cachedConfigRef: { [id: string]: HolidayThemeConfig } | undefined = undefined;
var cachedTheme: ActiveHolidayTheme | null = null;

/**
 * Active theme for the local calendar day of `nowMs`. `?holiday=<id>` forces
 * a theme for previewing; `?holiday=off` disables the frame.
 */
export function getActiveHolidayTheme(
  nowMs: number,
  config?: { [id: string]: HolidayThemeConfig }
): ActiveHolidayTheme | null {
  var forced = getForcedHolidayParam();
  if (forced === 'off') return null;
  var now = new Date(nowMs);
  var y = now.getFullYear();
  var m = now.getMonth() + 1;
  var dd = now.getDate();
  if (forced) {
    for (var i = 0; i < HOLIDAY_THEMES.length; i++) {
      if (HOLIDAY_THEMES[i].id === forced) {
        return toActive(HOLIDAY_THEMES[i], true);
      }
    }
  }
  var key = toDateKey(y, m, dd);
  if (key !== cachedKey || config !== cachedConfigRef) {
    cachedKey = key;
    cachedConfigRef = config;
    cachedTheme = getHolidayThemeForDate(y, m, dd, config);
  }
  return cachedTheme;
}

function getForcedHolidayParam(): string {
  if (typeof window === 'undefined' || !window.location) return '';
  var match = /[?&]holiday=([a-z-]+)/i.exec(window.location.search || '');
  return match ? match[1].toLowerCase() : '';
}
