package handler

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestParseCalendarSourcesFromEnv(t *testing.T) {
	t.Setenv("CALENDAR_ICS_URLS", `webcal://example.com/a.ics, https://example.com/b.ics`)
	srcs := parseCalendarSourcesFromEnv()
	if len(srcs) != 2 {
		t.Fatalf("expected 2 sources, got %d", len(srcs))
	}
	if srcs[0].URL != "https://example.com/a.ics" {
		t.Fatalf("expected webcal normalized to https, got %q", srcs[0].URL)
	}

	t.Setenv("CALENDAR_ICS_URLS", `[{"name":"Personal","color":"#38bdf8","url":"https://example.com/p.ics"},{"name":"Work","url":"https://example.com/w.ics"}]`)
	srcs2 := parseCalendarSourcesFromEnv()
	if len(srcs2) != 2 || srcs2[0].Name != "Personal" || srcs2[0].Color != "#38bdf8" || srcs2[1].Name != "Work" {
		t.Fatalf("unexpected json sources: %+v", srcs2)
	}
}

func TestCalendarHandlerICSExpansionAndPrivacyHeader(t *testing.T) {
	mockICS := "BEGIN:VCALENDAR\r\n" +
		"VERSION:2.0\r\n" +
		"X-WR-CALNAME:My Schedule\r\n" +
		// Folded single timed event on Nov 21, 2026
		"BEGIN:VEVENT\r\n" +
		"UID:evt-single\r\n" +
		"SUMMARY:Design Re\r\n" +
		" view\r\n" +
		"LOCATION:Sunnyvale\\, CA\r\n" +
		"DTSTART;TZID=America/Los_Angeles:20261121T100000\r\n" +
		"DTEND;TZID=America/Los_Angeles:20261121T113000\r\n" +
		"END:VEVENT\r\n" +
		// Multi-day all-day event (Nov 25 - Nov 27 exclusive => Nov 25 & Nov 26)
		"BEGIN:VEVENT\r\n" +
		"UID:evt-trip\r\n" +
		"SUMMARY:Tahoe Trip\r\n" +
		"DTSTART;VALUE=DATE:20261125\r\n" +
		"DTEND;VALUE=DATE:20261127\r\n" +
		"END:VEVENT\r\n" +
		// Weekly recurring Mon/Wed with EXDATE on Nov 11
		"BEGIN:VEVENT\r\n" +
		"UID:evt-standup\r\n" +
		"SUMMARY:Standup\r\n" +
		"DTSTART;TZID=America/Los_Angeles:20261102T090000\r\n" +
		"DTEND;TZID=America/Los_Angeles:20261102T093000\r\n" +
		"RRULE:FREQ=WEEKLY;BYDAY=MO,WE;UNTIL=20261116T235959Z\r\n" +
		"EXDATE;TZID=America/Los_Angeles:20261111T090000\r\n" +
		"END:VEVENT\r\n" +
		// Cancelled event should be skipped
		"BEGIN:VEVENT\r\n" +
		"UID:evt-cancel\r\n" +
		"SUMMARY:Cancelled Call\r\n" +
		"STATUS:CANCELLED\r\n" +
		"DTSTART;TZID=America/Los_Angeles:20261121T140000\r\n" +
		"DTEND;TZID=America/Los_Angeles:20261121T150000\r\n" +
		"END:VEVENT\r\n" +
		"END:VCALENDAR\r\n"

	origClient := calendarHTTPClient
	calendarHTTPClient = &http.Client{
		Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
			return &http.Response{
				StatusCode: http.StatusOK,
				Header:     http.Header{"Content-Type": []string{"text/calendar"}},
				Body:       io.NopCloser(bytes.NewBufferString(mockICS)),
			}, nil
		}),
	}
	defer func() {
		calendarHTTPClient = origClient
		icsCacheMu.Lock()
		icsCache = map[string]icsCacheEntry{}
		icsCacheMu.Unlock()
	}()

	t.Setenv("CALENDAR_ICS_URLS", "https://example.com/private.ics")

	req := httptest.NewRequest(http.MethodGet, "/api/calendar?year=2026&month=11", nil)
	rec := httptest.NewRecorder()
	CalendarHandler(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	if cc := rec.Header().Get("Cache-Control"); cc != "private, no-store" {
		t.Fatalf("expected private Cache-Control, got %q", cc)
	}

	var resp CalendarResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("invalid json: %v", err)
	}
	if !resp.Configured || len(resp.Calendars) != 1 || resp.Calendars[0].Name != "My Schedule" {
		t.Fatalf("unexpected calendar meta: %+v", resp.Calendars)
	}

	// Verify single event unfolding + unescaping, 2-day trip, and 4 standups (Nov 2, 4, 9, 16; Nov 11 excluded)
	foundSingle := false
	tripDays := 0
	standupDays := map[string]bool{}
	for _, ev := range resp.Events {
		switch ev.Title {
		case "Design Review":
			foundSingle = true
			if ev.Date != "2026-11-21" || ev.StartTime != "10:00" || ev.EndTime != "11:30" || ev.Location != "Sunnyvale, CA" {
				t.Fatalf("unexpected single event: %+v", ev)
			}
		case "Tahoe Trip":
			tripDays++
			if !ev.AllDay {
				t.Fatalf("expected Tahoe Trip to be allDay")
			}
		case "Standup":
			standupDays[ev.Date] = true
		case "Cancelled Call":
			t.Fatalf("cancelled event should not be emitted")
		}
	}

	if !foundSingle {
		t.Fatalf("expected Design Review event in Nov 2026")
	}
	if tripDays != 2 {
		t.Fatalf("expected 2 all-day entries for Tahoe Trip, got %d", tripDays)
	}
	if len(standupDays) != 4 || standupDays["2026-11-11"] || !standupDays["2026-11-02"] || !standupDays["2026-11-16"] {
		t.Fatalf("unexpected standup occurrences: %+v", standupDays)
	}

	// Unconfigured env should still succeed gracefully with configured=false
	t.Setenv("CALENDAR_ICS_URLS", "")
	t.Setenv("CALENDAR_ICS_URL", "")
	req2 := httptest.NewRequest(http.MethodGet, "/api/calendar?year=2026&month=11", nil)
	rec2 := httptest.NewRecorder()
	CalendarHandler(rec2, req2)
	if rec2.Code != http.StatusOK {
		t.Fatalf("expected 200 when unconfigured, got %d", rec2.Code)
	}
	var emptyResp CalendarResponse
	_ = json.Unmarshal(rec2.Body.Bytes(), &emptyResp)
	if emptyResp.Configured || len(emptyResp.Events) != 0 {
		t.Fatalf("expected configured=false and 0 events, got %+v", emptyResp)
	}
}

