package handler

import (
	"crypto/sha1"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"glance/auth"
	"glance/config"
)

var (
	calendarHTTPClient = &http.Client{Timeout: 10 * time.Second}

	icsCacheMu sync.Mutex
	icsCache   = map[string]icsCacheEntry{}
)

type icsCacheEntry struct {
	events    []rawICSEvent
	calName   string
	fetchedAt time.Time
}

type calendarSource struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Color    string `json:"color"`
	URL      string `json:"url"`
	AutoName bool   `json:"-"`
	ICS      string `json:"-"` // inline iCalendar text (demo mode); skips fetching URL
}

type CalendarMeta struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Color string `json:"color"`
}

type CalendarEvent struct {
	ID           string `json:"id"`
	CalendarID   string `json:"calendarId"`
	CalendarName string `json:"calendarName"`
	Color        string `json:"color"`
	Title        string `json:"title"`
	Location     string `json:"location,omitempty"`
	Date         string `json:"date"` // YYYY-MM-DD in display timezone
	AllDay       bool   `json:"allDay"`
	StartMs      int64  `json:"startMs"`
	EndMs        int64  `json:"endMs"`
	StartTime    string `json:"startTime,omitempty"` // HH:MM (24h) in display timezone
	EndTime      string `json:"endTime,omitempty"`   // HH:MM (24h) in display timezone
}

type CalendarTrip struct {
	ID           string `json:"id"`
	CalendarID   string `json:"calendarId"`
	CalendarName string `json:"calendarName"`
	Color        string `json:"color"`
	Title        string `json:"title"`
	DisplayName  string `json:"displayName"`
	Location     string `json:"location,omitempty"`
	StartDate    string `json:"startDate"` // YYYY-MM-DD inclusive
	EndDate      string `json:"endDate"`   // YYYY-MM-DD inclusive last day
	Days         int    `json:"days"`      // Total inclusive days
}

type CalendarResponse struct {
	Version       string          `json:"version"`
	FetchedAt     string          `json:"fetchedAt"`
	Timezone      string          `json:"timezone"`
	Year          int             `json:"year"`
	Month         int             `json:"month"`
	Configured    bool            `json:"configured"`
	Calendars     []CalendarMeta  `json:"calendars"`
	Events        []CalendarEvent `json:"events"`
	NextEvent     *CalendarEvent  `json:"nextEvent,omitempty"`
	UpcomingTrips []CalendarTrip  `json:"upcomingTrips,omitempty"`
	Warnings      []string        `json:"warnings,omitempty"`
}

var defaultCalendarPalette = []string{
	"#38bdf8", // sky
	"#a78bfa", // violet
	"#34d399", // emerald
	"#fb923c", // orange
	"#f472b6", // pink
	"#fbbf24", // amber
}

// CalendarHandler serves GET /api/calendar on Vercel (and locally via cmd/devserver).
func CalendarHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		writeCalendarError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	if !auth.RequireAuth(w, r) {
		return
	}

	cfg, version, _, err := config.LoadNormalizedConfig()
	if err != nil {
		writeCalendarError(w, http.StatusInternalServerError, fmt.Sprintf("invalid config: %v", err))
		return
	}

	tzName := "America/Los_Angeles"
	if len(cfg.Cities) > 0 && strings.TrimSpace(cfg.Cities[0].Timezone) != "" {
		tzName = cfg.Cities[0].Timezone
	}
	loc := loadTimezoneSafe(tzName)
	nowLocal := time.Now().In(loc)

	q := r.URL.Query()
	year := nowLocal.Year()
	month := int(nowLocal.Month())
	if yStr := strings.TrimSpace(q.Get("year")); yStr != "" {
		if y, err := strconv.Atoi(yStr); err == nil && y >= 1900 && y <= 2100 {
			year = y
		}
	}
	if mStr := strings.TrimSpace(q.Get("month")); mStr != "" {
		if m, err := strconv.Atoi(mStr); err == nil && m >= 1 && m <= 12 {
			month = m
		}
	}
	forceRefresh := q.Get("refresh") == "1"

	// ?demo=1 serves generated demo calendars instead of the private feeds
	var sources []calendarSource
	if q.Get("demo") == "1" {
		sources = demoCalendarSources(nowLocal)
	} else {
		sources = parseCalendarSourcesFromEnv()
	}
	calendars := make([]CalendarMeta, 0, len(sources))
	for _, s := range sources {
		calendars = append(calendars, CalendarMeta{
			ID:    s.ID,
			Name:  s.Name,
			Color: s.Color,
		})
	}

	// Compute 42-day Monday-to-Sunday grid window for requested year/month
	winStart, winEnd := monthGridWindowMonday(year, month, loc)
	// Also scan next 14 days from now for NextEvent banner
	upcomingStart := time.Date(nowLocal.Year(), nowLocal.Month(), nowLocal.Day(), 0, 0, 0, 0, loc)
	upcomingEnd := upcomingStart.AddDate(0, 0, 15)

	var (
		allEvents      []CalendarEvent
		upcomingEvents []CalendarEvent
		upcomingTrips  []CalendarTrip
		warnings       []string
		mu             sync.Mutex
		wg             sync.WaitGroup
	)

	for _, src := range sources {
		wg.Add(1)
		go func(s calendarSource) {
			defer wg.Done()
			var (
				parsed        []rawICSEvent
				extractedName string
				fetchErr      error
			)
			if s.ICS != "" {
				parsed = parseICSEvents(s.ICS, loc)
			} else {
				parsed, extractedName, fetchErr = fetchParsedICSCached(s.URL, loc, forceRefresh)
			}
			if fetchErr != nil {
				mu.Lock()
				warnings = append(warnings, fmt.Sprintf("%s: %v", s.Name, fetchErr))
				mu.Unlock()
				return
			}
			calName := s.Name
			if (s.AutoName || calName == "") && extractedName != "" {
				calName = extractedName
			}

			winEvs := expandEventsForWindow(parsed, s.ID, calName, s.Color, winStart, winEnd, loc)
			upEvs := expandEventsForWindow(parsed, s.ID, calName, s.Color, upcomingStart, upcomingEnd, loc)
			trips := extractUpcomingTrips(parsed, s.ID, calName, s.Color, nowLocal, loc)

			mu.Lock()
			allEvents = append(allEvents, winEvs...)
			upcomingEvents = append(upcomingEvents, upEvs...)
			upcomingTrips = append(upcomingTrips, trips...)
			if calName != s.Name {
				for i := range calendars {
					if calendars[i].ID == s.ID {
						calendars[i].Name = calName
						break
					}
				}
			}
			mu.Unlock()
		}(src)
	}
	wg.Wait()

	sortCalendarEvents(allEvents)
	sortCalendarEvents(upcomingEvents)
	upcomingTrips = normalizeUpcomingTrips(upcomingTrips)

	var nextEv *CalendarEvent
	nowMs := nowLocal.UnixNano() / int64(time.Millisecond)
	for i := range upcomingEvents {
		ev := upcomingEvents[i]
		if ev.AllDay {
			continue
		}
		if ev.EndMs > nowMs {
			copyEv := ev
			nextEv = &copyEv
			break
		}
	}

	if allEvents == nil {
		allEvents = []CalendarEvent{}
	}

	resp := CalendarResponse{
		Version:       version,
		FetchedAt:     time.Now().UTC().Format(time.RFC3339),
		Timezone:      tzName,
		Year:          year,
		Month:         month,
		Configured:    len(sources) > 0,
		Calendars:     calendars,
		Events:        allEvents,
		NextEvent:     nextEv,
		UpcomingTrips: upcomingTrips,
		Warnings:      warnings,
	}

	// Private calendar data must NEVER be cached publicly on shared CDN edges
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "private, no-store")
	w.WriteHeader(http.StatusOK)
	if r.Method == http.MethodHead {
		return
	}
	_ = json.NewEncoder(w).Encode(resp)
}

