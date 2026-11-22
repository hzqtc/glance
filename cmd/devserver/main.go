package main

import (
	"bufio"
	"log"
	"net/http"
	"os"
	"strings"

	handler "glance/api"
)

// loadDotEnv loads simple KEY=VALUE lines from a local file without overriding existing env vars.
func loadDotEnv(path string) {
	f, err := os.Open(path)
	if err != nil {
		return
	}
	defer f.Close()

	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		eq := strings.IndexByte(line, '=')
		if eq <= 0 {
			continue
		}
		key := strings.TrimSpace(line[:eq])
		val := strings.TrimSpace(line[eq+1:])
		if len(val) >= 2 && ((val[0] == '"' && val[len(val)-1] == '"') || (val[0] == '\'' && val[len(val)-1] == '\'')) {
			val = val[1 : len(val)-1]
		}
		if key != "" && os.Getenv(key) == "" {
			_ = os.Setenv(key, val)
		}
	}
}

func main() {
	loadDotEnv(".env.local")
	loadDotEnv(".env")

	if os.Getenv("GLANCE_DEV_CONFIG_PATH") == "" {
		_ = os.Setenv("GLANCE_DEV_CONFIG_PATH", "config/dashboard.config.json")
	}

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/api/auth", handler.AuthHandler)
	mux.HandleFunc("/api/weather", handler.WeatherHandler)
	mux.HandleFunc("/api/stocks", handler.StocksHandler)
	mux.HandleFunc("/api/calendar", handler.CalendarHandler)
	mux.HandleFunc("/api/photos", handler.PhotosHandler)
	mux.HandleFunc("/api/world", handler.WorldHandler)

	addr := "127.0.0.1:" + port
	log.Printf("Glance Go dev API listening on http://%s (/api/auth, /api/weather, /api/stocks, /api/calendar, /api/photos, /api/world)", addr)
	if err := http.ListenAndServe(addr, mux); err != nil {
		log.Fatal(err)
	}
}