func TestExtractUpcomingTrips(t *testing.T) {
	loc := loadTimezoneSafe("America/Los_Angeles")
	now := time.Date(2026, 11, 21, 18, 0, 0, 0, loc)

	rawICS := "BEGIN:VCALENDAR\r\n" +
		"VERSION:2.0\r\n" +
		// Past stay: should be excluded
		"BEGIN:VEVENT\r\n" +
		"UID:past-stay\r\n" +
		"SUMMARY:Stay at Old Hotel\r\n" +
		"DTSTART;VALUE=DATE:20261110\r\n" +
		"DTEND;VALUE=DATE:20261113\r\n" +
		"END:VEVENT\r\n" +
		// Short timed dinner at a hotel brand: should be excluded
		"BEGIN:VEVENT\r\n" +
		"UID:short-dinner\r\n" +
		"SUMMARY:Dinner at Marriott\r\n" +
		"DTSTART;TZID=America/Los_Angeles:20261124T190000\r\n" +
		"DTEND;TZID=America/Los_Angeles:20261124T210000\r\n" +
		"END:VEVENT\r\n" +
		// Multi-day non-trip event: should be excluded
		"BEGIN:VEVENT\r\n" +
		"UID:offsite\r\n" +
		"SUMMARY:Winner Announcement\r\n" +
		"DTSTART;VALUE=DATE:20261126\r\n" +
		"DTEND;VALUE=DATE:20261128\r\n" +
		"END:VEVENT\r\n" +
		// Upcoming Gmail-style all-day multi-day hotel stay
		"BEGIN:VEVENT\r\n" +
		"UID:kyoto-stay\r\n" +
		"SUMMARY:Stay at Park Hyatt Kyoto\r\n" +
		"LOCATION:Kyoto\\, Japan\r\n" +
		"DTSTART;VALUE=DATE:20261205\r\n" +
		"DTEND;VALUE=DATE:20261209\r\n" +
		"END:VEVENT\r\n" +
		// Later multi-day trip
		"BEGIN:VEVENT\r\n" +
		"UID:ski-trip\r\n" +
		"SUMMARY:Tahoe Ski Trip\r\n" +
		"DTSTART;VALUE=DATE:20270115\r\n" +
		"DTEND;VALUE=DATE:20270118\r\n" +
		"END:VEVENT\r\n" +
		// Timed multi-day hotel check-in/check-out
		"BEGIN:VEVENT\r\n" +
		"UID:timed-stay\r\n" +
		"SUMMARY:Stay at Four Seasons Maui\r\n" +
		"DTSTART;TZID=America/Los_Angeles:20270210T150000\r\n" +
		"DTEND;TZID=America/Los_Angeles:20270213T110000\r\n" +
		"END:VEVENT\r\n" +
		"END:VCALENDAR\r\n"

	parsed := parseICSEvents(rawICS, loc)
	trips := normalizeUpcomingTrips(extractUpcomingTrips(parsed, "cal-1", "Personal", "#38bdf8", now, loc))

	if len(trips) != 3 {
		t.Fatalf("expected 3 upcoming trips, got %d: %+v", len(trips), trips)
	}
	if trips[0].DisplayName != "Park Hyatt Kyoto" || trips[0].StartDate != "2026-12-05" || trips[0].EndDate != "2026-12-08" || trips[0].Days != 4 {
		t.Fatalf("unexpected first trip: %+v", trips[0])
	}
	if trips[1].DisplayName != "Tahoe Ski Trip" || trips[1].StartDate != "2027-01-15" || trips[1].Days != 3 {
		t.Fatalf("unexpected second trip: %+v", trips[1])
	}
	if trips[2].DisplayName != "Four Seasons Maui" || trips[2].StartDate != "2027-02-10" || trips[2].EndDate != "2027-02-13" || trips[2].Days != 4 {
		t.Fatalf("unexpected third trip: %+v", trips[2])
	}
}

