package config

import (
	"crypto/sha256"
	_ "embed"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"strings"
)

//go:embed dashboard.config.json
var embeddedConfigJSON []byte

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
	Stocks     StocksConfig    `json:"stocks"`
	Widgets    WidgetsConfig   `json:"widgets"`
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
	if cfg.Refresh.PollMinutes < 1 {
		cfg.Refresh.PollMinutes = 10
	}
	if cfg.NightMode.DimOpacity <= 0 || cfg.NightMode.DimOpacity > 0.9 {
		cfg.NightMode.DimOpacity = 0.55
	}
	if cfg.Widgets.Trips == nil {
		cfg.Widgets.Trips = []TripWidgetItem{}
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

func ComputeVersion(rawConfig []byte) string {
	h := sha256.New()
	h.Write(rawConfig)
	if sha := os.Getenv("VERCEL_GIT_COMMIT_SHA"); sha != "" {
		h.Write([]byte("|"))
		h.Write([]byte(sha))
	}
	return hex.EncodeToString(h.Sum(nil))[:12]
}
