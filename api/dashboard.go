package handler

import (
	"bytes"
	"crypto/sha256"
	_ "embed"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"
)

//go:embed dashboard.config.json
var embeddedConfigJSON []byte

var (
	openMeteoBaseURL   = "https://api.open-meteo.com/v1/forecast"
	openMeteoAirURL    = "https://air-quality-api.open-meteo.com/v1/air-quality"
	httpClient         = &http.Client{Timeout: 8 * time.Second}
)

type HeroConfig struct {
	LockFirstCity bool `json:"lockFirstCity"`
}

type NightModeConfig struct {
	Enabled    bool    `json:"enabled"`
	StartHour  int     `json:"startHour"`
	EndHour    int     `json:"endHour"`
	DimOpacity float64 `json:"dimOpacity"`
}

type RefreshConfig struct {
	PollMinutes     int `json:"pollMinutes"`
	DailyReloadHour int `json:"dailyReloadHour"`
}

type CityConfig struct {
	ID       string  `json:"id"`
	Name     string  `json:"name"`
	Region   string  `json:"region"`
	Lat      float64 `json:"lat"`
	Lon      float64 `json:"lon"`
	Timezone string  `json:"timezone"`
}

type TripWidgetItem struct {
	ID    string `json:"id"`
	Title string `json:"title"`
	Date  string `json:"date"`
	Emoji string `json:"emoji,omitempty"`
}

type CalendarWidgetConfig struct {
	Enabled bool `json:"enabled"`
}

type WidgetsConfig struct {
	Trips    []TripWidgetItem     `json:"trips"`
	Calendar CalendarWidgetConfig `json:"calendar"`
}

type DashboardConfig struct {
	Units      string          `json:"units"`
	TimeFormat string          `json:"timeFormat"`
	Hero       HeroConfig      `json:"hero"`
	NightMode  NightModeConfig `json:"nightMode"`
	Refresh    RefreshConfig   `json:"refresh"`
	Cities     []CityConfig    `json:"cities"`
	Widgets    WidgetsConfig   `json:"widgets"`
}

type HourlyForecast struct {
	Time        string  `json:"time"`
	TempC       float64 `json:"tempC"`
	WeatherCode int     `json:"weatherCode"`
	PrecipProb  int     `json:"precipProb"`
	IsDay       bool    `json:"isDay"`
}

type DailyForecast struct {
	Date          string  `json:"date"`
	WeatherCode   int     `json:"weatherCode"`
	HighC         float64 `json:"highC"`
	LowC          float64 `json:"lowC"`
	PrecipProbMax int     `json:"precipProbMax"`
	UVIndexMax    float64 `json:"uvIndexMax"`
}

type CityWeather struct {
	CityID           string           `json:"cityId"`
	UTCOffsetSeconds int              `json:"utcOffsetSeconds"`
	TempC            float64          `json:"tempC"`
	FeelsLikeC       float64          `json:"feelsLikeC"`
	Humidity         int              `json:"humidity"`
	WindKmh          float64          `json:"windKmh"`
	WeatherCode      int              `json:"weatherCode"`
	IsDay            bool             `json:"isDay"`
	CloudCover       int              `json:"cloudCover"`
	HighC            float64          `json:"highC"`
	LowC             float64          `json:"lowC"`
	Sunrise          string           `json:"sunrise"`
	Sunset           string           `json:"sunset"`
	USAqi            *int             `json:"usAqi"`
	UVIndex          *float64         `json:"uvIndex"`
	Hourly           []HourlyForecast `json:"hourly"`
	Daily            []DailyForecast  `json:"daily"`
}

type DashboardResponse struct {
	Version   string          `json:"version"`
	FetchedAt string          `json:"fetchedAt"`
	Config    DashboardConfig `json:"config"`
	Weather   []CityWeather   `json:"weather"`
}

// Open-Meteo Forecast raw response structures.
type omLocation struct {
	UTCOffsetSeconds int       `json:"utc_offset_seconds"`
	Current          omCurrent `json:"current"`
	Hourly           omHourly  `json:"hourly"`
	Daily            omDaily   `json:"daily"`
}

type omCurrent struct {
	Time                string  `json:"time"`
	Temperature2m       float64 `json:"temperature_2m"`
	ApparentTemperature float64 `json:"apparent_temperature"`
	RelativeHumidity2m  int     `json:"relative_humidity_2m"`
	WeatherCode         int     `json:"weather_code"`
	WindSpeed10m        float64 `json:"wind_speed_10m"`
	IsDay               int     `json:"is_day"`
	CloudCover          int     `json:"cloud_cover"`
}