func parseCalendarSourcesFromEnv() []calendarSource {
	raw := strings.TrimSpace(os.Getenv("CALENDAR_ICS_URLS"))
	if raw == "" {
		raw = strings.TrimSpace(os.Getenv("CALENDAR_ICS_URL"))
	}
	if raw == "" {
		return nil
	}

	var sources []calendarSource

	// Format 1: JSON array [{"name":"Personal","color":"#38bdf8","url":"https://..."}]
	if strings.HasPrefix(raw, "[") {
		var parsed []calendarSource
		if err := json.Unmarshal([]byte(raw), &parsed); err == nil {
			for i, item := range parsed {
				u := normalizeCalendarURL(item.URL)
				if u == "" {
					continue
				}
				name := strings.TrimSpace(item.Name)
				autoName := false
				if name == "" {
					autoName = true
					if len(parsed) == 1 {
						name = "Calendar"
					} else {
						name = fmt.Sprintf("Calendar %d", i+1)
					}
				}
				color := strings.TrimSpace(item.Color)
				if color == "" {
					color = defaultCalendarPalette[i%len(defaultCalendarPalette)]
				}
				sources = append(sources, calendarSource{
					ID:       shortHash(u),
					Name:     name,
					Color:    color,
					URL:      u,
					AutoName: autoName,
				})
			}
			return sources
		}
	}

	// Format 2: Comma-, space-, or newline-separated URLs (or single URL)
	replacer := strings.NewReplacer("\r\n", "\n", ",", "\n", " ", "\n")
	parts := strings.Split(replacer.Replace(raw), "\n")
	idx := 0
	for _, p := range parts {
		u := normalizeCalendarURL(p)
		if u == "" {
			continue
		}
		name := "Calendar"
		if idx > 0 {
			name = fmt.Sprintf("Calendar %d", idx+1)
		}
		sources = append(sources, calendarSource{
			ID:       shortHash(u),
			Name:     name,
			Color:    defaultCalendarPalette[idx%len(defaultCalendarPalette)],
			URL:      u,
			AutoName: true,
		})
		idx++
	}
	return sources
}

func cleanCalendarDisplayName(raw string) string {
	name := strings.TrimSpace(raw)
	if name == "" {
		return ""
	}
	// Shorten raw email calendar names (e.g. "hzqtc1229@gmail.com" -> "hzqtc1229")
	if at := strings.IndexByte(name, '@'); at > 0 && !strings.Contains(name, " ") {
		return name[:at]
	}
	return name
}

func normalizeCalendarURL(raw string) string {
	u := strings.TrimSpace(raw)
	if u == "" {
		return ""
	}
	if strings.HasPrefix(strings.ToLower(u), "webcal://") {
		u = "https://" + u[len("webcal://"):]
	}
	if !strings.HasPrefix(strings.ToLower(u), "http://") && !strings.HasPrefix(strings.ToLower(u), "https://") {
		return ""
	}
	return u
}

func shortHash(s string) string {
	sum := sha1.Sum([]byte(s))
	return hex.EncodeToString(sum[:])[:10]
}

func fetchParsedICSCached(rawURL string, loc *time.Location, forceRefresh bool) ([]rawICSEvent, string, error) {
	const cacheTTL = 5 * time.Minute
	locName := "UTC"
	if loc != nil {
		locName = loc.String()
	}
	cacheKey := rawURL + "|" + locName

	if !forceRefresh {
		icsCacheMu.Lock()
		if entry, ok := icsCache[cacheKey]; ok && time.Since(entry.fetchedAt) < cacheTTL {
			icsCacheMu.Unlock()
			return entry.events, entry.calName, nil
		}
		icsCacheMu.Unlock()
	}

	req, err := http.NewRequest(http.MethodGet, rawURL, nil)
	if err != nil {
		return nil, "", err
	}
	req.Header.Set("User-Agent", "GlanceCalendar/1.0")
	req.Header.Set("Accept", "text/calendar, text/plain;q=0.9, */*;q=0.8")

	resp, err := calendarHTTPClient.Do(req)
	if err != nil {
		return nil, "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, "", fmt.Errorf("status %d", resp.StatusCode)
	}
	// Cap at 8 MB for safety
	bodyBytes, err := io.ReadAll(io.LimitReader(resp.Body, 8*1024*1024))
	if err != nil {
		return nil, "", err
	}
	lines := unfoldICSLines(string(bodyBytes))
	parsed := parseICSEventsFromLines(lines, loc)
	calName := cleanCalendarDisplayName(extractICSCalendarNameFromLines(lines))

	icsCacheMu.Lock()
	icsCache[cacheKey] = icsCacheEntry{
		events:    parsed,
		calName:   calName,
		fetchedAt: time.Now(),
	}
	icsCacheMu.Unlock()
	return parsed, calName, nil
}

// monthGridWindowMonday returns the exact 42-day Monday-start window covering (year, month).
func monthGridWindowMonday(year, month int, loc *time.Location) (time.Time, time.Time) {
	first := time.Date(year, time.Month(month), 1, 0, 0, 0, 0, loc)
	// Go Weekday: Sunday=0, Monday=1, ..., Saturday=6 -> Monday-based offset 0..6
	offset := (int(first.Weekday()) + 6) % 7
	start := first.AddDate(0, 0, -offset)
	end := start.AddDate(0, 0, 42)
	return start, end
}

