package config

import "testing"

func TestParseAndNormalizeCarouselSchedule(t *testing.T) {
	// Embedded default config should carry the configured photo/dashboard schedule
	raw, _, err := LoadRawConfig()
	if err != nil {
		t.Fatalf("LoadRawConfig failed: %v", err)
	}
	cfg, err := ParseAndNormalizeConfig(raw)
	if err != nil {
		t.Fatalf("ParseAndNormalizeConfig failed: %v", err)
	}

	want := []CarouselScheduleStep{
		{Slide: "photos", Seconds: 60},
		{Slide: "weather", Seconds: 15},
		{Slide: "photos", Seconds: 60},
		{Slide: "stocks", Seconds: 15},
		{Slide: "photos", Seconds: 60},
		{Slide: "calendar", Seconds: 15},
		{Slide: "photos", Seconds: 60},
		{Slide: "world", Seconds: 15},
	}
	if len(cfg.Carousel.Schedule) != len(want) {
		t.Fatalf("expected %d schedule steps, got %d: %+v", len(want), len(cfg.Carousel.Schedule), cfg.Carousel.Schedule)
	}
	for i := range want {
		if cfg.Carousel.Schedule[i] != want[i] {
			t.Fatalf("step %d: got %+v, want %+v", i, cfg.Carousel.Schedule[i], want[i])
		}
	}
	if len(cfg.World.FXPairs) != 6 ||
		cfg.World.FXPairs[0].Symbol != "CNY=X" ||
		cfg.World.FXPairs[1].Symbol != "JPY=X" ||
		cfg.World.FXPairs[2].Symbol != "EUR=X" ||
		cfg.World.FXPairs[3].Symbol != "GBP=X" ||
		cfg.World.FXPairs[4].Symbol != "AUD=X" ||
		cfg.World.FXPairs[5].Symbol != "SGD=X" {
		t.Fatalf("unexpected default world FX pairs: %+v", cfg.World.FXPairs)
	}
	if cfg.Photos.SlideIntervalSeconds != 15 {
		t.Fatalf("expected default photos slideIntervalSeconds 15, got %d", cfg.Photos.SlideIntervalSeconds)
	}
	if cfg.IdleResetSeconds != 60 {
		t.Fatalf("expected default idleResetSeconds 60, got %d", cfg.IdleResetSeconds)
	}
	if !cfg.NightMode.Enabled || cfg.NightMode.StartHour != 23 || cfg.NightMode.EndHour != 7 || cfg.NightMode.DimOpacity <= 0 {
		t.Fatalf("unexpected default nightMode config: %+v", cfg.NightMode)
	}

	// Aliases ("photo", "stock"), custom durations, and invalid slide filtering
	customJSON := []byte(`{
		"idleResetSeconds": 90,
		"cities": [{"id":"c1","name":"Test","region":"CA","lat":37,"lon":-122,"timezone":"America/Los_Angeles"}],
		"carousel": {
			"autoRotate": true,
			"intervalSeconds": 20,
			"manualPauseSeconds": 180,
			"schedule": [
				{"slide": "photo", "seconds": 45},
				{"slide": "stock", "seconds": 12},
				{"slide": "unknown", "seconds": 10},
				{"slide": "weather", "seconds": 2}
			]
		},
		"photos": {
			"slideIntervalSeconds": 25
		}
	}`)
	customCfg, err := ParseAndNormalizeConfig(customJSON)
	if err != nil {
		t.Fatalf("custom ParseAndNormalizeConfig failed: %v", err)
	}
	wantCustom := []CarouselScheduleStep{
		{Slide: "photos", Seconds: 45},
		{Slide: "stocks", Seconds: 12},
		{Slide: "weather", Seconds: 20},
	}
	if len(customCfg.Carousel.Schedule) != len(wantCustom) {
		t.Fatalf("expected %d custom steps, got %+v", len(wantCustom), customCfg.Carousel.Schedule)
	}
	for i := range wantCustom {
		if customCfg.Carousel.Schedule[i] != wantCustom[i] {
			t.Fatalf("custom step %d: got %+v, want %+v", i, customCfg.Carousel.Schedule[i], wantCustom[i])
		}
	}
	if customCfg.Photos.SlideIntervalSeconds != 25 {
		t.Fatalf("expected custom photos slideIntervalSeconds 25, got %d", customCfg.Photos.SlideIntervalSeconds)
	}
	if customCfg.IdleResetSeconds != 90 {
		t.Fatalf("expected custom idleResetSeconds 90, got %d", customCfg.IdleResetSeconds)
	}
}