type omHourly struct {
	Time                     []string  `json:"time"`
	Temperature2m            []float64 `json:"temperature_2m"`
	WeatherCode              []int     `json:"weather_code"`
	PrecipitationProbability []int     `json:"precipitation_probability"`
	IsDay                    []int     `json:"is_day"`
}

type omDaily struct {
	Time                        []string  `json:"time"`
	WeatherCode                 []int     `json:"weather_code"`
	Temperature2mMax            []float64 `json:"temperature_2m_max"`
	Temperature2mMin            []float64 `json:"temperature_2m_min"`
	PrecipitationProbabilityMax []int     `json:"precipitation_probability_max"`
	UVIndexMax                  []float64 `json:"uv_index_max"`
	Sunrise                     []string  `json:"sunrise"`
	Sunset                      []string  `json:"sunset"`
}

// Open-Meteo Air Quality raw response structures.
type omAirLocation struct {
	Current omAirCurrent `json:"current"`
}

type omAirCurrent struct {
	USAqi   *int     `json:"us_aqi"`
	UVIndex *float64 `json:"uv_index"`
}

// Handler serves GET /api/dashboard on Vercel (and locally via cmd/devserver).
func Handler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		writeJSONError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	rawConfig, isDevDisk, err := loadRawConfig()
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, fmt.Sprintf("failed to load config: %v", err))
		return
	}

	cfg, err := parseAndNormalizeConfig(rawConfig)
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, fmt.Sprintf("invalid dashboard config: %v", err))
		return
	}

	weather, err := fetchAllWeather(cfg.Cities)
	if err != nil {
		writeJSONError(w, http.StatusBadGateway, fmt.Sprintf("failed to fetch weather: %v", err))
		return
	}

	resp := DashboardResponse{
		Version:   computeVersion(rawConfig),
		FetchedAt: time.Now().UTC().Format(time.RFC3339),
		Config:    cfg,
		Weather:   weather,
	}

	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	if isDevDisk {
		w.Header().Set("Cache-Control", "no-store")
	} else {
		w.Header().Set("Cache-Control", "public, s-maxage=600, stale-while-revalidate=300")
	}
	w.WriteHeader(http.StatusOK)
	if r.Method == http.MethodHead {
		return
	}
	_ = json.NewEncoder(w).Encode(resp)
}

func loadRawConfig() ([]byte, bool, error) {
	if devPath := strings.TrimSpace(os.Getenv("GLANCE_DEV_CONFIG_PATH")); devPath != "" {
		data, err := os.ReadFile(devPath)
		if err != nil {
			return nil, true, err
		}
		return data, true, nil
	}
	return embeddedConfigJSON, false, nil
}

func parseAndNormalizeConfig(raw []byte) (DashboardConfig, error) {
	var cfg DashboardConfig
	if err := json.Unmarshal(raw, &cfg); err != nil {
		return cfg, err
	}
	if len(cfg.Cities) == 0 {
		return cfg, fmt.Errorf("config must contain at least one city")
	}
	upperUnits := strings.ToUpper(strings.TrimSpace(cfg.Units))
	if upperUnits != "C" && upperUnits != "F" {
		upperUnits = "F"
	}
	cfg.Units = upperUnits

	if cfg.TimeFormat != "24h" {
		cfg.TimeFormat = "12h"
	}
	if cfg.Refresh.PollMinutes < 1 {
		cfg.Refresh.PollMinutes = 10
	}
	if cfg.NightMode.DimOpacity <= 0 || cfg.NightMode.DimOpacity > 0.9 {
		cfg.NightMode.DimOpacity = 0.55
	}
	if cfg.Widgets.Trips == nil {
		cfg.Widgets.Trips = []TripWidgetItem{}
	}
	return cfg, nil
}

func computeVersion(rawConfig []byte) string {
	h := sha256.New()
	h.Write(rawConfig)
	if sha := os.Getenv("VERCEL_GIT_COMMIT_SHA"); sha != "" {
		h.Write([]byte("|"))
		h.Write([]byte(sha))
	}
	return hex.EncodeToString(h.Sum(nil))[:12]
}

