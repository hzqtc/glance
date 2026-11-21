package main

import (
	"log"
	"net/http"
	"os"

	handler "glance/api"
)

func main() {
	if os.Getenv("GLANCE_DEV_CONFIG_PATH") == "" {
		_ = os.Setenv("GLANCE_DEV_CONFIG_PATH", "config/dashboard.config.json")
	}

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/api/weather", handler.WeatherHandler)
	mux.HandleFunc("/api/stocks", handler.StocksHandler)

	addr := "127.0.0.1:" + port
	log.Printf("Glance Go dev API listening on http://%s (/api/weather, /api/stocks)", addr)
	if err := http.ListenAndServe(addr, mux); err != nil {
		log.Fatal(err)
	}
}
