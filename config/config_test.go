package config

import "testing"

func TestParseAndNormalizeCarouselSchedule(t *testing.T) {
	// Embedded default config should carry the configured photo/dashboard schedule
	cfg, err := ParseAndNormalizeConfig(embeddedConfigJSON)
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
		{Slide: "photos", Seconds: 60},
		{Slide: "news", Seconds: 30},
	}
	if len(cfg.Carousel.Schedule) != len(want) {
		t.Fatalf("expected %d schedule steps, got %d: %+v", len(want), len(cfg.Carousel.Schedule), cfg.Carousel.Schedule)
	}
	for i := range want {
		if cfg.Carousel.Schedule[i] != want[i] {
			t.Fatalf("step %d: got %+v, want %+v", i, cfg.Carousel.Schedule[i], want[i])
		}
	}
	// FX pairs are derived from the embedded cities (Home = Sunnyvale, USD)
	wantSyms := []string{"EUR=X", "CNY=X", "JPY=X", "GBP=X", "SGD=X", "AUD=X"}
	if len(cfg.World.FXPairs) != len(wantSyms) {
		t.Fatalf("unexpected derived world FX pairs: %+v", cfg.World.FXPairs)
	}
	for i, sym := range wantSyms {
		if cfg.World.FXPairs[i].Symbol != sym || cfg.World.FXPairs[i].Base != "USD" {
			t.Fatalf("derived FX pair %d: got %+v, want %s", i, cfg.World.FXPairs[i], sym)
		}
	}
	if cfg.Ambient.Enabled == nil || !*cfg.Ambient.Enabled || cfg.Ambient.ResumeAfterSeconds != 60 {
		t.Fatalf("unexpected ambient config: %+v", cfg.Ambient)
	}
	if cfg.Photos.SlideIntervalSeconds != 15 {
		t.Fatalf("expected default photos slideIntervalSeconds 15, got %d", cfg.Photos.SlideIntervalSeconds)
	}
	if cfg.IdleResetSeconds != 60 {
		t.Fatalf("expected default idleResetSeconds 60, got %d", cfg.IdleResetSeconds)
	}
	if !cfg.NightMode.Enabled || cfg.NightMode.StartHour != 22 || cfg.NightMode.EndHour != 7 || cfg.NightMode.DimOpacity <= 0 {
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
	// Omitted ambient section: enabled with the 60s default
	if customCfg.Ambient.Enabled == nil || !*customCfg.Ambient.Enabled || customCfg.Ambient.ResumeAfterSeconds != 60 {
		t.Fatalf("expected ambient defaults when omitted, got %+v", customCfg.Ambient)
	}
	offCfg, err := ParseAndNormalizeConfig([]byte(`{"cities":[{"id":"a","name":"A","timezone":"UTC"}],"ambient":{"enabled":false,"resumeAfterSeconds":120}}`))
	if err != nil || *offCfg.Ambient.Enabled || offCfg.Ambient.ResumeAfterSeconds != 120 {
		t.Fatalf("expected ambient disabled with 120s, got %+v %v", offCfg.Ambient, err)
	}
	if customCfg.IdleResetSeconds != 90 {
		t.Fatalf("expected custom idleResetSeconds 90, got %d", customCfg.IdleResetSeconds)
	}
}

func city(id, tz string) CityConfig {
	return CityConfig{ID: id, Name: id, Timezone: tz}
}

func TestDeriveFXPairsFromCities(t *testing.T) {
	// Dedupes currencies, skips the home currency and unknown zones, keeps city order
	pairs := deriveFXPairs([]CityConfig{
		city("sunnyvale", "America/Los_Angeles"),
		city("nyc", "America/New_York"),
		city("tokyo", "Asia/Tokyo"),
		city("paris", "Europe/Paris"),
		city("berlin", "Europe/Berlin"),
		city("nowhere", "Antarctica/Troll"),
		city("zurich", "Europe/Zurich"),
	})
	want := []FXPairConfig{
		{Symbol: "JPY=X", Base: "USD", Quote: "JPY", Label: "USD / JPY"},
		{Symbol: "EUR=X", Base: "USD", Quote: "EUR", Label: "USD / EUR"},
		{Symbol: "CHF=X", Base: "USD", Quote: "CHF", Label: "USD / CHF"},
	}
	if len(pairs) != len(want) {
		t.Fatalf("got %+v, want %+v", pairs, want)
	}
	for i := range want {
		if pairs[i] != want[i] {
			t.Fatalf("pair %d: got %+v, want %+v", i, pairs[i], want[i])
		}
	}

	// Non-USD home uses Yahoo cross symbols
	cross := deriveFXPairs([]CityConfig{city("london", "Europe/London"), city("tokyo", "Asia/Tokyo"), city("sf", "America/Los_Angeles")})
	if len(cross) != 2 || cross[0].Symbol != "GBPJPY=X" || cross[1].Symbol != "GBPUSD=X" || cross[1].Label != "GBP / USD" {
		t.Fatalf("unexpected cross pairs: %+v", cross)
	}

	// Unknown home timezone or a single city yields no pairs
	if got := deriveFXPairs([]CityConfig{city("x", "Antarctica/Troll"), city("tokyo", "Asia/Tokyo")}); len(got) != 0 {
		t.Fatalf("expected no pairs for unknown home zone, got %+v", got)
	}
	if got := deriveFXPairs([]CityConfig{city("tokyo", "Asia/Tokyo")}); len(got) != 0 {
		t.Fatalf("expected no pairs for a single city, got %+v", got)
	}
}

func TestExplicitFXPairsOverrideDerivation(t *testing.T) {
	cfg, err := ParseAndNormalizeConfig([]byte(`{
		"cities": [
			{"id":"a","name":"A","timezone":"America/Los_Angeles"},
			{"id":"b","name":"B","timezone":"Asia/Tokyo"}
		],
		"world": {"fxPairs": [{"symbol": "KRW=X"}]}
	}`))
	if err != nil {
		t.Fatalf("ParseAndNormalizeConfig failed: %v", err)
	}
	if len(cfg.World.FXPairs) != 1 || cfg.World.FXPairs[0].Quote != "KRW" || cfg.World.FXPairs[0].Label != "USD / KRW" {
		t.Fatalf("expected explicit fxPairs to win, got %+v", cfg.World.FXPairs)
	}
}
