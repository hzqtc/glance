package handler

import (
	"bytes"
	"encoding/json"
	"io"
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

func TestHandlerEndToEndWithMockOpenMeteoAndAirQuality(t *testing.T) {
	mockForecast := `[
		{
			"utc_offset_seconds": -28800,
			"current": {"time":"2026-11-18T22:00","temperature_2m":14.0,"apparent_temperature":13.2,"relative_humidity_2m":68,"weather_code":2,"wind_speed_10m":9.5,"is_day":0,"cloud_cover":35},
			"hourly": {"time":["2026-11-18T22:00","2026-11-18T23:00","2026-11-19T00:00"],"temperature_2m":[14,13,12],"weather_code":[2,2,1],"precipitation_probability":[10,5,0],"is_day":[0,0,0]},
			"daily": {
				"time":["2026-11-18","2026-11-19","2026-11-20","2026-11-21","2026-11-22"],
				"weather_code":[2,0,1,61,0],
				"temperature_2m_max":[20.5,21.0,19.5,16.0,18.5],
				"temperature_2m_min":[9.0,8.5,9.5,10.0,8.0],
				"precipitation_probability_max":[10,0,5,75,0],
				"uv_index_max":[3.8,4.1,3.5,2.2,4.0],
				"sunrise":["2026-11-18T06:51"],
				"sunset":["2026-11-18T16:54"]
			}
		},
		{
			"utc_offset_seconds": -28800,
			"current": {"time":"2026-11-18T22:00","temperature_2m":12.5,"apparent_temperature":11.0,"relative_humidity_2m":80,"weather_code":45,"wind_speed_10m":16.0,"is_day":0,"cloud_cover":85},
			"hourly": {"time":["2026-11-18T22:00","2026-11-18T23:00"],"temperature_2m":[12.5,12.0],"weather_code":[45,45],"precipitation_probability":[15,15],"is_day":[0,0]},
			"daily": {
				"time":["2026-11-18","2026-11-19"],
				"weather_code":[45,2],
				"temperature_2m_max":[16.0,17.0],
				"temperature_2m_min":[10.0,9.5],
				"precipitation_probability_max":[15,10],
				"uv_index_max":[3.0,3.5],
				"sunrise":["2026-11-18T06:53"],
				"sunset":["2026-11-18T16:55"]
			}
		},
		{
			"utc_offset_seconds": 28800,
			"current": {"time":"2026-11-19T14:00","temperature_2m":18.5,"apparent_temperature":18.0,"relative_humidity_2m":62,"weather_code":61,"wind_speed_10m":14.0,"is_day":1,"cloud_cover":90},
			"hourly": {"time":["2026-11-19T14:00","2026-11-19T15:00"],"temperature_2m":[18.5,18.0],"weather_code":[61,61],"precipitation_probability":[70,65],"is_day":[1,1]},
			"daily": {
				"time":["2026-11-19","2026-11-20"],
				"weather_code":[61,2],
				"temperature_2m_max":[20.0,19.0],
				"temperature_2m_min":[13.5,12.0],
				"precipitation_probability_max":[75,20],
				"uv_index_max":[2.5,4.2],
				"sunrise":["2026-11-19T06:24"],
				"sunset":["2026-11-19T16:55"]
			}
		},
		{
			"utc_offset_seconds": 32400,
			"current": {"time":"2026-11-19T15:00","temperature_2m":16.0,"apparent_temperature":15.5,"relative_humidity_2m":55,"weather_code":1,"wind_speed_10m":11.0,"is_day":1,"cloud_cover":20},
			"hourly": {"time":["2026-11-19T15:00","2026-11-19T16:00"],"temperature_2m":[16.0,15.0],"weather_code":[1,1],"precipitation_probability":[5,5],"is_day":[1,1]},
			"daily": {
				"time":["2026-11-19","2026-11-20"],
				"weather_code":[1,0],
				"temperature_2m_max":[18.0,17.5],
				"temperature_2m_min":[10.5,9.5],
				"precipitation_probability_max":[10,5],
				"uv_index_max":[3.6,3.8],
				"sunrise":["2026-11-19T06:21"],
				"sunset":["2026-11-19T16:31"]
			}
		}
	]`

	mockAir := `[
		{"current":{"us_aqi":28,"uv_index":0.0}},
		{"current":{"us_aqi":34,"uv_index":0.0}},
		{"current":{"us_aqi":72,"uv_index":3.4}},
		{"current":{"us_aqi":24,"uv_index":2.1}}
	]`

	origClient := httpClient
	httpClient = &http.Client{
		Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
			payload := mockForecast
			if strings.Contains(r.URL.String(), "air-quality") {
				payload = mockAir
			}
			return &http.Response{
				StatusCode: http.StatusOK,
				Header:     http.Header{"Content-Type": []string{"application/json"}},
				Body:       io.NopCloser(bytes.NewBufferString(payload)),
			}, nil
		}),
	}
	defer func() { httpClient = origClient }()

	req := httptest.NewRequest(http.MethodGet, "/api/dashboard", nil)
	rec := httptest.NewRecorder()
	Handler(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	var parsed DashboardResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &parsed); err != nil {
		t.Fatalf("invalid json response: %v", err)
	}
	if len(parsed.Weather) != 4 {
		t.Fatalf("expected 4 cities weather, got %d", len(parsed.Weather))
	}
	if len(parsed.Weather[0].Daily) != 5 {
		t.Fatalf("expected 5 daily entries for sunnyvale, got %d", len(parsed.Weather[0].Daily))
	}
	if parsed.Weather[0].USAqi == nil || *parsed.Weather[0].USAqi != 28 {
		t.Fatalf("expected sunnyvale AQI 28, got %+v", parsed.Weather[0].USAqi)
	}
	if parsed.Weather[2].USAqi == nil || *parsed.Weather[2].USAqi != 72 {
		t.Fatalf("expected shanghai AQI 72, got %+v", parsed.Weather[2].USAqi)
	}
	if parsed.Weather[3].CityID != "tokyo" || parsed.Weather[3].USAqi == nil || *parsed.Weather[3].USAqi != 24 {
		t.Fatalf("expected tokyo AQI 24, got %+v", parsed.Weather[3])
	}
}