// ============================================================================
// RFC 5545 iCalendar (.ics) Parser & Recurrence Expander (Stdlib Only)
// ============================================================================

type rawICSEvent struct {
	UID          string
	Summary      string
	Location     string
	Status       string
	Start        time.Time
	End          time.Time
	HasEnd       bool
	Duration     time.Duration
	HasDuration  bool
	AllDay       bool
	RRule        string
	ExDates      map[int64]bool
	ExDayKeys    map[string]bool
	RecurrenceID *time.Time
	RecurrenceDK string
}

func unfoldICSLines(raw string) []string {
	normalized := strings.ReplaceAll(raw, "\r\n", "\n")
	normalized = strings.ReplaceAll(normalized, "\r", "\n")
	rawLines := strings.Split(normalized, "\n")
	out := make([]string, 0, len(rawLines))
	for _, line := range rawLines {
		if len(line) > 0 && (line[0] == ' ' || line[0] == '\t') {
			if len(out) > 0 {
				out[len(out)-1] += line[1:]
			}
			continue
		}
		if line != "" {
			out = append(out, line)
		}
	}
	return out
}

func extractICSCalendarName(raw string) string {
	return extractICSCalendarNameFromLines(unfoldICSLines(raw))
}

func extractICSCalendarNameFromLines(lines []string) string {
	for _, line := range lines {
		if strings.HasPrefix(line, "BEGIN:VEVENT") {
			break
		}
		upper := strings.ToUpper(line)
		if strings.HasPrefix(upper, "X-WR-CALNAME:") || strings.HasPrefix(upper, "X-WR-CALNAME;") {
			if colon := strings.IndexByte(line, ':'); colon >= 0 {
				return unescapeICSText(strings.TrimSpace(line[colon+1:]))
			}
		}
	}
	return ""
}

func parseICSEvents(raw string, defaultLoc *time.Location) []rawICSEvent {
	return parseICSEventsFromLines(unfoldICSLines(raw), defaultLoc)
}

func parseICSEventsFromLines(lines []string, defaultLoc *time.Location) []rawICSEvent {
	var events []rawICSEvent
	var cur *rawICSEvent
	inAlarm := false

	for _, line := range lines {
		upper := strings.ToUpper(strings.TrimSpace(line))
		if upper == "BEGIN:VALARM" {
			inAlarm = true
			continue
		}
		if upper == "END:VALARM" {
			inAlarm = false
			continue
		}
		if inAlarm {
			continue
		}
		if upper == "BEGIN:VEVENT" {
			cur = &rawICSEvent{
				ExDates:   make(map[int64]bool),
				ExDayKeys: make(map[string]bool),
			}
			continue
		}
		if upper == "END:VEVENT" {
			if cur != nil && !cur.Start.IsZero() && !strings.EqualFold(cur.Status, "CANCELLED") {
				if !cur.HasEnd {
					if cur.HasDuration {
						cur.End = cur.Start.Add(cur.Duration)
					} else if cur.AllDay {
						cur.End = cur.Start.AddDate(0, 0, 1)
					} else {
						cur.End = cur.Start.Add(1 * time.Hour)
					}
				}
				if cur.Summary == "" {
					cur.Summary = "(No title)"
				}
				events = append(events, *cur)
			}
			cur = nil
			continue
		}
		if cur == nil {
			continue
		}

		colon := strings.IndexByte(line, ':')
		if colon <= 0 {
			continue
		}
		propPart := line[:colon]
		val := line[colon+1:]

		propName, params := parseICSPropAndParams(propPart)
		switch propName {
		case "UID":
			cur.UID = strings.TrimSpace(val)
		case "SUMMARY":
			cur.Summary = unescapeICSText(strings.TrimSpace(val))
		case "LOCATION":
			cur.Location = unescapeICSText(strings.TrimSpace(val))
		case "STATUS":
			cur.Status = strings.TrimSpace(val)
		case "DTSTART":
			if t, allDay, ok := parseICSDateTime(val, params, defaultLoc); ok {
				cur.Start = t
				cur.AllDay = allDay
			}
		case "DTEND":
			if t, _, ok := parseICSDateTime(val, params, defaultLoc); ok {
				cur.End = t
				cur.HasEnd = true
			}
		case "DURATION":
			if d, ok := parseICSDuration(val); ok {
				cur.Duration = d
				cur.HasDuration = true
			}
		case "RRULE":
			cur.RRule = strings.TrimSpace(val)
		case "EXDATE":
			for _, part := range strings.Split(val, ",") {
				if t, allDay, ok := parseICSDateTime(strings.TrimSpace(part), params, defaultLoc); ok {
					cur.ExDates[t.UTC().Unix()] = true
					cur.ExDayKeys[t.In(defaultLoc).Format("2006-01-02")] = true
					if allDay {
						cur.ExDayKeys[t.Format("2006-01-02")] = true
					}
				}
			}
		case "RECURRENCE-ID":
			if t, _, ok := parseICSDateTime(val, params, defaultLoc); ok {
				tt := t
				cur.RecurrenceID = &tt
				cur.RecurrenceDK = t.In(defaultLoc).Format("2006-01-02")
			}
		}
	}
	return events
}

func parseICSPropAndParams(propPart string) (string, map[string]string) {
	parts := strings.Split(propPart, ";")
	name := strings.ToUpper(strings.TrimSpace(parts[0]))
	params := make(map[string]string, len(parts)-1)
	for _, p := range parts[1:] {
		eq := strings.IndexByte(p, '=')
		if eq <= 0 {
			continue
		}
		k := strings.ToUpper(strings.TrimSpace(p[:eq]))
		v := strings.Trim(strings.TrimSpace(p[eq+1:]), `"`)
		params[k] = v
	}
	return name, params
}

func unescapeICSText(s string) string {
	var b strings.Builder
	b.Grow(len(s))
	for i := 0; i < len(s); i++ {
		if s[i] == '\\' && i+1 < len(s) {
			next := s[i+1]
			switch next {
			case 'n', 'N':
				b.WriteByte(' ')
				i++
				continue
			case ',', ';', '\\':
				b.WriteByte(next)
				i++
				continue
			}
		}
		b.WriteByte(s[i])
	}
	return strings.TrimSpace(b.String())
}