func TestCalendarHandlerDemoMode(t *testing.T) {
	origClient := calendarHTTPClient
	calendarHTTPClient = &http.Client{
		Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
			t.Fatalf("demo mode must not fetch any calendar URL, got %s", r.URL)
			return nil, nil
		}),
	}
	defer func() { calendarHTTPClient = origClient }()

	t.Setenv("GLANCE_PASSCODE", "")
	t.Setenv("VERCEL", "")
	t.Setenv("CALENDAR_ICS_URLS", "https://example.com/private.ics")

	req := httptest.NewRequest(http.MethodGet, "/api/calendar?demo=1", nil)
	rec := httptest.NewRecorder()
	CalendarHandler(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	var resp CalendarResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("invalid json: %v", err)
	}
	if !resp.Configured || len(resp.Calendars) != 3 || resp.Calendars[0].Name != "Work" {
		t.Fatalf("expected the 3 demo calendars, got %+v", resp.Calendars)
	}
	if len(resp.Warnings) != 0 {
		t.Fatalf("unexpected warnings: %v", resp.Warnings)
	}

	today := time.Now().In(loadTimezoneSafe(resp.Timezone)).Format("2006-01-02")
	todayTitles := map[string]bool{}
	for _, ev := range resp.Events {
		if ev.Date == today {
			todayTitles[ev.Title] = true
		}
	}
	for _, want := range []string{"Design review", "Lunch with Sam", "Pick up groceries", "Book club"} {
		if !todayTitles[want] {
			t.Fatalf("expected %q today (%s), got %v", want, today, todayTitles)
		}
	}

	foundTrip := false
	for _, trip := range resp.UpcomingTrips {
		if trip.Title == "Ski trip to Tahoe" && trip.Days == 4 {
			foundTrip = true
		}
	}
	if !foundTrip {
		t.Fatalf("expected the demo ski trip in upcomingTrips, got %+v", resp.UpcomingTrips)
	}
}
