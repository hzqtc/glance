package auth

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestLocalOpenAndVercelFailClosedWhenUnset(t *testing.T) {
	t.Setenv("GLANCE_PASSCODE", "")
	t.Setenv("GLANCE_SESSION_SECRET", "")
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
	t.Setenv("GLANCE_SESSION_SECRET", testSecret)

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

	// Rotating GLANCE_SESSION_SECRET should also invalidate existing cookies
	t.Setenv("GLANCE_PASSCODE", "4829")
	if !IsAuthenticated(authedReq) {
		t.Fatalf("expected cookie to be valid again with the original passcode")
	}
	t.Setenv("GLANCE_SESSION_SECRET", testSecret+"-rotated")
	if IsAuthenticated(authedReq) {
		t.Fatalf("expected rotated session secret to invalidate old cookie")
	}
}

const testSecret = "test-session-secret-0123456789abcdef"

func TestVercelRequiresStrongSessionSecret(t *testing.T) {
	t.Setenv("GLANCE_PASSCODE", "4829")
	t.Setenv("VERCEL", "1")

	for _, secret := range []string{"", "too-short"} {
		t.Setenv("GLANCE_SESSION_SECRET", secret)
		if !IsMisconfigured() {
			t.Fatalf("expected Vercel with secret %q to be misconfigured", secret)
		}
		if st := GetStatus(httptest.NewRequest(http.MethodGet, "/api/auth", nil)); !st.Misconfigured || st.Authenticated {
			t.Fatalf("unexpected status for secret %q: %+v", secret, st)
		}
		rec := httptest.NewRecorder()
		if SetSessionCookie(rec, httptest.NewRequest(http.MethodPost, "/api/auth", nil)) {
			t.Fatalf("expected SetSessionCookie to refuse without a valid secret")
		}
	}
}

// A cookie signed with a key derived only from the PIN (the old v1 scheme an
// attacker could brute-force in 10^4 guesses) must not authenticate.
func TestPinOnlyForgedCookieRejected(t *testing.T) {
	t.Setenv("GLANCE_PASSCODE", "4829")
	t.Setenv("VERCEL", "1")
	t.Setenv("GLANCE_SESSION_SECRET", testSecret)

	issued := time.Now().Unix()
	for _, key := range []string{"", "4829"} {
		forged := signToken(issued, key, "4829")
		req := httptest.NewRequest(http.MethodGet, "/api/weather", nil)
		req.AddCookie(&http.Cookie{Name: CookieName, Value: forged})
		if IsAuthenticated(req) {
			t.Fatalf("expected cookie forged without the server secret (key %q) to be rejected", key)
		}
	}
}

func TestLocalDevWithoutSecretUsesRandomSecret(t *testing.T) {
	t.Setenv("GLANCE_PASSCODE", "4829")
	t.Setenv("VERCEL", "")
	t.Setenv("GLANCE_SESSION_SECRET", "")

	if IsMisconfigured() {
		t.Fatalf("local dev without a session secret should not be misconfigured")
	}
	rec := httptest.NewRecorder()
	if !SetSessionCookie(rec, httptest.NewRequest(http.MethodPost, "/api/auth", nil)) {
		t.Fatalf("expected SetSessionCookie to succeed locally with a random secret")
	}
	req := httptest.NewRequest(http.MethodGet, "/api/weather", nil)
	req.AddCookie(rec.Result().Cookies()[0])
	if !IsAuthenticated(req) {
		t.Fatalf("expected locally issued cookie to authenticate")
	}
}
