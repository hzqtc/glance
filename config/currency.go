package config

import "strings"

// timezoneCurrency maps IANA timezones to the ISO 4217 currency used there.
// Cities whose timezone is missing here simply get no FX card.
var timezoneCurrency = map[string]string{
	// United States
	"America/New_York":    "USD",
	"America/Chicago":     "USD",
	"America/Denver":      "USD",
	"America/Phoenix":     "USD",
	"America/Los_Angeles": "USD",
	"America/Anchorage":   "USD",
	"America/Detroit":     "USD",
	"America/Boise":       "USD",
	"Pacific/Honolulu":    "USD",
	"America/Puerto_Rico": "USD",

	// Rest of the Americas
	"America/Toronto":                "CAD",
	"America/Vancouver":              "CAD",
	"America/Edmonton":               "CAD",
	"America/Winnipeg":               "CAD",
	"America/Halifax":                "CAD",
	"America/St_Johns":               "CAD",
	"America/Mexico_City":            "MXN",
	"America/Cancun":                 "MXN",
	"America/Tijuana":                "MXN",
	"America/Sao_Paulo":              "BRL",
	"America/Argentina/Buenos_Aires": "ARS",
	"America/Santiago":               "CLP",
	"America/Bogota":                 "COP",
	"America/Lima":                   "PEN",
	"America/Panama":                 "USD",

	// Eurozone
	"Europe/Paris":      "EUR",
	"Europe/Berlin":     "EUR",
	"Europe/Madrid":     "EUR",
	"Europe/Rome":       "EUR",
	"Europe/Amsterdam":  "EUR",
	"Europe/Brussels":   "EUR",
	"Europe/Vienna":     "EUR",
	"Europe/Dublin":     "EUR",
	"Europe/Lisbon":     "EUR",
	"Europe/Helsinki":   "EUR",
	"Europe/Athens":     "EUR",
	"Europe/Luxembourg": "EUR",
	"Europe/Monaco":     "EUR",
	"Europe/Tallinn":    "EUR",
	"Europe/Riga":       "EUR",
	"Europe/Vilnius":    "EUR",
	"Europe/Bratislava": "EUR",
	"Europe/Ljubljana":  "EUR",
	"Europe/Zagreb":     "EUR",
	"Europe/Malta":      "EUR",
	"Asia/Nicosia":      "EUR",

	// Rest of Europe
	"Europe/London":      "GBP",
	"Europe/Zurich":      "CHF",
	"Europe/Stockholm":   "SEK",
	"Europe/Oslo":        "NOK",
	"Europe/Copenhagen":  "DKK",
	"Europe/Warsaw":      "PLN",
	"Europe/Prague":      "CZK",
	"Europe/Budapest":    "HUF",
	"Europe/Bucharest":   "RON",
	"Europe/Istanbul":    "TRY",
	"Atlantic/Reykjavik": "ISK",

	// Asia
	"Asia/Shanghai":     "CNY",
	"Asia/Chongqing":    "CNY",
	"Asia/Urumqi":       "CNY",
	"Asia/Hong_Kong":    "HKD",
	"Asia/Macau":        "MOP",
	"Asia/Taipei":       "TWD",
	"Asia/Tokyo":        "JPY",
	"Asia/Seoul":        "KRW",
	"Asia/Singapore":    "SGD",
	"Asia/Kuala_Lumpur": "MYR",
	"Asia/Bangkok":      "THB",
	"Asia/Jakarta":      "IDR",
	"Asia/Manila":       "PHP",
	"Asia/Ho_Chi_Minh":  "VND",
	"Asia/Saigon":       "VND",
	"Asia/Kolkata":      "INR",
	"Asia/Calcutta":     "INR",
	"Asia/Dubai":        "AED",
	"Asia/Riyadh":       "SAR",
	"Asia/Qatar":        "QAR",
	"Asia/Jerusalem":    "ILS",
	"Asia/Tel_Aviv":     "ILS",

	// Oceania
	"Australia/Sydney":    "AUD",
	"Australia/Melbourne": "AUD",
	"Australia/Brisbane":  "AUD",
	"Australia/Perth":     "AUD",
	"Australia/Adelaide":  "AUD",
	"Australia/Hobart":    "AUD",
	"Australia/Darwin":    "AUD",
	"Pacific/Auckland":    "NZD",

	// Africa
	"Africa/Johannesburg": "ZAR",
	"Africa/Cairo":        "EGP",
	"Africa/Lagos":        "NGN",
	"Africa/Nairobi":      "KES",
	"Africa/Casablanca":   "MAD",
}

// CurrencyForTimezone returns the ISO 4217 currency for an IANA timezone, or "".
func CurrencyForTimezone(tz string) string {
	return timezoneCurrency[strings.TrimSpace(tz)]
}

// deriveFXPairs builds one FX pair per distinct non-home currency among the
// configured cities, in city order. The first (Home) city's currency is the
// base; Yahoo Finance quotes USD-based pairs as "JPY=X" and crosses as "EURJPY=X".
func deriveFXPairs(cities []CityConfig) []FXPairConfig {
	if len(cities) == 0 {
		return []FXPairConfig{}
	}
	base := CurrencyForTimezone(cities[0].Timezone)
	if base == "" {
		return []FXPairConfig{}
	}

	seen := map[string]bool{base: true}
	pairs := []FXPairConfig{}
	for _, c := range cities[1:] {
		quote := CurrencyForTimezone(c.Timezone)
		if quote == "" || seen[quote] {
			continue
		}
		seen[quote] = true
		symbol := quote + "=X"
		if base != "USD" {
			symbol = base + quote + "=X"
		}
		pairs = append(pairs, FXPairConfig{
			Symbol: symbol,
			Base:   base,
			Quote:  quote,
			Label:  base + " / " + quote,
		})
	}
	return pairs
}
