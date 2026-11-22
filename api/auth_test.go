package handler

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"glance/auth"
)

func TestAuthHandlerFlowAndProtectedEndpoints(t *testing.T) {
	origDelay := auth.WrongPinDelay
	auth.WrongPinDelay = 0
	auth.ResetRateLimiterForTest()
	defer func() {
		auth.WrongPinDelay = origDelay
		auth.ResetRateLimiterForTest()
	}()

	t.Setenv("GLANCE_PASSCODE", "2468")
	t.Setenv("VERCEL", "1")

	// 1. Unauthenticated GET /api/auth
	req := httptest.NewRequest(http.MethodGet, "/api/auth", nil)
	rec := httptest.NewRecorder()
	AuthHandler(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
	var st auth.Status
	_ = json.Unmarshal(rec.Body.Bytes(), &st)
	if st.Authenticated || !st.Required {
		t.Fatalf("expected unauthenticated & required, got %+v", st)
	}

	// 2. Protected APIs must reject with 401 before doing any work
	for _, tc := range []struct {
		path string
		fn   http.HandlerFunc
	}{
		{"/api/weather", WeatherHandler},
		{"/api/stocks", StocksHandler},
		{"/api/calendar", CalendarHandler},
		{"/api/photos", PhotosHandler},
		{"/api/world", WorldHandler},
	} {
		r := httptest.NewRequest(http.MethodGet, tc.path, nil)
		w := httptest.NewRecorder()
		tc.fn(w, r)
		if w.Code != http.StatusUnauthorized {
			t.Fatalf("%s expected 401 when unauthenticated, got %d", tc.path, w.Code)
		}
	}

	// 3. Wrong PIN -> 401
	badReq := httptest.NewRequest(http.MethodPost, "/api/auth", bytes.NewBufferString(`{"passcode":"1111"}`))
	badReq.RemoteAddr = "10.0.0.1:1234"
	badRec := httptest.NewRecorder()
	AuthHandler(badRec, badReq)
	if badRec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 for wrong PIN, got %d", badRec.Code)
	}

	// 4. Correct PIN -> 200 + HttpOnly cookie
	okReq := httptest.NewRequest(http.MethodPost, "/api/auth", bytes.NewBufferString(`{"passcode":"2468"}`))
	okReq.RemoteAddr = "10.0.0.1:1234"
	okRec := httptest.NewRecorder()
	AuthHandler(okRec, okReq)
	if okRec.Code != http.StatusOK {
		t.Fatalf("expected 200 for valid PIN, got %d: %s", okRec.Code, okRec.Body.String())
	}
	cookies := okRec.Result().Cookies()
	if len(cookies) != 1 || cookies[0].Name != auth.CookieName {
		t.Fatalf("expected session cookie, got %+v", cookies)
	}

	// 5. GET /api/auth with cookie -> authenticated=true
	checkReq := httptest.NewRequest(http.MethodGet, "/api/auth", nil)
	checkReq.AddCookie(cookies[0])
	checkRec := httptest.NewRecorder()
	AuthHandler(checkRec, checkReq)
	var st2 auth.Status
	_ = json.Unmarshal(checkRec.Body.Bytes(), &st2)
	if !st2.Authenticated || !st2.Required {
		t.Fatalf("expected authenticated=true with cookie, got %+v", st2)
	}
}

func TestAuthHandlerRateLimit(t *testing.T) {
	origDelay := auth.WrongPinDelay
	auth.WrongPinDelay = 0
	auth.ResetRateLimiterForTest()
	defer func() {
		auth.WrongPinDelay = origDelay
		auth.ResetRateLimiterForTest()
	}()

	t.Setenv("GLANCE_PASSCODE", "1357")
	t.Setenv("VERCEL", "1")

	for i := 0; i < 5; i++ {
		req := httptest.NewRequest(http.MethodPost, "/api/auth", bytes.NewBufferString(`{"passcode":"9999"}`))
		req.RemoteAddr = "203.0.113.9:5555"
		rec := httptest.NewRecorder()
		AuthHandler(rec, req)
		if i < 4 && rec.Code != http.StatusUnauthorized {
			t.Fatalf("attempt %d: expected 401, got %d", i+1, rec.Code)
		}
		if i == 4 && rec.Code != http.StatusTooManyRequests {
			t.Fatalf("attempt 5: expected 429 lockout, got %d", rec.Code)
		}
	}
}
