package config

import (
	"crypto/sha256"
	_ "embed"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"sync"
)

//go:embed dashboard.config.json
var embeddedConfigJSON []byte

var (
	embeddedOnce    sync.Once
	embeddedCfg     DashboardConfig
	embeddedVersion string
	embeddedErr     error
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

type CarouselScheduleStep struct {
	Slide   string `json:"slide"`
	Seconds int    `json:"seconds"`
}

type CarouselConfig struct {
	AutoRotate         bool                   `json:"autoRotate"`
	IntervalSeconds    int                    `json:"intervalSeconds"`
	ManualPauseSeconds int                    `json:"manualPauseSeconds"`
	Schedule           []CarouselScheduleStep `json:"schedule,omitempty"`
}

type PhotosConfig struct {
	SlideIntervalSeconds int `json:"slideIntervalSeconds"`
}

type FXPairConfig struct {
	Symbol string `json:"symbol"`
	Base   string `json:"base"`
	Quote  string `json:"quote"`
	Label  string `json:"label"`
}

type WorldConfig struct {
	FXPairs []FXPairConfig `json:"fxPairs"`
}

type CityConfig struct {
	ID       string  `json:"id"`
	Name     string  `json:"name"`
	Region   string  `json:"region"`
	Lat      float64 `json:"lat"`
	Lon      float64 `json:"lon"`
	Timezone string  `json:"timezone"`
}

type StockSymbolConfig struct {
	Symbol string `json:"symbol"`
	Label  string `json:"label"`
	Name   string `json:"name"`
	Format string `json:"format"` // "currency" | "points" | "yield"
}

type StocksConfig struct {
	DefaultRange string              `json:"defaultRange"`
	Symbols      []StockSymbolConfig `json:"symbols"`
}

type DashboardConfig struct {
	Units            string          `json:"units"`
	TimeFormat       string          `json:"timeFormat"`
	IdleResetSeconds int             `json:"idleResetSeconds"`
	Hero             HeroConfig      `json:"hero"`
	NightMode  NightModeConfig `json:"nightMode"`
	Refresh    RefreshConfig   `json:"refresh"`
	Carousel   CarouselConfig  `json:"carousel"`
	Photos     PhotosConfig    `json:"photos"`
	World      WorldConfig     `json:"world"`
	Cities     []CityConfig    `json:"cities"`
	Stocks     StocksConfig    `json:"stocks"`
}

func LoadRawConfig() ([]byte, bool, error) {
	if devPath := strings.TrimSpace(os.Getenv("GLANCE_DEV_CONFIG_PATH")); devPath != "" {
		data, err := os.ReadFile(devPath)
		if err != nil {
			return nil, true, err
		}
		return data, true, nil
	}
	return embeddedConfigJSON, false, nil
}

// LoadNormalizedConfig returns the normalized dashboard config and version hash,
// caching the immutable embedded production config while hot-reloading disk dev configs.
func LoadNormalizedConfig() (DashboardConfig, string, bool, error) {
	if devPath := strings.TrimSpace(os.Getenv("GLANCE_DEV_CONFIG_PATH")); devPath != "" {
		raw, err := os.ReadFile(devPath)
		if err != nil {
			return DashboardConfig{}, "", true, err
		}
		cfg, err := ParseAndNormalizeConfig(raw)
		if err != nil {
			return DashboardConfig{}, "", true, err
		}
		return cfg, ComputeVersion(raw), true, nil
	}
	embeddedOnce.Do(func() {
		embeddedCfg, embeddedErr = ParseAndNormalizeConfig(embeddedConfigJSON)
		if embeddedErr == nil {
			embeddedVersion = ComputeVersion(embeddedConfigJSON)
		}
	})
	return embeddedCfg, embeddedVersion, false, embeddedErr
}

func ParseAndNormalizeConfig(raw []byte) (DashboardConfig, error) {
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
	if cfg.IdleResetSeconds < 5 {
		cfg.IdleResetSeconds = 60
	}
	if cfg.Refresh.PollMinutes < 1 {
		cfg.Refresh.PollMinutes = 10
	}
	if cfg.Carousel.IntervalSeconds < 5 {
		cfg.Carousel.IntervalSeconds = 15
	}
	if cfg.Carousel.ManualPauseSeconds < 0 {
		cfg.Carousel.ManualPauseSeconds = 300
	}
	cfg.Carousel.Schedule = normalizeCarouselSchedule(cfg.Carousel.Schedule, cfg.Carousel.IntervalSeconds)
	if cfg.Photos.SlideIntervalSeconds < 3 {
		cfg.Photos.SlideIntervalSeconds = 15
	}
	cfg.World.FXPairs = normalizeFXPairs(cfg.World.FXPairs)
	if cfg.NightMode.DimOpacity <= 0 || cfg.NightMode.DimOpacity > 0.9 {
		cfg.NightMode.DimOpacity = 0.55
	}
	if strings.TrimSpace(cfg.Stocks.DefaultRange) == "" {
		cfg.Stocks.DefaultRange = "1d"
	}
	for i := range cfg.Stocks.Symbols {
		if strings.TrimSpace(cfg.Stocks.Symbols[i].Label) == "" {
			cfg.Stocks.Symbols[i].Label = cfg.Stocks.Symbols[i].Symbol
		}
		if cfg.Stocks.Symbols[i].Format == "" {
			cfg.Stocks.Symbols[i].Format = "currency"
		}
	}
	return cfg, nil
}

func normalizeCarouselSchedule(raw []CarouselScheduleStep, fallbackSeconds int) []CarouselScheduleStep {
	normalized := make([]CarouselScheduleStep, 0, len(raw))
	for _, step := range raw {
		slide := normalizeCarouselSlideName(step.Slide)
		if slide == "" {
			continue
		}
		sec := step.Seconds
		if sec < 5 {
			sec = fallbackSeconds
		}
		normalized = append(normalized, CarouselScheduleStep{
			Slide:   slide,
			Seconds: sec,
		})
	}
	if len(normalized) == 0 {
		return []CarouselScheduleStep{
			{Slide: "photos", Seconds: 60},
			{Slide: "weather", Seconds: 15},
			{Slide: "photos", Seconds: 60},
			{Slide: "stocks", Seconds: 15},
			{Slide: "photos", Seconds: 60},
			{Slide: "calendar", Seconds: 15},
			{Slide: "photos", Seconds: 60},
			{Slide: "world", Seconds: 15},
		}
	}
	return normalized
}

func normalizeCarouselSlideName(raw string) string {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "weather":
		return "weather"
	case "stock", "stocks":
		return "stocks"
	case "calendar":
		return "calendar"
	case "photo", "photos":
		return "photos"
	case "world", "map":
		return "world"
	default:
		return ""
	}
}