func fetchAllWeather(cities []CityConfig) ([]CityWeather, error) {
	lats := make([]string, len(cities))
	lons := make([]string, len(cities))
	for i, c := range cities {
		lats[i] = strconv.FormatFloat(c.Lat, 'f', 4, 64)
		lons[i] = strconv.FormatFloat(c.Lon, 'f', 4, 64)
	}
	latCSV := strings.Join(lats, ",")
	lonCSV := strings.Join(lons, ",")

	var (
		locations []omLocation
		airList   []omAirLocation
		weatherErr error
		wg         sync.WaitGroup
	)

	wg.Add(2)

	// 1. Forecast + 5-day daily
	go func() {
		defer wg.Done()
		params := url.Values{}
		params.Set("latitude", latCSV)
		params.Set("longitude", lonCSV)
		params.Set("timezone", "auto")
		params.Set("current", "temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,is_day,cloud_cover")
		params.Set("hourly", "temperature_2m,weather_code,precipitation_probability,is_day")
		params.Set("daily", "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,uv_index_max,sunrise,sunset")
		params.Set("forecast_days", "5")
		params.Set("temperature_unit", "celsius")
		params.Set("wind_speed_unit", "kmh")

		body, err := httpGetBody(openMeteoBaseURL + "?" + params.Encode())
		if err != nil {
			weatherErr = err
			return
		}
		locations, weatherErr = decodeOpenMeteoResponse(body)
	}()

	// 2. Air Quality + live UV (best-effort; degrades gracefully if unavailable)
	go func() {
		defer wg.Done()
		params := url.Values{}
		params.Set("latitude", latCSV)
		params.Set("longitude", lonCSV)
		params.Set("timezone", "auto")
		params.Set("current", "us_aqi,uv_index")

		body, err := httpGetBody(openMeteoAirURL + "?" + params.Encode())
		if err != nil {
			return
		}
		decoded, err := decodeOpenMeteoAirResponse(body)
		if err == nil {
			airList = decoded
		}
	}()

	wg.Wait()

	if weatherErr != nil {
		return nil, weatherErr
	}
	if len(locations) != len(cities) {
		return nil, fmt.Errorf("expected %d weather entries, got %d", len(cities), len(locations))
	}

	result := make([]CityWeather, len(cities))
	for i, loc := range locations {
		var air *omAirLocation
		if i < len(airList) {
			air = &airList[i]
		}
		result[i] = mapLocationWeather(cities[i].ID, loc, air)
	}
	return result, nil
}

func httpGetBody(reqURL string) ([]byte, error) {
	resp, err := httpClient.Get(reqURL)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("upstream returned status %d", resp.StatusCode)
	}
	return body, nil
}

// decodeOpenMeteoResponse handles both single-location JSON objects and
// multi-location JSON arrays returned by Open-Meteo.
func decodeOpenMeteoResponse(body []byte) ([]omLocation, error) {
	trimmed := bytes.TrimSpace(body)
	if len(trimmed) == 0 {
		return nil, fmt.Errorf("empty response body")
	}
	if trimmed[0] == '[' {
		var list []omLocation
		if err := json.Unmarshal(trimmed, &list); err != nil {
			return nil, err
		}
		return list, nil
	}
	var single omLocation
	if err := json.Unmarshal(trimmed, &single); err != nil {
		return nil, err
	}
	return []omLocation{single}, nil
}

func decodeOpenMeteoAirResponse(body []byte) ([]omAirLocation, error) {
	trimmed := bytes.TrimSpace(body)
	if len(trimmed) == 0 {
		return nil, fmt.Errorf("empty air quality body")
	}
	if trimmed[0] == '[' {
		var list []omAirLocation
		if err := json.Unmarshal(trimmed, &list); err != nil {
			return nil, err
		}
		return list, nil
	}
	var single omAirLocation
	if err := json.Unmarshal(trimmed, &single); err != nil {
		return nil, err
	}
	return []omAirLocation{single}, nil
}

