# Glance

An ambient personal wall dashboard PWA designed for an **iPad mini 2 (iOS 12.5.7, Landscape 1024×768)** — and modern iPads/desktops — hosted serverless on **Vercel** with a stdlib-only **Go** API backend.

## Features

- **Atmospheric Sky & Real Moon Phase:** Solar-elevation-driven sky canvas (dawn, day, sunset, twilight, night) paired with a crisp Retina vector SVG Moon showing tonight's actual astronomical phase, drifting clouds, twinkling stars, shooting stars, wind ribbons, rain, snow, fog, and storm flashes (celestial bodies hide automatically during overcast/precipitation).
- **Adaptive Day / Twilight / Night Themes:** Light frosted-white borderless cards with crisp slate typography during daytime, warm twilight glass at sunrise/sunset, and lifted slate-blue frosted cards at night.
- **Tappable Multi-City View (All Cities Visible Simultaneously):**
  - **Top Hero & 8-Hour Forecast:** Large room-readable clock, temperature, weather metrics, subtle heads-up pills (imminent rain ≥60% or US AQI ≥101), and an 8-hour forecast ribbon.
  - **5-Day Forecast + Air & Daylight:** 5-day outlook with proportional Low→High temperature range bars alongside live US AQI, UV Index, Sunrise/Sunset, daylight duration, and countdown.
  - **Bottom City Row:** Displays all configured cities on a single landscape row (**Sunnyvale**, **San Francisco**, **Shanghai**, **Tokyo** by default) with live clocks, relative hour offsets (`HOME`, `SAME`, `+16h`, `+17h`), `+1d` day badges, and Feels Like / Wind / Humidity / AQI stats. Tap any city card to switch the top two rows and living sky to that location.
- **Minimalist Top-Center Controls:**
  - **Motion / Static icon toggle:** Switch between animated sky and 0-FPS static sky (saved per-device in `localStorage` so older iPad mini 2 hardware stays cool 24/7 while newer devices stay animated).
  - **°F / °C toggle:** Instant temperature & wind unit switching.
  - **Hard Refresh button:** Clears cached weather, unregisters Service Workers, purges Cache Storage, and performs a cache-busted full reload (ideal for Home Screen PWA mode).
- **Built for 24/7 iPad mini 2 (iOS 12) Stability:**
  - Preact + Vite with a classic ES5 Safari 12 production bundle (~22.5 KB gzipped) and zero `<script type="module">` traps.
  - Minute-aligned clock updates, auto night-dimming (`11 PM – 7 AM`), offline `localStorage`/Service Worker resilience, zero-touch auto-reload on new Vercel deployments, and a silent daily 3:30 AM reload.
  - Full iOS PWA assets (`152×152`, `167×167`, `180×180` Apple touch icons and `2048×1536` landscape launch splash screen).

## Configuration

Edit [`dashboard.config.json`](./dashboard.config.json) to customize units (`"F"` or `"C"`), clock format (`"12h"` or `"24h"`), night dimming hours, cities, and future trip countdowns:

```json
{
  "units": "F",
  "timeFormat": "12h",
  "nightMode": { "enabled": true, "startHour": 23, "endHour": 7, "dimOpacity": 0.55 },
  "cities": [
    { "id": "sunnyvale", "name": "Sunnyvale", "region": "CA", "lat": 37.3688, "lon": -122.0363, "timezone": "America/Los_Angeles" },
    { "id": "san-francisco", "name": "San Francisco", "region": "CA", "lat": 37.7749, "lon": -122.4194, "timezone": "America/Los_Angeles" },
    { "id": "shanghai", "name": "Shanghai", "region": "China", "lat": 31.2304, "lon": 121.4737, "timezone": "Asia/Shanghai" },
    { "id": "tokyo", "name": "Tokyo", "region": "Japan", "lat": 35.6762, "lon": 139.6503, "timezone": "Asia/Tokyo" }
  ]
}
```

## Architecture

- **Frontend (`src/`):** Preact + TypeScript + CSS custom properties (Safari 12-safe) + 2D `<canvas>` backdrop & vector SVG Moon.
- **Serverless API (`api/dashboard.go`):** Stdlib-only Go `func Handler(w http.ResponseWriter, r *http.Request)` automatically exposed at `/api/dashboard` on Vercel. Embeds `dashboard.config.json` via [`embed.go`](./embed.go), batches Open-Meteo Forecast (5-day + hourly) and Air Quality (US AQI + UV) concurrently, and sets Edge cache headers (`s-maxage=600`).
- **Local Dev Server (`cmd/devserver/main.go`):** Mounts the exact same Go handler on `127.0.0.1:8080` and reads `dashboard.config.json` live from disk on every request.

## Local Development

Run the Go API and frontend in two terminals:

```bash
# Terminal 1 — Go API (http://127.0.0.1:8080/api/dashboard)
npm run dev:api

# Terminal 2 — Modern dev server with HMR (Mac / modern iPads, port 5173)
npm run dev

# Or test the exact Safari 12 / iPad mini 2 production bundle on LAN (port 4173):
npm run build && npm run preview
```

### Weather & Sky Preview Modes
Append `?demo=<mode>` to preview any condition immediately:
`?demo=night`, `?demo=day`, `?demo=sunset`, `?demo=rain`, `?demo=snow`, `?demo=storm`, `?demo=fog`, `?demo=cloudy`, `?demo=wind`.

## Deploy to Vercel

**Option A — GitHub Auto-Deploy (Recommended):**
Import this repository at [vercel.com/new](https://vercel.com/new) and click **Deploy** (Vercel detects [`vercel.json`](./vercel.json), [`go.mod`](./go.mod), and `api/dashboard.go` automatically). Pushing edits to `dashboard.config.json` auto-deploys and updates the wall-mounted iPad automatically.

**Option B — Vercel CLI:**
```bash
npx vercel login
npx vercel --prod
```

## Wall-Mounted iPad mini 2 Setup

1. Open your Vercel `https://...` URL in **Safari** on the iPad mini 2.
2. Tap **Share → Add to Home Screen** and launch **Glance** from the Home Screen.
3. Tap the top-center **Motion** icon once to switch to **Static** mode (persists across reloads so the A7 stays cool 24/7).
4. Set **Settings → Display & Brightness → Auto-Lock → Never** (and optionally enable **Do Not Disturb** or **Guided Access**).

## Tests & Build

```bash
npm run test:api   # Go unit tests
npm run build      # TypeScript check + Vite Safari 12 production build
```