func parseICSDateTime(val string, params map[string]string, defaultLoc *time.Location) (time.Time, bool, bool) {
	v := strings.TrimSpace(val)
	if v == "" {
		return time.Time{}, false, false
	}

	// All-day date: YYYYMMDD
	if strings.EqualFold(params["VALUE"], "DATE") || len(v) == 8 {
		t, err := time.ParseInLocation("20060102", v, defaultLoc)
		if err != nil {
			return time.Time{}, false, false
		}
		return t, true, true
	}

	// UTC timestamp: YYYYMMDDTHHMMSSZ
	if strings.HasSuffix(v, "Z") || strings.HasSuffix(v, "z") {
		t, err := time.Parse("20060102T150405Z", strings.ToUpper(v))
		if err != nil {
			return time.Time{}, false, false
		}
		return t, false, true
	}

	// Local or TZID timestamp: YYYYMMDDTHHMMSS
	loc := defaultLoc
	if tzid := params["TZID"]; tzid != "" {
		loc = loadTimezoneSafe(tzid)
	}
	t, err := time.ParseInLocation("20060102T150405", strings.ToUpper(v), loc)
	if err != nil {
		return time.Time{}, false, false
	}
	return t, false, true
}

func parseICSDuration(s string) (time.Duration, bool) {
	v := strings.ToUpper(strings.TrimSpace(s))
	if v == "" {
		return 0, false
	}
	neg := false
	if v[0] == '-' {
		neg = true
		v = v[1:]
	} else if v[0] == '+' {
		v = v[1:]
	}
	if !strings.HasPrefix(v, "P") {
		return 0, false
	}
	v = v[1:]
	var total time.Duration
	inTime := false
	numStart := -1
	for i := 0; i < len(v); i++ {
		ch := v[i]
		if ch == 'T' {
			inTime = true
			continue
		}
		if ch >= '0' && ch <= '9' {
			if numStart < 0 {
				numStart = i
			}
			continue
		}
		if numStart >= 0 {
			n, err := strconv.Atoi(v[numStart:i])
			numStart = -1
			if err != nil {
				continue
			}
			switch ch {
			case 'W':
				total += time.Duration(n) * 7 * 24 * time.Hour
			case 'D':
				total += time.Duration(n) * 24 * time.Hour
			case 'H':
				total += time.Duration(n) * time.Hour
			case 'M':
				if inTime {
					total += time.Duration(n) * time.Minute
				}
			case 'S':
				total += time.Duration(n) * time.Second
			}
		}
	}
	if neg {
		total = -total
	}
	return total, total != 0
}

func loadTimezoneSafe(name string) *time.Location {
	clean := strings.Trim(strings.TrimSpace(name), `"`)
	if clean == "" {
		return time.UTC
	}
	if mapped, ok := windowsTimezoneMap[strings.ToLower(clean)]; ok {
		clean = mapped
	}
	if loc, err := time.LoadLocation(clean); err == nil {
		return loc
	}
	// Handle slash-prefixed or full-path TZIDs like "/freeassociation.sourceforge.net/America/Los_Angeles"
	for _, prefix := range []string{"America/", "Europe/", "Asia/", "Pacific/", "Australia/", "Africa/", "Atlantic/"} {
		if idx := strings.Index(clean, prefix); idx >= 0 {
			if loc, err := time.LoadLocation(clean[idx:]); err == nil {
				return loc
			}
		}
	}
	return time.UTC
}

var windowsTimezoneMap = map[string]string{
	"pacific standard time":      "America/Los_Angeles",
	"us/pacific":                 "America/Los_Angeles",
	"pst8pdt":                    "America/Los_Angeles",
	"eastern standard time":      "America/New_York",
	"us/eastern":                 "America/New_York",
	"est5edt":                    "America/New_York",
	"central standard time":      "America/Chicago",
	"us/central":                 "America/Chicago",
	"mountain standard time":     "America/Denver",
	"us/mountain":                "America/Denver",
	"china standard time":        "Asia/Shanghai",
	"tokyo standard time":        "Asia/Tokyo",
	"gmt standard time":          "Europe/London",
	"greenwich standard time":    "UTC",
	"coordinated universal time": "UTC",
}

// expandEventsForWindow expands single & recurring VEVENTs into CalendarEvent slices
// intersecting [winStart, winEnd) in the display timezone.
func expandEventsForWindow(
	rawEvents []rawICSEvent,
	calID, calName, color string,
	winStart, winEnd time.Time,
	loc *time.Location,
) []CalendarEvent {
	// Index RECURRENCE-ID overrides so recurring masters skip replaced dates
	overrides := make(map[string]map[string]bool)
	for _, ev := range rawEvents {
		if ev.RecurrenceID != nil && ev.UID != "" {
			if overrides[ev.UID] == nil {
				overrides[ev.UID] = make(map[string]bool)
			}
			overrides[ev.UID][ev.RecurrenceDK] = true
			overrides[ev.UID][strconv.FormatInt(ev.RecurrenceID.UTC().Unix(), 10)] = true
		}
	}

	var out []CalendarEvent
	for _, ev := range rawEvents {
		dur := ev.End.Sub(ev.Start)
		if dur <= 0 {
			if ev.AllDay {
				dur = 24 * time.Hour
			} else {
				dur = time.Hour
			}
		}

		if ev.RRule == "" {
			emitEventOccurrences(&out, ev, ev.Start, ev.End, calID, calName, color, winStart, winEnd, loc)
			continue
		}

		starts := expandRRuleStarts(ev, winStart.Add(-dur), winEnd, loc)
		ov := overrides[ev.UID]
		for _, st := range starts {
			if ev.ExDates[st.UTC().Unix()] {
				continue
			}
			dayKey := st.In(loc).Format("2006-01-02")
			if ev.AllDay && ev.ExDayKeys[dayKey] {
				continue
			}
			if ov != nil && (ov[dayKey] || ov[strconv.FormatInt(st.UTC().Unix(), 10)]) {
				continue
			}
			emitEventOccurrences(&out, ev, st, st.Add(dur), calID, calName, color, winStart, winEnd, loc)
		}
	}
	return out
}

