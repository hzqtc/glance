package auth

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestLocalOpenAndVercelFailClosedWhenUnset(t *testing.T) {
	t.Setenv("GLANCE_PASSCODE", "")
	t.Setenv("VERCEL", "")

	req := httptest.NewRequest(http.MethodGet, "/api/weather", nil)
	if !IsAuthenticated(req) || IsRequired() {
		t.Fatalf("expected local dev without passcode to be open")
	}

	t.Setenv("VERCEL", "1")
	if IsAuthenticated(req) || !IsRequired() || !IsMisconfigured() {
		t.Fatalf("expected Vercel without passcode to fail closed and report misconfigured")
	}

	rec := httptest.NewRecorder()
	if RequireAuth(rec, req) {
		t.Fatalf("RequireAuth should reject when Vercel has no passcode")
	}
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", rec.Code)
	}
}

func TestPasscodeCookieSigningAndRotationInvalidation(t *testing.T) {
	t.Setenv("GLANCE_PASSCODE", "4829")
	t.Setenv("VERCEL", "1")

	if !VerifyPasscode("4829") {
		t.Fatalf("expected valid passcode to verify")
	}
	if VerifyPasscode("0000") || VerifyPasscode("48290") {
		t.Fatalf("expected invalid passcode to fail")
	}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/auth", nil)
	req.Header.Set("X-Forwarded-Proto", "https")
	if !SetSessionCookie(rec, req) {
		t.Fatalf("expected SetSessionCookie to succeed")
	}

	cookies := rec.Result().Cookies()
	if len(cookies) != 1 || cookies[0].Name != CookieName || !cookies[0].HttpOnly || !cookies[0].Secure {
		t.Fatalf("unexpected cookie attributes: %+v", cookies)
	}

	authedReq := httptest.NewRequest(http.MethodGet, "/api/weather", nil)
	authedReq.AddCookie(cookies[0])
	if !IsAuthenticated(authedReq) {
		t.Fatalf("expected signed cookie to authenticate")
	}

	// Tampered cookie should fail
	tampered := *cookies[0]
	tampered.Value = tampered.Value + "a"
	tamperedReq := httptest.NewRequest(http.MethodGet, "/api/weather", nil)
	tamperedReq.AddCookie(&tampered)
	if IsAuthenticated(tamperedReq) {
		t.Fatalf("expected tampered cookie to be rejected")
	}

	// Rotating GLANCE_PASSCODE should immediately invalidate existing cookies
	t.Setenv("GLANCE_PASSCODE", "9999")
	if IsAuthenticated(authedReq) {
		t.Fatalf("expected rotated passcode to invalidate old cookie")
	}
}
