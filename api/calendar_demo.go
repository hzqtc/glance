package handler

import (
	"fmt"
	"strings"
	"time"
)

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