func emitEventOccurrences(
	out *[]CalendarEvent,
	ev rawICSEvent,
	start, end time.Time,
	calID, calName, color string,
	winStart, winEnd time.Time,
	loc *time.Location,
) {
	if !end.After(winStart) || !start.Before(winEnd) {
		return
	}

	startLocal := start.In(loc)
	endLocal := end.In(loc)

	if ev.AllDay {
		curDay := time.Date(startLocal.Year(), startLocal.Month(), startLocal.Day(), 0, 0, 0, 0, loc)
		lastDay := time.Date(endLocal.Year(), endLocal.Month(), endLocal.Day(), 0, 0, 0, 0, loc)
		if !lastDay.After(curDay) {
			lastDay = curDay.AddDate(0, 0, 1)
		}
		for curDay.Before(lastDay) {
			if !curDay.Before(winStart) && curDay.Before(winEnd) {
				dateStr := curDay.Format("2006-01-02")
				*out = append(*out, CalendarEvent{
					ID:           fmt.Sprintf("%s-%s-%s", calID, ev.UID, dateStr),
					CalendarID:   calID,
					CalendarName: calName,
					Color:        color,
					Title:        ev.Summary,
					Location:     ev.Location,
					Date:         dateStr,
					AllDay:       true,
					StartMs:      curDay.UnixNano() / int64(time.Millisecond),
					EndMs:        curDay.AddDate(0, 0, 1).UnixNano() / int64(time.Millisecond),
				})
			}
			curDay = curDay.AddDate(0, 0, 1)
		}
		return
	}

	dateStr := startLocal.Format("2006-01-02")
	*out = append(*out, CalendarEvent{
		ID:           fmt.Sprintf("%s-%s-%d", calID, ev.UID, start.UTC().Unix()),
		CalendarID:   calID,
		CalendarName: calName,
		Color:        color,
		Title:        ev.Summary,
		Location:     ev.Location,
		Date:         dateStr,
		AllDay:       false,
		StartMs:      start.UnixNano() / int64(time.Millisecond),
		EndMs:        end.UnixNano() / int64(time.Millisecond),
		StartTime:    startLocal.Format("15:04"),
		EndTime:      endLocal.Format("15:04"),
	})
}

type parsedRRule struct {
	Freq       string
	Interval   int
	Count      int
	Until      time.Time
	HasUntil   bool
	ByDay      []string
	ByMonthDay []int
	ByMonth    []int
}

func parseRRule(rule string, defaultLoc *time.Location) parsedRRule {
	rr := parsedRRule{Interval: 1}
	for _, part := range strings.Split(rule, ";") {
		eq := strings.IndexByte(part, '=')
		if eq <= 0 {
			continue
		}
		k := strings.ToUpper(strings.TrimSpace(part[:eq]))
		v := strings.ToUpper(strings.TrimSpace(part[eq+1:]))
		switch k {
		case "FREQ":
			rr.Freq = v
		case "INTERVAL":
			if n, err := strconv.Atoi(v); err == nil && n > 0 {
				rr.Interval = n
			}
		case "COUNT":
			if n, err := strconv.Atoi(v); err == nil && n > 0 {
				rr.Count = n
			}
		case "UNTIL":
			if t, _, ok := parseICSDateTime(v, nil, defaultLoc); ok {
				rr.Until = t
				rr.HasUntil = true
			}
		case "BYDAY":
			for _, d := range strings.Split(v, ",") {
				d = strings.TrimSpace(d)
				if d != "" {
					rr.ByDay = append(rr.ByDay, d)
				}
			}
		case "BYMONTHDAY":
			for _, md := range strings.Split(v, ",") {
				if n, err := strconv.Atoi(strings.TrimSpace(md)); err == nil && n != 0 {
					rr.ByMonthDay = append(rr.ByMonthDay, n)
				}
			}
		case "BYMONTH":
			for _, m := range strings.Split(v, ",") {
				if n, err := strconv.Atoi(strings.TrimSpace(m)); err == nil && n >= 1 && n <= 12 {
					rr.ByMonth = append(rr.ByMonth, n)
				}
			}
		}
	}
	return rr
}

var icsWeekdayMap = map[string]time.Weekday{
	"SU": time.Sunday,
	"MO": time.Monday,
	"TU": time.Tuesday,
	"WE": time.Wednesday,
	"TH": time.Thursday,
	"FR": time.Friday,
	"SA": time.Saturday,
}

