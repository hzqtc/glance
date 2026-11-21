package handler

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
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
