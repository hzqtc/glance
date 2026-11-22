import { useEffect, useRef, useState } from 'preact/hooks';
import type { CalendarEvent, CalendarResponse, CalendarTrip, TimeFormat } from '../types';
import {
  MONTHS_FULL,
  MONTHS_SHORT,
  WEEKDAYS_FULL,
  WEEKDAYS_MON_START,
  buildMonthGridMonday,
  formatEventTimeRange,
  formatRelativeDayLabel,
  formatTripCountdown,
  getChineseLunarDate,
  getTodayParts,
  getUSHolidaysForYear,
  parseDateKey,
  toDateKey,
} from '../utils/calendar';
import type { USHolidayInfo } from '../utils/calendar';

var HIDDEN_CALS_STORAGE_KEY = 'glance:hiddenCalendars:v1';

// Demo mode (?demo=calendar): the API serves generated sample calendars
function isCalendarDemoMode(): boolean {
  try {
    return /[?&]demo=calendar(&|$)/i.test(window.location.search || '');
  } catch (_err) {
    return false;
  }
}

function readHiddenCalendars(): { [id: string]: boolean } {
  try {
    var raw = window.localStorage.getItem(HIDDEN_CALS_STORAGE_KEY);
    if (!raw) return {};
    var parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      return parsed as { [id: string]: boolean };
    }
  } catch (_err) {
    // Ignore storage errors
  }
  return {};
}

function writeHiddenCalendars(map: { [id: string]: boolean }): void {
  try {
    window.localStorage.setItem(HIDDEN_CALS_STORAGE_KEY, JSON.stringify(map));
  } catch (_err) {
    // Ignore storage errors
  }
}

interface CalendarDashboardProps {
  isActive: boolean;
  preload?: boolean;
  nowMs: number;
  timeFormat: TimeFormat;
  idleResetSeconds?: number;
  activityTick?: number;
  isRefreshing: boolean;
  onRefresh: () => void;
  onUnauthorized?: () => void;
}