func expandRRuleStarts(ev rawICSEvent, winStart, winEnd time.Time, displayLoc *time.Location) []time.Time {
	rr := parseRRule(ev.RRule, displayLoc)
	if rr.Freq == "" {
		return []time.Time{ev.Start}
	}

	srcLoc := ev.Start.Location()
	if srcLoc == nil {
		srcLoc = displayLoc
	}
	orig := ev.Start
	hr, mn, sc := orig.Clock()

	maxEnd := winEnd
	if rr.HasUntil && rr.Until.Before(maxEnd) {
		maxEnd = rr.Until.Add(time.Second)
	}
	if orig.After(maxEnd) {
		return nil
	}

	var results []time.Time
	totalEmitted := 0
	const maxGuardIterations = 20000

	accept := func(t time.Time) bool {
		if t.Before(orig) {
			return true
		}
		if rr.HasUntil && t.After(rr.Until) {
			return false
		}
		if rr.Count > 0 {
			totalEmitted++
			if totalEmitted > rr.Count {
				return false
			}
		}
		if !t.Before(maxEnd) {
			return false
		}
		if !t.Before(winStart) {
			results = append(results, t)
		}
		return true
	}

	switch rr.Freq {
	case "DAILY":
		cur := orig
		// Fast-forward when no COUNT is set
		if rr.Count == 0 && cur.Before(winStart) {
			daysDiff := int(winStart.Sub(cur).Hours() / 24)
			steps := daysDiff / rr.Interval
			if steps > 1 {
				cur = cur.AddDate(0, 0, (steps-1)*rr.Interval)
			}
		}
		for i := 0; i < maxGuardIterations && cur.Before(maxEnd); i++ {
			if !accept(cur) {
				break
			}
			cur = cur.AddDate(0, 0, rr.Interval)
		}

	case "WEEKLY":
		weekdays := make([]time.Weekday, 0, len(rr.ByDay))
		for _, bd := range rr.ByDay {
			code := bd
			if len(code) > 2 {
				code = code[len(code)-2:]
			}
			if wd, ok := icsWeekdayMap[code]; ok {
				weekdays = append(weekdays, wd)
			}
		}
		if len(weekdays) == 0 {
			weekdays = []time.Weekday{orig.Weekday()}
		}

		// Anchor to Monday of orig's week
		weekOffset := (int(orig.Weekday()) + 6) % 7
		weekMonday := time.Date(orig.Year(), orig.Month(), orig.Day()-weekOffset, hr, mn, sc, 0, srcLoc)

		if rr.Count == 0 && weekMonday.Before(winStart) {
			weeksDiff := int(winStart.Sub(weekMonday).Hours() / (24 * 7))
			steps := weeksDiff / rr.Interval
			if steps > 1 {
				weekMonday = weekMonday.AddDate(0, 0, (steps-1)*7*rr.Interval)
			}
		}

		for i := 0; i < maxGuardIterations && weekMonday.Before(maxEnd); i++ {
			for d := 0; d < 7; d++ {
				cand := weekMonday.AddDate(0, 0, d)
				matched := false
				for _, wd := range weekdays {
					if cand.Weekday() == wd {
						matched = true
						break
					}
				}
				if !matched {
					continue
				}
				if !accept(cand) {
					return results
				}
			}
			weekMonday = weekMonday.AddDate(0, 0, 7*rr.Interval)
		}

	case "MONTHLY":
		y, m := orig.Year(), int(orig.Month())
		if rr.Count == 0 && orig.Before(winStart) {
			monthsDiff := (winStart.Year()-y)*12 + (int(winStart.Month()) - m)
			steps := monthsDiff / rr.Interval
			if steps > 1 {
				totalM := (y*12 + (m - 1)) + (steps-1)*rr.Interval
				y = totalM / 12
				m = (totalM % 12) + 1
			}
		}

		for i := 0; i < maxGuardIterations; i++ {
			firstOfMonth := time.Date(y, time.Month(m), 1, hr, mn, sc, 0, srcLoc)
			if !firstOfMonth.Before(maxEnd) {
				break
			}
			cands := monthlyCandidates(y, time.Month(m), orig.Day(), hr, mn, sc, srcLoc, rr.ByDay, rr.ByMonthDay)
			for _, cand := range cands {
				if !accept(cand) {
					return results
				}
			}
			totalM := (y*12 + (m - 1)) + rr.Interval
			y = totalM / 12
			m = (totalM % 12) + 1
		}

	case "YEARLY":
		y := orig.Year()
		if rr.Count == 0 && orig.Before(winStart) {
			yearsDiff := winStart.Year() - y
			steps := yearsDiff / rr.Interval
			if steps > 1 {
				y += (steps - 1) * rr.Interval
			}
		}

		months := rr.ByMonth
		if len(months) == 0 {
			months = []int{int(orig.Month())}
		}
		for i := 0; i < maxGuardIterations; i++ {
			if time.Date(y, time.January, 1, 0, 0, 0, 0, srcLoc).After(maxEnd) {
				break
			}
			for _, m := range months {
				cands := monthlyCandidates(y, time.Month(m), orig.Day(), hr, mn, sc, srcLoc, rr.ByDay, rr.ByMonthDay)
				for _, cand := range cands {
					if !accept(cand) {
						return results
					}
				}
			}
			y += rr.Interval
		}
	}

	return results
}

func monthlyCandidates(
	year int,
	month time.Month,
	defaultDay, hr, mn, sc int,
	loc *time.Location,
	byDay []string,
	byMonthDay []int,
) []time.Time {
	daysInMonth := time.Date(year, month+1, 0, 0, 0, 0, 0, loc).Day()

	if len(byDay) > 0 {
		var out []time.Time
		for _, spec := range byDay {
			if len(spec) < 2 {
				continue
			}
			wdCode := spec[len(spec)-2:]
			wd, ok := icsWeekdayMap[wdCode]
			if !ok {
				continue
			}
			ordStr := spec[:len(spec)-2]
			var matchingDays []int
			for d := 1; d <= daysInMonth; d++ {
				if time.Date(year, month, d, 0, 0, 0, 0, loc).Weekday() == wd {
					matchingDays = append(matchingDays, d)
				}
			}
			if ordStr == "" {
				for _, d := range matchingDays {
					out = append(out, time.Date(year, month, d, hr, mn, sc, 0, loc))
				}
				continue
			}
			ord, err := strconv.Atoi(ordStr)
			if err != nil || ord == 0 {
				continue
			}
			var targetIdx int
			if ord > 0 {
				targetIdx = ord - 1
			} else {
				targetIdx = len(matchingDays) + ord
			}
			if targetIdx >= 0 && targetIdx < len(matchingDays) {
				out = append(out, time.Date(year, month, matchingDays[targetIdx], hr, mn, sc, 0, loc))
			}
		}
		sort.Slice(out, func(i, j int) bool { return out[i].Before(out[j]) })
		return out
	}

	days := byMonthDay
	if len(days) == 0 {
		days = []int{defaultDay}
	}
	var out []time.Time
	for _, d := range days {
		actual := d
		if d < 0 {
			actual = daysInMonth + 1 + d
		}
		if actual >= 1 && actual <= daysInMonth {
			out = append(out, time.Date(year, month, actual, hr, mn, sc, 0, loc))
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Before(out[j]) })
	return out
}

func sortCalendarEvents(events []CalendarEvent) {
	sort.Slice(events, func(i, j int) bool {
		if events[i].Date != events[j].Date {
			return events[i].Date < events[j].Date
		}
		if events[i].AllDay != events[j].AllDay {
			return events[i].AllDay
		}
		if events[i].StartMs != events[j].StartMs {
			return events[i].StartMs < events[j].StartMs
		}
		return events[i].Title < events[j].Title
	})
}

var strongStayPrefixes = []string{
	"stay at ",
	"stay in ",
	"stay - ",
	"hotel stay",
	"hotel:",
}

var lodgingKeywords = []string{
	"hotel",
	"resort",
	"airbnb",
	"vrbo",
	"ryokan",
	"motel",
	"hostel",
	"bed and breakfast",
	"b&b",
	"lodge",
	"marriott",
	"hilton",
	"hyatt",
	"westin",
	"sheraton",
	"intercontinental",
	"fairmont",
	"ritz-carlton",
	"ritz carlton",
	"four seasons",
	"waldorf",
	"st. regis",
	"st regis",
	"conrad",
	"kimpton",
	"andaz",
	"alila",
	"doubletree",
	"embassy suites",
	"courtyard",
	"hampton inn",
	"residence inn",
	"homewood suites",
	"holiday inn",
	"crowne plaza",
	"ac hotel",
	"moxy",
	"sofitel",
	"novotel",
	"shangri-la",
	"mandarin oriental",
	"peninsula",
	"banyan tree",
	"hoshinoya",
	"酒店",
	"民宿",
	"入住",
}

var travelKeywords = []string{
	"vacation",
	"getaway",
	"cruise",
	"road trip",
	"ski trip",
	"度假",
	"旅游",
	"旅行",
}

func isASCIIAlphaNum(b byte) bool {
	return (b >= 'a' && b <= 'z') || (b >= 'A' && b <= 'Z') || (b >= '0' && b <= '9')
}

