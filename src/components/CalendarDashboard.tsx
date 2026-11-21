import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { CalendarEvent, CalendarResponse, TimeFormat } from '../types';
import {
  MONTHS_FULL,
  MONTHS_SHORT,
  WEEKDAYS_FULL,
  WEEKDAYS_MON_START,
  buildMonthGridMonday,
  formatEventTimeRange,
  formatNextEventCountdown,
  formatRelativeDayLabel,
  getChineseLunarDate,
  getTodayParts,
  getUSHolidaysForYear,
  parseDateKey,
  toDateKey,
} from '../utils/calendar';

interface CalendarDashboardProps {
  isActive: boolean;
  nowMs: number;
  timeFormat: TimeFormat;
  controls?: ComponentChildren;
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

  var monthCacheRef = useRef<{ [ym: string]: CalendarResponse }>({});
  var reqSeqRef = useRef<number>(0);
  var pollTimerRef = useRef<number | null>(null);
  var viewYearRef = useRef<number>(viewYear);
  var viewMonthRef = useRef<number>(viewMonth);
  viewYearRef.current = viewYear;
  viewMonthRef.current = viewMonth;

  function fetchMonth(year: number, month: number, showLoading: boolean) {
    var seq = ++reqSeqRef.current;
    var ymKey = String(year) + '-' + String(month);
    if (showLoading) {
      setIsLoading(true);
    }

    var qs = '?year=' + String(year) + '&month=' + String(month);
    return fetch('/api/calendar' + qs, { cache: 'no-cache' })
      .then(function (resp) {
        if (!resp.ok) {
          throw new Error('HTTP ' + String(resp.status));
        }
        return resp.json();
      })
      .then(function (json: CalendarResponse) {
        if (seq !== reqSeqRef.current) return json;
        monthCacheRef.current[ymKey] = json;
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

      fetchMonth(viewYear, viewMonth, !cached).then(schedulePoll);

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
    setViewYear(ny);
    if (ny === today.year && viewMonth === today.month) {
      setSelectedDateKey(today.dateKey);
    } else {
      setSelectedDateKey(toDateKey(ny, viewMonth, 1));
    }
  }

  function jumpToToday() {
    setViewYear(today.year);
    setViewMonth(today.month);
    setSelectedDateKey(today.dateKey);
  }

  function handleSelectDay(year: number, month: number, dateKey: string) {
    setSelectedDateKey(dateKey);
    if (year !== viewYear || month !== viewMonth) {
      setViewYear(year);
      setViewMonth(month);
    }
  }

  function handleJumpToNextEvent(ev: CalendarEvent) {
    var p = parseDateKey(ev.date);
    setViewYear(p.year);
    setViewMonth(p.month);
    setSelectedDateKey(ev.date);
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
  var holidaysByDate: { [dateKey: string]: string } = {};
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
    var hTitle = holidaysByDate[hDate];
    eventsByDate[hDate] = [
      {
        id: 'us-holiday-' + hDate,
        calendarId: 'us-holidays',
        calendarName: 'US Holiday',
        color: '#fbbf24',
        title: hTitle,
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
  var nextEvent = data && data.nextEvent ? data.nextEvent : null;
  var isConfigured = data ? data.configured : true;
  var multiCal = Boolean(data && data.calendars && data.calendars.length > 1);

  return (
    <div class="cal-slide">
      <div class="cal-backdrop" aria-hidden="true" />

      <div class="dashboard-content cal-content">
        {/* Top Bar: Month/Year Title + Nav Buttons + Center Controls + Next Event */}
        <header class="cal-header">
          {props.controls ? (
            <div class="hero-top-center">{props.controls}</div>
          ) : null}

          <div class="cal-header-left">
            <h1 class="cal-month-title">
              {MONTHS_FULL[viewMonth - 1]}{' '}
              <span class="cal-year-num">{viewYear}</span>
            </h1>

            <div class="cal-nav-group" role="group" aria-label="Calendar navigation">
              <button
                type="button"
                class="cal-nav-btn"
                onClick={function () {
                  shiftYear(-1);
                }}
                title="Previous year"
                aria-label="Previous year"
              >
                «
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
                ‹
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
                ›
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
                »
              </button>
            </div>
          </div>

          <div class="cal-header-right">
            {nextEvent ? (
              <div
                role="button"
                tabIndex={0}
                class="cal-next-pill"
                onClick={function () {
                  handleJumpToNextEvent(nextEvent as CalendarEvent);
                }}
                onKeyDown={function (evKey: KeyboardEvent) {
                  if (evKey.key === 'Enter' || evKey.key === ' ') {
                    evKey.preventDefault();
                    handleJumpToNextEvent(nextEvent as CalendarEvent);
                  }
                }}
              >
                <span
                  class="cal-next-dot"
                  style={{ backgroundColor: nextEvent.color || '#38bdf8' }}
                />
                <span class="cal-next-title">{nextEvent.title}</span>
                <span class="cal-next-time">
                  {formatNextEventCountdown(
                    nextEvent,
                    props.nowMs,
                    today.dateKey,
                    props.timeFormat
                  )}
                </span>
              </div>
            ) : loadError ? (
              <span class="cal-status-pill cal-status-warn">Offline ({loadError})</span>
            ) : !isConfigured ? (
              <span class="cal-status-pill">Holidays · Local</span>
            ) : (
              <span class="cal-status-pill">All clear ahead</span>
            )}
          </div>
        </header>

        {/* Main Split Body: Left Month Grid (~60%) + Right Selected Day Agenda (~40%) */}
        <div class="cal-body">
          <section
            class={isLoading ? 'cal-month-card cal-loading' : 'cal-month-card'}
            aria-label="Month view"
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

            <div class="cal-weeks-wrap">
              {weekRows.map(function (week, wIdx) {
                return (
                  <div class="cal-week-row" key={wIdx}>
                    {week.map(function (cell) {
                      var isSel = cell.dateKey === selectedDateKey;
                      var cellEvents = eventsByDate[cell.dateKey] || [];
                      var lunar = getChineseLunarDate(cell.year, cell.month, cell.day);
                      var visibleChips = cellEvents.slice(0, 2);
                      var extraCount = cellEvents.length - visibleChips.length;

                      var cellClass = 'cal-cell';
                      if (!cell.inCurrentMonth) cellClass += ' cal-cell-muted';
                      if (cell.isWeekend) cellClass += ' cal-cell-weekend';
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

          {/* Right Pane: Selected Day Agenda */}
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
        </div>
      </div>
    </div>
  );
}
