package handler

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"time"

	"glance/auth"
)

type authVerifyRequest struct {
	Passcode string `json:"passcode"`
}

// AuthHandler serves GET and POST /api/auth on Vercel (and locally via cmd/devserver).
func AuthHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "private, no-store")

	if r.Method == http.MethodGet || r.Method == http.MethodHead {
		status := auth.GetStatus(r)
		w.WriteHeader(http.StatusOK)
		if r.Method == http.MethodHead {
			return
		}
		_ = json.NewEncoder(w).Encode(status)
		return
	}

	if r.Method != http.MethodPost {
		auth.WriteJSONError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	if auth.IsMisconfigured() {
		auth.WriteJSONError(w, http.StatusServiceUnavailable, auth.MisconfiguredMessage())
		return
	}

	if !auth.IsRequired() {
		w.WriteHeader(http.StatusOK)
		_ = json.NewEncoder(w).Encode(auth.Status{
			Authenticated: true,
			Required:      false,
		})
		return
	}

	if retryAfter := auth.CheckRateLimit(r); retryAfter > 0 {
		secs := int(retryAfter.Seconds())
		if secs < 1 {
			secs = 1
		}
		w.Header().Set("Retry-After", strconv.Itoa(secs))
		auth.WriteJSONError(w, http.StatusTooManyRequests, "Too many incorrect attempts. Try again in a few minutes.")
		return
	}

	var payload authVerifyRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&payload); err != nil {
		auth.WriteJSONError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	pin := strings.TrimSpace(payload.Passcode)
	if !auth.VerifyPasscode(pin) {
		if auth.WrongPinDelay > 0 {
			time.Sleep(auth.WrongPinDelay)
		}
		locked := auth.RecordFailure(r)
		if locked {
			w.Header().Set("Retry-After", strconv.Itoa(5*60))
			auth.WriteJSONError(w, http.StatusTooManyRequests, "Too many incorrect attempts. Try again in 5 minutes.")
			return
		}
		auth.WriteJSONError(w, http.StatusUnauthorized, "Incorrect PIN")
		return
	}

	auth.ClearFailures(r)
	if !auth.SetSessionCookie(w, r) {
		auth.WriteJSONError(w, http.StatusInternalServerError, "failed to issue session")
		return
	}
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(auth.Status{
		Authenticated: true,
		Required:      true,
	})
}