func containsWholeWord(lower, word string) bool {
	if word == "" || len(lower) < len(word) {
		return false
	}
	offset := 0
	for {
		idx := strings.Index(lower[offset:], word)
		if idx < 0 {
			return false
		}
		start := offset + idx
		end := start + len(word)
		leftOK := start == 0 || !isASCIIAlphaNum(lower[start-1])
		rightOK := end == len(lower) || !isASCIIAlphaNum(lower[end])
		if leftOK && rightOK {
			return true
		}
		offset = start + 1
	}
}

func isTripEvent(title string, allDay bool, days int, dur time.Duration) bool {
	lower := strings.ToLower(strings.TrimSpace(title))
	if lower == "" {
		return false
	}

	// Explicit "Stay at ..." / hotel stay events (all-day or multi-day timed check-in/out)
	for _, pfx := range strongStayPrefixes {
		if strings.HasPrefix(lower, pfx) || strings.Contains(lower, " "+pfx) {
			return allDay || dur >= 18*time.Hour
		}
	}

	// Hotel / lodging brand or venue keywords
	hasLodging := false
	for _, kw := range lodgingKeywords {
		if strings.Contains(lower, kw) {
			hasLodging = true
			break
		}
	}
	if !hasLodging && (containsWholeWord(lower, "inn") || containsWholeWord(lower, "villa") || containsWholeWord(lower, "cabin")) {
		hasLodging = true
	}
	if hasLodging {
		return allDay || dur >= 18*time.Hour
	}

	// General travel/trip keywords require multi-day span to avoid 1-day errands/reminders
	hasTravel := containsWholeWord(lower, "trip")
	if !hasTravel {
		for _, kw := range travelKeywords {
			if strings.Contains(lower, kw) {
				hasTravel = true
				break
			}
		}
	}
	if hasTravel {
		return (allDay && days >= 2) || (!allDay && dur >= 24*time.Hour)
	}

	return false
}

func cleanTripDisplayName(title string) string {
	trimmed := strings.TrimSpace(title)
	lower := strings.ToLower(trimmed)
	for _, pfx := range []string{"stay at ", "stay in ", "stay - ", "hotel: "} {
		if strings.HasPrefix(lower, pfx) {
			rest := strings.TrimSpace(trimmed[len(pfx):])
			if rest != "" {
				return rest
			}
		}
	}
	return trimmed
}

func calendarDaysSpan(startDay, endExclDay time.Time) int {
	// Use UTC midnight arithmetic so DST transitions never skew day counts
	sUTC := time.Date(startDay.Year(), startDay.Month(), startDay.Day(), 0, 0, 0, 0, time.UTC)
	eUTC := time.Date(endExclDay.Year(), endExclDay.Month(), endExclDay.Day(), 0, 0, 0, 0, time.UTC)
	days := int(eUTC.Sub(sUTC) / (24 * time.Hour))
	if days < 1 {
		return 1
	}
	return days
}

// extractUpcomingTrips scans parsed ICS events over the next 365 days for hotel stays & multi-day trips.
func extractUpcomingTrips(
	rawEvents []rawICSEvent,
	calID, calName, color string,
	nowLocal time.Time,
	loc *time.Location,
) []CalendarTrip {
	todayStart := time.Date(nowLocal.Year(), nowLocal.Month(), nowLocal.Day(), 0, 0, 0, 0, loc)
	horizonEnd := todayStart.AddDate(1, 0, 0)

	overrides := make(map[string]map[string]bool)
	for _, ev := range rawEvents {
		if ev.RecurrenceID != nil && ev.UID != "" {
			if overrides[ev.UID] == nil {
				overrides[ev.UID] = make(map[string]bool)
			}
			overrides[ev.UID][ev.RecurrenceDK] = true
			overrides[ev.UID][strconv.FormatInt(ev.RecurrenceID.UTC().Unix(), 10)] = true
		}
	}

	var trips []CalendarTrip
	consider := func(ev rawICSEvent, start, end time.Time) {
		if !end.After(todayStart) || !start.Before(horizonEnd) {
			return
		}
		dur := end.Sub(start)
		startLocal := start.In(loc)
		endLocal := end.In(loc)

		var startDay, endInclDay time.Time
		var days int
		if ev.AllDay {
			startDay = time.Date(startLocal.Year(), startLocal.Month(), startLocal.Day(), 0, 0, 0, 0, loc)
			endExclDay := time.Date(endLocal.Year(), endLocal.Month(), endLocal.Day(), 0, 0, 0, 0, loc)
			if !endExclDay.After(startDay) {
				endExclDay = startDay.AddDate(0, 0, 1)
			}
			if !endExclDay.After(todayStart) {
				return
			}
			days = calendarDaysSpan(startDay, endExclDay)
			endInclDay = endExclDay.AddDate(0, 0, -1)
		} else {
			if !end.After(nowLocal) {
				return
			}
			startDay = time.Date(startLocal.Year(), startLocal.Month(), startLocal.Day(), 0, 0, 0, 0, loc)
			endInclDay = time.Date(endLocal.Year(), endLocal.Month(), endLocal.Day(), 0, 0, 0, 0, loc)
			if endInclDay.Before(startDay) {
				endInclDay = startDay
			}
			days = calendarDaysSpan(startDay, endInclDay.AddDate(0, 0, 1))
		}

		if !isTripEvent(ev.Summary, ev.AllDay, days, dur) {
			return
		}

		startStr := startDay.Format("2006-01-02")
		endStr := endInclDay.Format("2006-01-02")
		trips = append(trips, CalendarTrip{
			ID:           fmt.Sprintf("%s-%s-%s", calID, ev.UID, startStr),
			CalendarID:   calID,
			CalendarName: calName,
			Color:        color,
			Title:        ev.Summary,
			DisplayName:  cleanTripDisplayName(ev.Summary),
			Location:     ev.Location,
			StartDate:    startStr,
			EndDate:      endStr,
			Days:         days,
		})
	}

	for _, ev := range rawEvents {
		dur := ev.End.Sub(ev.Start)
		if dur <= 0 {
			if ev.AllDay {
				dur = 24 * time.Hour
			} else {
				dur = time.Hour
			}
		}
		if ev.RRule == "" {
			consider(ev, ev.Start, ev.End)
			continue
		}
		starts := expandRRuleStarts(ev, todayStart.Add(-dur), horizonEnd, loc)
		ov := overrides[ev.UID]
		for _, st := range starts {
			if ev.ExDates[st.UTC().Unix()] {
				continue
			}
			dayKey := st.In(loc).Format("2006-01-02")
			if ev.AllDay && ev.ExDayKeys[dayKey] {
				continue
			}
			if ov != nil && (ov[dayKey] || ov[strconv.FormatInt(st.UTC().Unix(), 10)]) {
				continue
			}
			consider(ev, st, st.Add(dur))
		}
	}

	return trips
}