export function CalendarDashboard(props: CalendarDashboardProps) {
  var today = getTodayParts(props.nowMs);

  var _viewYearState = useState<number>(today.year);
  var viewYear = _viewYearState[0];
  var setViewYear = _viewYearState[1];

  var _viewMonthState = useState<number>(today.month);
  var viewMonth = _viewMonthState[0];
  var setViewMonth = _viewMonthState[1];

  var _selectedKeyState = useState<string>(today.dateKey);
  var selectedDateKey = _selectedKeyState[0];
  var setSelectedDateKey = _selectedKeyState[1];

  var _dataState = useState<CalendarResponse | null>(null);
  var data = _dataState[0];
  var setData = _dataState[1];

  var _loadingState = useState<boolean>(false);
  var isLoading = _loadingState[0];
  var setIsLoading = _loadingState[1];

  var _errorState = useState<string | null>(null);
  var loadError = _errorState[0];
  var setLoadError = _errorState[1];

  var _hiddenState = useState<{ [id: string]: boolean }>(function () {
    return readHiddenCalendars();
  });
  var hiddenCals = _hiddenState[0];
  var setHiddenCals = _hiddenState[1];

  var _slideDirState = useState<'' | 'next' | 'prev'>('');
  var slideDir = _slideDirState[0];
  var setSlideDir = _slideDirState[1];

  var monthCacheRef = useRef<{ [ym: string]: CalendarResponse }>({});
  var reqSeqRef = useRef<number>(0);
  var pollTimerRef = useRef<number | null>(null);
  var hasPreloadedRef = useRef<boolean>(false);
  var lastFetchMsRef = useRef<{ [ym: string]: number }>({});
  var monthTouchRef = useRef<{ x: number; y: number } | null>(null);
  var monthMouseRef = useRef<{ x: number; y: number } | null>(null);
  var suppressClickUntilRef = useRef<number>(0);
  var wheelCooldownRef = useRef<number>(0);
  var viewYearRef = useRef<number>(viewYear);
  var viewMonthRef = useRef<number>(viewMonth);
  var selectedDateKeyRef = useRef<string>(selectedDateKey);
  var prevTodayRef = useRef<{ year: number; month: number; dateKey: string }>({
    year: today.year,
    month: today.month,
    dateKey: today.dateKey,
  });
  viewYearRef.current = viewYear;
  viewMonthRef.current = viewMonth;
  selectedDateKeyRef.current = selectedDateKey;

  // Automatically advance selected day (and month/year on rollover) at midnight
  useEffect(
    function () {
      var prev = prevTodayRef.current;
      if (today.dateKey === prev.dateKey) {
        return;
      }
      if (selectedDateKeyRef.current === prev.dateKey) {
        setSelectedDateKey(today.dateKey);
        if (viewYearRef.current === prev.year && viewMonthRef.current === prev.month) {
          setViewYear(today.year);
          setViewMonth(today.month);
        }
      }
      prevTodayRef.current = {
        year: today.year,
        month: today.month,
        dateKey: today.dateKey,
      };
    },
    [today.dateKey, today.year, today.month]
  );

  function fetchMonth(year: number, month: number, showLoading: boolean) {
    var seq = ++reqSeqRef.current;
    var ymKey = String(year) + '-' + String(month);
    if (showLoading) {
      setIsLoading(true);
    }

    var qs =
      '?year=' +
      String(year) +
      '&month=' +
      String(month) +
      (isCalendarDemoMode() ? '&demo=1' : '');
    return fetch('/api/calendar' + qs, { cache: 'no-cache', credentials: 'same-origin' })
      .then(function (resp) {
        if (resp.status === 401) {
          if (props.onUnauthorized) props.onUnauthorized();
          return null;
        }
        if (!resp.ok) {
          throw new Error('HTTP ' + String(resp.status));
        }
        return resp.json();
      })
      .then(function (json: CalendarResponse | null) {
        if (seq !== reqSeqRef.current || !json) return json;
        monthCacheRef.current[ymKey] = json;
        lastFetchMsRef.current[ymKey] = Date.now();
        setData(json);
        setLoadError(null);
        setIsLoading(false);
        return json;
      })
      .catch(function (err) {
        if (seq !== reqSeqRef.current) return null;
        setLoadError(err && err.message ? String(err.message) : 'Network error');
        setIsLoading(false);
        return null;
      });
  }

  // Quietly preload current month once after boot while inactive so first rotation is instant
  useEffect(
    function () {
      if (!props.preload || props.isActive || hasPreloadedRef.current) {
        return;
      }
      hasPreloadedRef.current = true;
      fetchMonth(viewYearRef.current, viewMonthRef.current, false);
    },
    [props.preload, props.isActive]
  );

  // Fetch when Calendar slide becomes active or viewed month/year changes, plus 5m polling
  useEffect(
    function () {
      if (!props.isActive) {
        if (pollTimerRef.current !== null) {
          window.clearTimeout(pollTimerRef.current);
          pollTimerRef.current = null;
        }
        return;
      }

      var cancelled = false;
      var ymKey = String(viewYear) + '-' + String(viewMonth);
      var cached = monthCacheRef.current[ymKey];
      var lastFetched = lastFetchMsRef.current[ymKey] || 0;
      if (cached) {
        setData(cached);
      }

      function schedulePoll() {
        if (cancelled) return;
        if (pollTimerRef.current !== null) {
          window.clearTimeout(pollTimerRef.current);
        }
        pollTimerRef.current = window.setTimeout(function () {
          fetchMonth(viewYearRef.current, viewMonthRef.current, false).then(schedulePoll);
        }, 5 * 60 * 1000);
      }

      if (cached && Date.now() - lastFetched < 60 * 1000) {
        schedulePoll();
      } else {
        fetchMonth(viewYear, viewMonth, !cached).then(schedulePoll);
      }

      return function () {
        cancelled = true;
        if (pollTimerRef.current !== null) {
          window.clearTimeout(pollTimerRef.current);
          pollTimerRef.current = null;
        }
      };
    },
    [props.isActive, viewYear, viewMonth]
  );

  function shiftMonth(delta: number) {
    var d = new Date(viewYear, viewMonth - 1 + delta, 1);
    var ny = d.getFullYear();
    var nm = d.getMonth() + 1;
    if (ny < 1900 || ny > 2100) return;
    setSlideDir(delta > 0 ? 'next' : 'prev');
    setViewYear(ny);
    setViewMonth(nm);
    if (ny === today.year && nm === today.month) {
      setSelectedDateKey(today.dateKey);
    } else {
      setSelectedDateKey(toDateKey(ny, nm, 1));
    }
  }

  function shiftYear(delta: number) {
    var ny = viewYear + delta;
    if (ny < 1900 || ny > 2100) return;
    setSlideDir(delta > 0 ? 'next' : 'prev');
    setViewYear(ny);
    if (ny === today.year && viewMonth === today.month) {
      setSelectedDateKey(today.dateKey);
    } else {
      setSelectedDateKey(toDateKey(ny, viewMonth, 1));
    }
  }

  function jumpToToday() {
    setSlideDir('');
    setViewYear(today.year);
    setViewMonth(today.month);
    setSelectedDateKey(today.dateKey);
    var ymKey = String(today.year) + '-' + String(today.month);
    var cached = monthCacheRef.current[ymKey];
    if (cached) {
      setData(cached);
    }
  }

  // Auto-return Calendar view to Today after configured idle period
  var idleResetSec =
    typeof props.idleResetSeconds === 'number' && props.idleResetSeconds >= 5
      ? props.idleResetSeconds
      : 60;
  var atTodayNow =
    viewYear === today.year &&
    viewMonth === today.month &&
    selectedDateKey === today.dateKey;
  useEffect(
    function () {
      if (atTodayNow) {
        return;
      }
      var id = window.setTimeout(function () {
        var cur = prevTodayRef.current;
        setSlideDir('');
        setViewYear(cur.year);
        setViewMonth(cur.month);
        setSelectedDateKey(cur.dateKey);
        var ymKey = String(cur.year) + '-' + String(cur.month);
        var cached = monthCacheRef.current[ymKey];
        if (cached) {
          setData(cached);
        }
      }, idleResetSec * 1000);
      return function () {
        window.clearTimeout(id);
      };
    },
    [atTodayNow, viewYear, viewMonth, selectedDateKey, idleResetSec, props.activityTick]
  );

  function jumpToTrip(trip: CalendarTrip) {
    var targetKey = trip.startDate < today.dateKey ? today.dateKey : trip.startDate;
    var parts = parseDateKey(targetKey);
    setSlideDir('');
    setViewYear(parts.year);
    setViewMonth(parts.month);
    setSelectedDateKey(targetKey);
  }

  function handleSelectDay(year: number, month: number, dateKey: string) {
    if (Date.now() < suppressClickUntilRef.current) {
      return;
    }
    setSelectedDateKey(dateKey);
    if (year !== viewYear || month !== viewMonth) {
      setSlideDir(year > viewYear || (year === viewYear && month > viewMonth) ? 'next' : 'prev');
      setViewYear(year);
      setViewMonth(month);
    }
  }

  function handleMonthTouchStart(e: TouchEvent) {
    if (!e.touches || e.touches.length !== 1) {
      monthTouchRef.current = null;
      return;
    }
    monthTouchRef.current = {
      x: e.touches[0].clientX,
      y: e.touches[0].clientY,
    };
  }

  function handleMonthTouchCancel() {
    monthTouchRef.current = null;
  }

  function handleMonthTouchEnd(e: TouchEvent) {
    var start = monthTouchRef.current;
    monthTouchRef.current = null;
    if (!start || !e.changedTouches || e.changedTouches.length === 0) {
      return;
    }
    var dx = e.changedTouches[0].clientX - start.x;
    var dy = e.changedTouches[0].clientY - start.y;
    if (Math.abs(dx) < 48 || Math.abs(dx) < Math.abs(dy) * 1.25) {
      return;
    }
    suppressClickUntilRef.current = Date.now() + 350;
    shiftMonth(dx < 0 ? 1 : -1);
  }

  function handleMonthMouseDown(e: MouseEvent) {
    if (e.button !== 0) return;
    monthMouseRef.current = { x: e.clientX, y: e.clientY };
  }

  function handleMonthMouseUp(e: MouseEvent) {
    var start = monthMouseRef.current;
    monthMouseRef.current = null;
    if (!start) return;
    var dx = e.clientX - start.x;
    var dy = e.clientY - start.y;
    if (Math.abs(dx) < 48 || Math.abs(dx) < Math.abs(dy) * 1.25) {
      return;
    }
    suppressClickUntilRef.current = Date.now() + 350;
    shiftMonth(dx < 0 ? 1 : -1);
  }

  function handleMonthMouseLeave() {
    monthMouseRef.current = null;
  }

  function handleMonthWheel(e: WheelEvent) {
    if (Math.abs(e.deltaX) < 24 || Math.abs(e.deltaX) <= Math.abs(e.deltaY) * 1.4) {
      return;
    }
    var now = Date.now();
    if (now < wheelCooldownRef.current) {
      return;
    }
    wheelCooldownRef.current = now + 420;
    shiftMonth(e.deltaX > 0 ? 1 : -1);
  }

  function handleToggleCalendar(calId: string) {
    var next: { [id: string]: boolean } = {};
    var keys = Object.keys(hiddenCals);
    for (var i = 0; i < keys.length; i++) {
      if (hiddenCals[keys[i]]) {
        next[keys[i]] = true;
      }
    }
    if (next[calId]) {
      delete next[calId];
    } else {
      next[calId] = true;
    }
    setHiddenCals(next);
    writeHiddenCalendars(next);
  }

  // Build 42-day Monday-to-Sunday grid
  var gridCells = buildMonthGridMonday(viewYear, viewMonth, today.dateKey);
  var weekRows = [
    gridCells.slice(0, 7),
    gridCells.slice(7, 14),
    gridCells.slice(14, 21),
    gridCells.slice(21, 28),
    gridCells.slice(28, 35),
    gridCells.slice(35, 42),
  ];

  // Built-in US holidays across years spanned by the 42-day grid (handles Dec/Jan overlap)
  var holidaysByDate: { [dateKey: string]: USHolidayInfo } = {};
  var yearsInGrid: { [y: number]: boolean } = {};
  for (var c = 0; c < gridCells.length; c++) {
    yearsInGrid[gridCells[c].year] = true;
  }
  var yearKeys = Object.keys(yearsInGrid);
  for (var yk = 0; yk < yearKeys.length; yk++) {
    var yNum = parseInt(yearKeys[yk], 10);
    var hMap = getUSHolidaysForYear(yNum);
    var hDates = Object.keys(hMap);
    for (var hd = 0; hd < hDates.length; hd++) {
      holidaysByDate[hDates[hd]] = hMap[hDates[hd]];
    }
  }

  // Index fetched events + US holidays by dateKey
  var eventsByDate: { [dateKey: string]: CalendarEvent[] } = {};
  var allHolidayKeys = Object.keys(holidaysByDate);
  for (var hk = 0; hk < allHolidayKeys.length; hk++) {
    var hDate = allHolidayKeys[hk];
    var hInfo = holidaysByDate[hDate];
    eventsByDate[hDate] = [
      {
        id: 'us-holiday-' + hDate,
        calendarId: 'us-holidays',
        calendarName: hInfo.isDayOff ? 'US Holiday' : 'Observance',
        color: '#fbbf24',
        title: hInfo.title,
        date: hDate,
        allDay: true,
        startMs: 0,
        endMs: 0,
        isHoliday: true,
      },
    ];
  }

  var fetchedEvents = data && data.events ? data.events : [];
  for (var e = 0; e < fetchedEvents.length; e++) {
    var ev = fetchedEvents[e];
    if (hiddenCals[ev.calendarId]) {
      continue;
    }
    if (!eventsByDate[ev.date]) {
      eventsByDate[ev.date] = [];
    }
    eventsByDate[ev.date].push(ev);
  }

  // Selected day details
  var selParts = parseDateKey(selectedDateKey);
  var selDateObj = new Date(selParts.year, selParts.month - 1, selParts.day);
  var selWeekday = WEEKDAYS_FULL[selDateObj.getDay()];
  var selRelative = formatRelativeDayLabel(selectedDateKey, today.dateKey);
  var selLunar = getChineseLunarDate(selParts.year, selParts.month, selParts.day);
  var selEvents = eventsByDate[selectedDateKey] || [];

  var selAllDay: CalendarEvent[] = [];
  var selTimed: CalendarEvent[] = [];
  for (var s = 0; s < selEvents.length; s++) {
    if (selEvents[s].allDay) {
      selAllDay.push(selEvents[s]);
    } else {
      selTimed.push(selEvents[s]);
    }
  }

  var isAtToday =
    viewYear === today.year &&
    viewMonth === today.month &&
    selectedDateKey === today.dateKey;
  var calendars = data && data.calendars ? data.calendars : [];
  var isConfigured = data ? data.configured : true;
  var multiCal = calendars.length > 1;

  // Pick the earliest visible upcoming (or ongoing) trip from the 365-day scan
  var nextTrip: CalendarTrip | null = null;
  var upcomingTrips = data && data.upcomingTrips ? data.upcomingTrips : [];
  for (var tIdx = 0; tIdx < upcomingTrips.length; tIdx++) {
    var cand = upcomingTrips[tIdx];
    if (hiddenCals[cand.calendarId]) {
      continue;
    }
    if (cand.endDate < today.dateKey) {
      continue;
    }
    nextTrip = cand;
    break;
  }
  var nextTripInfo = nextTrip ? formatTripCountdown(nextTrip, today.dateKey) : null;

  return (
    <div class="cal-slide">
      <div class="cal-backdrop" aria-hidden="true" />

      <div class="dashboard-content cal-content">
        {/* Top Bar: Month/Year Left + Unified Centered Nav & Refresh Pill */}
        <header class="cal-header">
          <div class="cal-header-left">
            <h1 class="cal-month-title">
              {MONTHS_FULL[viewMonth - 1]}{' '}
              <span class="cal-year-num">{viewYear}</span>
            </h1>
          </div>

          <div class="cal-header-center">
            <div class="cal-nav-group" role="toolbar" aria-label="Calendar navigation and refresh">
              <button
                type="button"
                class="cal-nav-btn"
                onClick={function () {
                  shiftYear(-1);
                }}
                title="Previous year"
                aria-label="Previous year"
              >
                <span class="cal-nav-icon" aria-hidden="true">
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2.1"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    class="ctrl-svg"
                  >
                    <polyline points="11 17.5 5.5 12 11 6.5" />
                    <polyline points="18.5 17.5 13 12 18.5 6.5" />
                  </svg>
                </span>
              </button>
              <button
                type="button"
                class="cal-nav-btn"
                onClick={function () {
                  shiftMonth(-1);
                }}
                title="Previous month"
                aria-label="Previous month"
              >
                <span class="cal-nav-icon" aria-hidden="true">
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2.1"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    class="ctrl-svg"
                  >
                    <polyline points="14.75 17.5 9.25 12 14.75 6.5" />
                  </svg>
                </span>
              </button>
              <button
                type="button"
                class={
                  isAtToday
                    ? 'cal-nav-btn cal-nav-today cal-nav-today-dim'
                    : 'cal-nav-btn cal-nav-today'
                }
                onClick={jumpToToday}
                title="Jump to today"
              >
                Today
              </button>
              <button
                type="button"
                class="cal-nav-btn"
                onClick={function () {
                  shiftMonth(1);
                }}
                title="Next month"
                aria-label="Next month"
              >
                <span class="cal-nav-icon" aria-hidden="true">
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2.1"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    class="ctrl-svg"
                  >
                    <polyline points="9.25 17.5 14.75 12 9.25 6.5" />
                  </svg>
                </span>
              </button>
              <button
                type="button"
                class="cal-nav-btn"
                onClick={function () {
                  shiftYear(1);
                }}
                title="Next year"
                aria-label="Next year"
              >
                <span class="cal-nav-icon" aria-hidden="true">
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2.1"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    class="ctrl-svg"
                  >
                    <polyline points="5.5 17.5 11 12 5.5 6.5" />
                    <polyline points="13 17.5 18.5 12 13 6.5" />
                  </svg>
                </span>
              </button>

              <span class="cal-nav-sep" aria-hidden="true" />

              <button
                type="button"
                class="cal-nav-btn cal-nav-refresh"
                onClick={props.onRefresh}
                disabled={props.isRefreshing}
                title="Hard reload & clear cache"
                aria-label="Hard reload and clear cache"
              >
                <span class="cal-nav-icon" aria-hidden="true">
                  <svg
                    width="13"
                    height="13"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2.1"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    class={props.isRefreshing ? 'ctrl-svg ctrl-spinning' : 'ctrl-svg'}
                  >
                    <path d="M21 12a9 9 0 1 1-2.64-6.36" />
                    <polyline points="21 3 21 9 15 9" />
                  </svg>
                </span>
              </button>
            </div>
          </div>

          <div class="cal-header-right">
            {loadError ? (
              <span class="cal-status-pill cal-status-warn">Offline ({loadError})</span>
            ) : !isConfigured ? (
              <span class="cal-status-pill">Holidays · Local</span>
            ) : nextTrip && nextTripInfo ? (
              <button
                type="button"
                class={
                  nextTripInfo.isOngoing
                    ? 'cal-trip-pill cal-trip-pill-ongoing'
                    : nextTripInfo.isSoon
                      ? 'cal-trip-pill cal-trip-pill-soon'
                      : 'cal-trip-pill'
                }
                onClick={function () {
                  if (nextTrip) jumpToTrip(nextTrip);
                }}
                title={
                  nextTrip.title +
                  ' (' +
                  nextTrip.startDate +
                  (nextTrip.endDate !== nextTrip.startDate ? ' – ' + nextTrip.endDate : '') +
                  ')'
                }
              >
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  class="cal-trip-icon"
                  aria-hidden="true"
                >
                  <path d="M17.8 19.2L16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z" />
                </svg>
                <span class="cal-trip-countdown">{nextTripInfo.badge}</span>
                <span class="cal-trip-sep" aria-hidden="true">·</span>
                <span class="cal-trip-name">{nextTrip.displayName || nextTrip.title}</span>
                {nextTripInfo.dateLabel ? (
                  <span class="cal-trip-date">{nextTripInfo.dateLabel}</span>
                ) : null}
              </button>
            ) : null}
          </div>
        </header>

        {/* Main Split Body: Left Month Grid (~60%) + Right Selected Day Agenda & Calendar Toggles (~40%) */}
        <div class="cal-body">
          <section
            class={isLoading ? 'cal-month-card cal-loading' : 'cal-month-card'}
            aria-label="Month view"
            onTouchStart={handleMonthTouchStart}
            onTouchEnd={handleMonthTouchEnd}
            onTouchCancel={handleMonthTouchCancel}
            onMouseDown={handleMonthMouseDown}
            onMouseUp={handleMonthMouseUp}
            onMouseLeave={handleMonthMouseLeave}
            onWheel={handleMonthWheel}
          >
            <div class="cal-weekdays-row">
              {WEEKDAYS_MON_START.map(function (wd, idx) {
                return (
                  <div
                    key={wd}
                    class={
                      idx >= 5
                        ? 'cal-weekday-label cal-weekday-weekend'
                        : 'cal-weekday-label'
                    }
                  >
                    {wd}
                  </div>
                );
              })}
            </div>

            <div
              key={String(viewYear) + '-' + String(viewMonth)}
              class={
                slideDir === 'next'
                  ? 'cal-weeks-wrap cal-weeks-slide-next'
                  : slideDir === 'prev'
                    ? 'cal-weeks-wrap cal-weeks-slide-prev'
                    : 'cal-weeks-wrap'
              }
            >
              {weekRows.map(function (week, wIdx) {
                return (
                  <div class="cal-week-row" key={wIdx}>
                    {week.map(function (cell) {
                      var isSel = cell.dateKey === selectedDateKey;
                      var cellEvents = eventsByDate[cell.dateKey] || [];
                      var holidayInfo = holidaysByDate[cell.dateKey];
                      var isDayOff = Boolean(holidayInfo && holidayInfo.isDayOff);
                      var lunar = getChineseLunarDate(cell.year, cell.month, cell.day);
                      var visibleChips = cellEvents.slice(0, 2);
                      var extraCount = cellEvents.length - visibleChips.length;

                      var cellClass = 'cal-cell';
                      if (!cell.inCurrentMonth) cellClass += ' cal-cell-muted';
                      if (cell.isWeekend) cellClass += ' cal-cell-weekend';
                      if (isDayOff) cellClass += ' cal-cell-dayoff';
                      if (cell.isToday) cellClass += ' cal-cell-today';
                      if (isSel) cellClass += ' cal-cell-selected';

                      return (
                        <div
                          key={cell.dateKey}
                          role="button"
                          tabIndex={0}
                          class={cellClass}
                          aria-pressed={isSel}
                          onClick={function () {
                            handleSelectDay(cell.year, cell.month, cell.dateKey);
                          }}
                          onKeyDown={function (evKey: KeyboardEvent) {
                            if (evKey.key === 'Enter' || evKey.key === ' ') {
                              evKey.preventDefault();
                              handleSelectDay(cell.year, cell.month, cell.dateKey);
                            }
                          }}
                        >
                          <div class="cal-cell-top">
                            <span
                              class={
                                cell.isToday
                                  ? 'cal-day-num cal-day-num-today'
                                  : 'cal-day-num'
                              }
                            >
                              {cell.day}
                            </span>
                            {lunar ? (
                              <span
                                class={
                                  lunar.isFestival
                                    ? 'cal-lunar-tag cal-lunar-fest'
                                    : lunar.isSolarTerm
                                      ? 'cal-lunar-tag cal-lunar-term'
                                      : 'cal-lunar-tag'
                                }
                              >
                                {lunar.label}
                              </span>
                            ) : null}
                          </div>

                          <div class="cal-cell-events">
                            {visibleChips.map(function (item) {
                              return (
                                <div
                                  key={item.id}
                                  class={
                                    item.isHoliday
                                      ? 'cal-chip cal-chip-holiday'
                                      : 'cal-chip'
                                  }
                                  style={
                                    item.isHoliday
                                      ? undefined
                                      : { borderLeftColor: item.color || '#38bdf8' }
                                  }
                                >
                                  <span class="cal-chip-text">{item.title}</span>
                                </div>
                              );
                            })}
                            {extraCount > 0 ? (
                              <div class="cal-chip-more">+{extraCount} more</div>
                            ) : null}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </section>

          {/* Right Column: Selected Day Card (top) + Separate Calendars Card (bottom) */}
          <div class="cal-right-col">
            <section class="cal-day-card" aria-label="Selected day agenda">
              <div class="cal-day-header">
                <div class="cal-day-eyebrow-row">
                  <span class="cal-day-weekday">{selWeekday}</span>
                  {selRelative ? (
                    <span
                      class={
                        selectedDateKey === today.dateKey
                          ? 'cal-rel-pill cal-rel-today'
                          : 'cal-rel-pill'
                      }
                    >
                      {selRelative}
                    </span>
                  ) : null}
                </div>

                <div class="cal-day-date-title">
                  {MONTHS_SHORT[selParts.month - 1]} {selParts.day}, {selParts.year}
                </div>

                <div class="cal-day-sub-row">
                  {selLunar ? (
                    <span
                      class={
                        selLunar.isFestival
                          ? 'cal-day-lunar cal-lunar-fest'
                          : selLunar.isSolarTerm
                            ? 'cal-day-lunar cal-lunar-term'
                            : 'cal-day-lunar'
                      }
                    >
                      {selLunar.fullLabel}
                    </span>
                  ) : null}
                  <span class="cal-day-count">
                    {selEvents.length === 0
                      ? 'No events'
                      : selEvents.length === 1
                        ? '1 event'
                        : String(selEvents.length) + ' events'}
                  </span>
                </div>
              </div>

              <div class="cal-day-list">
                {selAllDay.length > 0 ? (
                  <div class="cal-allday-group">
                    {selAllDay.map(function (ev) {
                      return (
                        <div
                          key={ev.id}
                          class={
                            ev.isHoliday
                              ? 'cal-allday-item cal-allday-holiday'
                              : 'cal-allday-item'
                          }
                          style={
                            ev.isHoliday
                              ? undefined
                              : { borderLeftColor: ev.color || '#38bdf8' }
                          }
                        >
                          <span class="cal-allday-badge">
                            {ev.isHoliday ? 'Holiday' : 'All Day'}
                          </span>
                          <span class="cal-allday-title">{ev.title}</span>
                        </div>
                      );
                    })}
                  </div>
                ) : null}

                {selTimed.length > 0 ? (
                  <div class="cal-timed-group">
                    {selTimed.map(function (ev) {
                      var isNow =
                        selectedDateKey === today.dateKey &&
                        props.nowMs >= ev.startMs &&
                        props.nowMs < ev.endMs;
                      var isPast =
                        selectedDateKey === today.dateKey && props.nowMs >= ev.endMs;

                      var itemClass = 'cal-event-item';
                      if (isNow) itemClass += ' cal-event-now';
                      if (isPast) itemClass += ' cal-event-past';

                      return (
                        <div
                          key={ev.id}
                          class={itemClass}
                          style={{ borderLeftColor: ev.color || '#38bdf8' }}
                        >
                          <div class="cal-event-time-row">
                            <span class="cal-event-time">
                              {formatEventTimeRange(ev, props.timeFormat)}
                            </span>
                            {isNow ? <span class="cal-now-pill">NOW</span> : null}
                            {multiCal && ev.calendarName ? (
                              <span class="cal-event-cal">{ev.calendarName}</span>
                            ) : null}
                          </div>
                          <div class="cal-event-title">{ev.title}</div>
                          {ev.location ? (
                            <div class="cal-event-loc">{ev.location}</div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                ) : null}

                {selAllDay.length === 0 && selTimed.length === 0 ? (
                  <div class="cal-empty-day">
                    <div class="cal-empty-title">Clear day</div>
                    <div class="cal-empty-sub">
                      {!isConfigured
                        ? 'Set CALENDAR_ICS_URLS in Vercel Env Vars (or .env.local) to sync your private calendar.'
                        : 'No events scheduled'}
                    </div>
                  </div>
                ) : null}
              </div>
            </section>

            {/* Separate Calendars Card (one calendar per row) */}
            {calendars.length > 0 ? (
              <section
                class="cal-sources-card"
                role="group"
                aria-label="Toggle calendars"
              >
                {calendars.map(function (cal) {
                  var isHidden = Boolean(hiddenCals[cal.id]);
                  return (
                    <div
                      key={cal.id}
                      role="button"
                      tabIndex={0}
                      class={
                        isHidden
                          ? 'cal-toggle-row cal-toggle-row-off'
                          : 'cal-toggle-row'
                      }
                      aria-pressed={!isHidden}
                      onClick={function () {
                        handleToggleCalendar(cal.id);
                      }}
                      onKeyDown={function (evKey: KeyboardEvent) {
                        if (evKey.key === 'Enter' || evKey.key === ' ') {
                          evKey.preventDefault();
                          handleToggleCalendar(cal.id);
                        }
                      }}
                    >
                      <span
                        class="cal-toggle-dot"
                        style={
                          isHidden
                            ? {
                                borderColor: cal.color || '#38bdf8',
                                backgroundColor: 'transparent',
                              }
                            : {
                                borderColor: cal.color || '#38bdf8',
                                backgroundColor: cal.color || '#38bdf8',
                              }
                        }
                      />
                      <span class="cal-toggle-name">{cal.name}</span>
                    </div>
                  );
                })}
              </section>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