func mapLocationWeather(cityID string, loc omLocation, air *omAirLocation) CityWeather {
	var highC, lowC float64
	if len(loc.Daily.Temperature2mMax) > 0 {
		highC = loc.Daily.Temperature2mMax[0]
	}
	if len(loc.Daily.Temperature2mMin) > 0 {
		lowC = loc.Daily.Temperature2mMin[0]
	}

	sunrise := "06:30"
	if len(loc.Daily.Sunrise) > 0 {
		sunrise = extractClockHHMM(loc.Daily.Sunrise[0], sunrise)
	}
	sunset := "18:30"
	if len(loc.Daily.Sunset) > 0 {
		sunset = extractClockHHMM(loc.Daily.Sunset[0], sunset)
	}

	var usAqi *int
	var uvIndex *float64
	if air != nil {
		usAqi = air.Current.USAqi
		uvIndex = air.Current.UVIndex
	}

	return CityWeather{
		CityID:           cityID,
		UTCOffsetSeconds: loc.UTCOffsetSeconds,
		TempC:            loc.Current.Temperature2m,
		FeelsLikeC:       loc.Current.ApparentTemperature,
		Humidity:         loc.Current.RelativeHumidity2m,
		WindKmh:          loc.Current.WindSpeed10m,
		WeatherCode:      loc.Current.WeatherCode,
		IsDay:            loc.Current.IsDay == 1,
		CloudCover:       loc.Current.CloudCover,
		HighC:            highC,
		LowC:             lowC,
		Sunrise:          sunrise,
		Sunset:           sunset,
		USAqi:            usAqi,
		UVIndex:          uvIndex,
		Hourly:           extractNextHours(loc.Current.Time, loc.Hourly, 8),
		Daily:            extractDailyForecast(loc.Daily, 5),
	}
}

func extractClockHHMM(iso string, fallback string) string {
	idx := strings.IndexByte(iso, 'T')
	if idx == -1 || idx+6 > len(iso) {
		return fallback
	}
	return iso[idx+1 : idx+6]
}

func extractDailyForecast(daily omDaily, limit int) []DailyForecast {
	n := len(daily.Time)
	if n == 0 || limit <= 0 {
		return []DailyForecast{}
	}
	if n > limit {
		n = limit
	}
	out := make([]DailyForecast, 0, n)
	for i := 0; i < n; i++ {
		var code int
		if i < len(daily.WeatherCode) {
			code = daily.WeatherCode[i]
		}
		var highC, lowC float64
		if i < len(daily.Temperature2mMax) {
			highC = daily.Temperature2mMax[i]
		}
		if i < len(daily.Temperature2mMin) {
			lowC = daily.Temperature2mMin[i]
		}
		var precip int
		if i < len(daily.PrecipitationProbabilityMax) {
			precip = daily.PrecipitationProbabilityMax[i]
		}
		var uv float64
		if i < len(daily.UVIndexMax) {
			uv = daily.UVIndexMax[i]
		}
		out = append(out, DailyForecast{
			Date:          daily.Time[i],
			WeatherCode:   code,
			HighC:         highC,
			LowC:          lowC,
			PrecipProbMax: precip,
			UVIndexMax:    uv,
		})
	}
	return out
}

// extractNextHours returns up to `limit` hourly entries strictly after the current hour.
func extractNextHours(currentISO string, hourly omHourly, limit int) []HourlyForecast {
	n := len(hourly.Time)
	if n == 0 || limit <= 0 {
		return []HourlyForecast{}
	}

	// Open-Meteo local timestamps are lexicographically sortable ("YYYY-MM-DDTHH:MM").
	startIdx := 0
	if len(currentISO) >= 13 {
		currentHourPrefix := currentISO[:13] + ":00"
		for i, t := range hourly.Time {
			if t > currentHourPrefix {
				startIdx = i
				break
			}
		}
	}

	out := make([]HourlyForecast, 0, limit)
	for i := startIdx; i < n && len(out) < limit; i++ {
		var tempC float64
		if i < len(hourly.Temperature2m) {
			tempC = hourly.Temperature2m[i]
		}
		var code int
		if i < len(hourly.WeatherCode) {
			code = hourly.WeatherCode[i]
		}
		var precip int
		if i < len(hourly.PrecipitationProbability) {
			precip = hourly.PrecipitationProbability[i]
		}
		isDay := true
		if i < len(hourly.IsDay) {
			isDay = hourly.IsDay[i] == 1
		}

		out = append(out, HourlyForecast{
			Time:        hourly.Time[i],
			TempC:       tempC,
			WeatherCode: code,
			PrecipProb:  precip,
			IsDay:       isDay,
		})
	}
	return out
}

func writeJSONError(w http.ResponseWriter, status int, message string) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]string{
		"error": message,
	})
}