func normalizeUpcomingTrips(trips []CalendarTrip) []CalendarTrip {
	if len(trips) == 0 {
		return nil
	}
	sort.Slice(trips, func(i, j int) bool {
		if trips[i].StartDate != trips[j].StartDate {
			return trips[i].StartDate < trips[j].StartDate
		}
		if trips[i].Days != trips[j].Days {
			return trips[i].Days > trips[j].Days
		}
		return trips[i].Title < trips[j].Title
	})

	seen := make(map[string]bool, len(trips))
	out := make([]CalendarTrip, 0, len(trips))
	for _, t := range trips {
		key := t.CalendarID + "|" + t.StartDate + "|" + strings.ToLower(t.DisplayName)
		if seen[key] {
			continue
		}
		seen[key] = true
		out = append(out, t)
		if len(out) >= 10 {
			break
		}
	}
	return out
}

func writeCalendarError(w http.ResponseWriter, status int, message string) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "private, no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]string{
		"error": message,
	})
}

// ---------------------------------------------------------------------------
// Demo calendars
//
// Kept in this file on purpose: Vercel treats every .go file in api/ as a
// serverless function entrypoint, so helper-only files there fail the build.
// ---------------------------------------------------------------------------

// Demo calendars for /api/calendar?demo=1 (the dashboard opened with
// ?demo=calendar). Events are generated as iCalendar text relative to "now"
// and run through the real ICS parser, so recurrence, the next-event banner,
// and trip countdowns behave exactly as they do with private feeds.

type demoEvent struct {
	title    string
	location string
	day      int // days from today
	start    string
	end      string // "HH:MM"; empty start/end = all-day
	days     int    // all-day span in days (default 1)
	rrule    string
}

type demoCalendar struct {
	id     string
	name   string
	color  string
	events []demoEvent
}

var demoCalendars = []demoCalendar{
	{
		id: "demo-work", name: "Work", color: "#a78bfa",
		events: []demoEvent{
			{title: "Team standup", day: -63, start: "09:30", end: "09:45", rrule: "FREQ=WEEKLY;BYDAY=MO,WE,FR"},
			{title: "1:1 with Priya", day: -60, start: "14:00", end: "14:30", rrule: "FREQ=WEEKLY;BYDAY=TH"},
			{title: "Design review", location: "Room 4B", day: 0, start: "11:00", end: "12:00"},
			{title: "Customer demo", location: "Zoom", day: -5, start: "13:00", end: "14:00"},
			{title: "Quarterly planning", location: "Atlas conference room", day: 2, start: "15:00", end: "16:30"},
			{title: "Launch retro", day: 8, start: "10:00", end: "11:00"},
			{title: "Team offsite", location: "Half Moon Bay", day: 13, days: 2},
		},
	},
	{
		id: "demo-personal", name: "Personal", color: "#38bdf8",
		events: []demoEvent{
			{title: "Morning run", day: -62, start: "07:00", end: "07:45", rrule: "FREQ=WEEKLY;BYDAY=TU,TH"},
			{title: "Lunch with Sam", location: "Tartine", day: 0, start: "12:30", end: "13:30"},
			{title: "Book club", location: "Kepler's Books", day: 0, start: "18:30", end: "20:00"},
			{title: "Dinner with Alex & Jordan", day: -3, start: "19:00", end: "21:00"},
			{title: "Dentist", day: 3, start: "08:00", end: "08:45"},
			{title: "Haircut", day: 6, start: "10:00", end: "10:45"},
			{title: "Ski trip to Tahoe", day: 19, days: 4},
		},
	},
	{
		id: "demo-family", name: "Family", color: "#34d399",
		events: []demoEvent{
			{title: "Soccer practice", location: "Ortega Park", day: -61, start: "10:00", end: "11:30", rrule: "FREQ=WEEKLY;BYDAY=SA"},
			{title: "Mom's birthday", day: 4, days: 1},
			{title: "Parent-teacher conference", day: -8, start: "16:00", end: "16:30"},
			{title: "Family movie night", day: 1, start: "19:30", end: "21:30"},
			{title: "Pick up groceries", day: 0, start: "17:00", end: "17:30"},
			{title: "Grandparents visit", day: 10, days: 3},
		},
	},
}

// demoCalendarSources returns the demo calendars as inline-ICS sources.
func demoCalendarSources(now time.Time) []calendarSource {
	today := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location())
	sources := make([]calendarSource, 0, len(demoCalendars))
	for _, c := range demoCalendars {
		sources = append(sources, calendarSource{
			ID:    c.id,
			Name:  c.name,
			Color: c.color,
			ICS:   buildDemoICS(c, today),
		})
	}
	return sources
}

func buildDemoICS(c demoCalendar, today time.Time) string {
	var b strings.Builder
	b.WriteString("BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Glance//Demo//EN\r\n")
	for i, ev := range c.events {
		day := today.AddDate(0, 0, ev.day)
		fmt.Fprintf(&b, "BEGIN:VEVENT\r\nUID:%s-%d@glance.demo\r\nSUMMARY:%s\r\n", c.id, i, ev.title)
		if ev.location != "" {
			fmt.Fprintf(&b, "LOCATION:%s\r\n", ev.location)
		}
		if ev.start == "" {
			span := ev.days
			if span < 1 {
				span = 1
			}
			fmt.Fprintf(&b, "DTSTART;VALUE=DATE:%s\r\nDTEND;VALUE=DATE:%s\r\n",
				day.Format("20060102"), day.AddDate(0, 0, span).Format("20060102"))
		} else {
			// Floating local times are interpreted in the Home city's timezone
			fmt.Fprintf(&b, "DTSTART:%sT%s00\r\nDTEND:%sT%s00\r\n",
				day.Format("20060102"), strings.Replace(ev.start, ":", "", 1),
				day.Format("20060102"), strings.Replace(ev.end, ":", "", 1))
		}
		if ev.rrule != "" {
			fmt.Fprintf(&b, "RRULE:%s\r\n", ev.rrule)
		}
		b.WriteString("END:VEVENT\r\n")
	}
	b.WriteString("END:VCALENDAR\r\n")
	return b.String()
}