func normalizeFXPairs(raw []FXPairConfig) []FXPairConfig {
	out := make([]FXPairConfig, 0, len(raw))
	for _, p := range raw {
		sym := strings.TrimSpace(p.Symbol)
		if sym == "" {
			continue
		}
		base := strings.ToUpper(strings.TrimSpace(p.Base))
		quote := strings.ToUpper(strings.TrimSpace(p.Quote))
		label := strings.TrimSpace(p.Label)
		if base == "" {
			base = "USD"
		}
		if quote == "" {
			quote = strings.TrimSuffix(strings.ToUpper(sym), "=X")
		}
		if label == "" {
			label = base + " / " + quote
		}
		out = append(out, FXPairConfig{
			Symbol: sym,
			Base:   base,
			Quote:  quote,
			Label:  label,
		})
	}
	if len(out) == 0 {
		return []FXPairConfig{
			{Symbol: "CNY=X", Base: "USD", Quote: "CNY", Label: "USD / CNY"},
			{Symbol: "JPY=X", Base: "USD", Quote: "JPY", Label: "USD / JPY"},
			{Symbol: "EUR=X", Base: "USD", Quote: "EUR", Label: "USD / EUR"},
		}
	}
	return out
}

func ComputeVersion(rawConfig []byte) string {
	h := sha256.New()
	h.Write(rawConfig)
	if sha := os.Getenv("VERCEL_GIT_COMMIT_SHA"); sha != "" {
		h.Write([]byte("|"))
		h.Write([]byte(sha))
	}
	return hex.EncodeToString(h.Sum(nil))[:12]
}
