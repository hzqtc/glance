package handler

import (
	"bytes"
	"encoding/json"
	"io"
	"math"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(r *http.Request) (*http.Response, error) {
	return f(r)
}

func TestDecodeOpenMeteoResponseSingleAndMulti(t *testing.T) {
	singleJSON := []byte(`{"utc_offset_seconds":-28800,"current":{"time":"2026-11-18T22:00","temperature_2m":14.5,"is_day":0}}`)
	got, err := decodeOpenMeteoResponse(singleJSON)
	if err != nil {
		t.Fatalf("single decode failed: %v", err)
	}
	if len(got) != 1 || got[0].Current.Temperature2m != 14.5 {
		t.Fatalf("unexpected single result: %+v", got)
	}

	multiJSON := []byte(`[
		{"utc_offset_seconds":-28800,"current":{"time":"2026-11-18T22:00","temperature_2m":14.5,"is_day":0}},
		{"utc_offset_seconds":28800,"current":{"time":"2026-11-19T14:00","temperature_2m":19.0,"is_day":1}}
	]`)
	got, err = decodeOpenMeteoResponse(multiJSON)
	if err != nil {
		t.Fatalf("multi decode failed: %v", err)
	}
	if len(got) != 2 || got[1].UTCOffsetSeconds != 28800 {
		t.Fatalf("unexpected multi result: %+v", got)
	}
}

func TestExtractNextHours(t *testing.T) {
	h := omHourly{
		Time:                     []string{"2026-11-18T21:00", "2026-11-18T22:00", "2026-11-18T23:00", "2026-11-19T00:00"},
		Temperature2m:            []float64{16, 15, 14, 13},
		WeatherCode:              []int{0, 1, 2, 3},
		PrecipitationProbability: []int{0, 5, 10, 20},
		IsDay:                    []int{0, 0, 0, 0},
	}

	got := extractNextHours("2026-11-18T22:15", h, 2)
	if len(got) != 2 {
		t.Fatalf("expected 2 hours, got %d", len(got))
	}
	if got[0].Time != "2026-11-18T23:00" || got[1].Time != "2026-11-19T00:00" {
		t.Fatalf("unexpected hours: %+v", got)
	}
}

func TestComputeRainNowcast(t *testing.T) {
	m15Start := omMinutely15{
		Time:          []string{"2026-11-18T22:00", "2026-11-18T22:15", "2026-11-18T22:30", "2026-11-18T22:45"},
		Precipitation: []float64{0, 0, 0.3, 0.4},
	}
	if got := computeRainNowcast("2026-11-18T22:00", m15Start); got != "Rain in ~30 min" {
		t.Fatalf("expected 'Rain in ~30 min', got %q", got)
	}

	m15End := omMinutely15{
		Time:          []string{"2026-11-18T22:00", "2026-11-18T22:15", "2026-11-18T22:30", "2026-11-18T22:45"},
		Precipitation: []float64{0.4, 0.2, 0.1, 0},
	}
	if got := computeRainNowcast("2026-11-18T22:00", m15End); got != "Rain ending in ~45 min" {
		t.Fatalf("expected 'Rain ending in ~45 min', got %q", got)
	}
}

func TestWeatherHandlerEndToEnd(t *testing.T) {
	mockForecast := `[
		{
			"utc_offset_seconds": -28800,
			"current": {"time":"2026-11-19T22:00","temperature_2m":14.0,"apparent_temperature":13.2,"dew_point_2m":6.5,"relative_humidity_2m":68,"weather_code":2,"wind_speed_10m":9.5,"wind_direction_10m":315,"visibility":16000,"is_day":0,"cloud_cover":35},
			"minutely_15": {"time":["2026-11-19T22:00","2026-11-19T22:15","2026-11-19T22:30"],"precipitation":[0,0,0.25]},
			"hourly": {"time":["2026-11-19T22:00","2026-11-19T23:00","2026-11-20T00:00"],"temperature_2m":[14,13,12],"weather_code":[2,2,1],"precipitation_probability":[10,5,0],"is_day":[0,0,0]},
			"daily": {
				"time":["2026-11-18","2026-11-19","2026-11-20","2026-11-21","2026-11-22","2026-11-23"],
				"weather_code":[0,2,0,1,61,0],
				"temperature_2m_max":[22.5,20.5,21.0,19.5,16.0,18.5],
				"temperature_2m_min":[10.0,9.0,8.5,9.5,10.0,8.0],
				"precipitation_probability_max":[0,10,0,5,75,0],
				"precipitation_sum":[0,0,0,0.2,8.5,0],
				"sunshine_duration":[30000,27000,31000,28000,10000,29000],
				"uv_index_max":[4.0,3.8,4.1,3.5,2.2,4.0],
				"sunrise":["2026-11-18T06:50","2026-11-19T06:51"],
				"sunset":["2026-11-18T16:55","2026-11-19T16:54"]
			}
		},
		{
			"utc_offset_seconds": -28800,
			"current": {"time":"2026-11-19T22:00","temperature_2m":12.5,"apparent_temperature":11.0,"dew_point_2m":9.0,"relative_humidity_2m":80,"weather_code":45,"wind_speed_10m":16.0,"wind_direction_10m":270,"visibility":1800,"is_day":0,"cloud_cover":85},
			"hourly": {"time":["2026-11-19T22:00","2026-11-19T23:00"],"temperature_2m":[12.5,12.0],"weather_code":[45,45],"precipitation_probability":[15,15],"is_day":[0,0]},
			"daily": {
				"time":["2026-11-18","2026-11-19","2026-11-20"],
				"weather_code":[2,45,2],
				"temperature_2m_max":[17.0,16.0,17.0],
				"temperature_2m_min":[10.0,10.0,9.5],
				"precipitation_probability_max":[10,15,10],
				"precipitation_sum":[0,0.1,0],
				"sunshine_duration":[22000,12000,24000],
				"uv_index_max":[3.2,3.0,3.5],
				"sunrise":["2026-11-18T06:52","2026-11-19T06:53"],
				"sunset":["2026-11-18T16:56","2026-11-19T16:55"]
			}
		},
		{
			"utc_offset_seconds": 28800,
			"current": {"time":"2026-11-20T14:00","temperature_2m":18.5,"apparent_temperature":18.0,"dew_point_2m":11.0,"relative_humidity_2m":62,"weather_code":61,"wind_speed_10m":14.0,"wind_direction_10m":90,"visibility":9000,"is_day":1,"cloud_cover":90},
			"hourly": {"time":["2026-11-20T14:00","2026-11-20T15:00"],"temperature_2m":[18.5,18.0],"weather_code":[61,61],"precipitation_probability":[70,65],"is_day":[1,1]},
			"daily": {
				"time":["2026-11-19","2026-11-20","2026-11-21"],
				"weather_code":[2,61,2],
				"temperature_2m_max":[19.0,20.0,19.0],
				"temperature_2m_min":[12.0,13.5,12.0],
				"precipitation_probability_max":[20,75,20],
				"precipitation_sum":[0,6.2,0],
				"sunshine_duration":[26000,6000,25000],
				"uv_index_max":[4.0,2.5,4.2],
				"sunrise":["2026-11-19T06:23","2026-11-20T06:24"],
				"sunset":["2026-11-19T16:56","2026-11-20T16:55"]
			}
		},
		{
			"utc_offset_seconds": 32400,
			"current": {"time":"2026-11-20T15:00","temperature_2m":16.0,"apparent_temperature":15.5,"dew_point_2m":7.0,"relative_humidity_2m":55,"weather_code":1,"wind_speed_10m":11.0,"wind_direction_10m":180,"visibility":20000,"is_day":1,"cloud_cover":20},
			"hourly": {"time":["2026-11-20T15:00","2026-11-20T16:00"],"temperature_2m":[16.0,15.0],"weather_code":[1,1],"precipitation_probability":[5,5],"is_day":[1,1]},
			"daily": {
				"time":["2026-11-19","2026-11-20","2026-11-21"],
				"weather_code":[0,1,0],
				"temperature_2m_max":[17.5,18.0,17.5],
				"temperature_2m_min":[9.5,10.5,9.5],
				"precipitation_probability_max":[5,10,5],
				"precipitation_sum":[0,0,0],
				"sunshine_duration":[29000,28000,30000],
				"uv_index_max":[3.8,3.6,3.8],
				"sunrise":["2026-11-19T06:20","2026-11-20T06:21"],
				"sunset":["2026-11-19T16:32","2026-11-20T16:31"]
			}
		}
	]`

	mockAir := `[
		{"current":{"us_aqi":28,"pm2_5":6.4,"uv_index":0.0}},
		{"current":{"us_aqi":34,"pm2_5":8.1,"uv_index":0.0}},
		{"current":{"us_aqi":72,"pm2_5":22.5,"uv_index":3.4}},
		{"current":{"us_aqi":24,"pm2_5":5.2,"uv_index":2.1}}
	]`

	origClient := weatherHTTPClient
	weatherHTTPClient = &http.Client{
		Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
			count := len(strings.Split(r.URL.Query().Get("latitude"), ","))
			basePayload := mockForecast
			if strings.Contains(r.URL.String(), "air-quality") {
				basePayload = mockAir
			}
			var items []json.RawMessage
			_ = json.Unmarshal([]byte(basePayload), &items)
			for len(items) < count && len(items) > 0 {
				items = append(items, items[len(items)-1])
			}
			outBytes, _ := json.Marshal(items)
			return &http.Response{
				StatusCode: http.StatusOK,
				Header:     http.Header{"Content-Type": []string{"application/json"}},
				Body:       io.NopCloser(bytes.NewReader(outBytes)),
			}, nil
		}),
	}
	defer func() { weatherHTTPClient = origClient }()

	req := httptest.NewRequest(http.MethodGet, "/api/weather", nil)
	rec := httptest.NewRecorder()
	WeatherHandler(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	var parsed WeatherResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &parsed); err != nil {
		t.Fatalf("invalid json response: %v", err)
	}
	if len(parsed.Weather) != 8 {
		t.Fatalf("expected 8 cities weather, got %d", len(parsed.Weather))
	}

	sv := parsed.Weather[0]
	if len(sv.Daily) != 5 || sv.Daily[0].Date != "2026-11-19" {
		t.Fatalf("expected 5 daily entries starting today (2026-11-19), got %+v", sv.Daily)
	}
	if sv.Sunrise != "06:51" || sv.RainNowcast != "Rain in ~30 min" {
		t.Fatalf("unexpected sunnyvale enriched fields: %+v", sv)
	}
	if sv.TempDeltaYesterdayC == nil || math.Abs(*sv.TempDeltaYesterdayC-(-2.0)) > 0.01 {
		t.Fatalf("expected temp delta -2.0C, got %+v", sv.TempDeltaYesterdayC)
	}
	if sv.PM25 == nil || math.Abs(*sv.PM25-6.4) > 0.01 {
		t.Fatalf("expected sunnyvale PM2.5 6.4, got %+v", sv.PM25)
	}
}
