package auth

import (
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"net"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	CookieName       = "glance_auth"
	cookieMaxAgeSec  = 365 * 24 * 3600 // 1 year (one-time unlock per device)
	tokenVersionTag  = "glance-session-v1:"
	maxFailedTries   = 5
	failWindow       = 10 * time.Minute
	lockoutDuration  = 5 * time.Minute
	wrongPinDelay    = 400 * time.Millisecond
)

var (
	// Overridable in unit tests so tests run fast without sleeping.
	WrongPinDelay = wrongPinDelay

	rateMu      sync.Mutex
	rateEntries = map[string]*ipRateState{}
)

type ipRateState struct {
	fails       int
	firstFailAt time.Time
	lockedUntil time.Time
}

type Status struct {
	Authenticated bool `json:"authenticated"`
	Required      bool `json:"required"`
	Misconfigured bool `json:"misconfigured,omitempty"`
}

func configuredPasscode() string {
	return strings.TrimSpace(os.Getenv("GLANCE_PASSCODE"))
}

func isVercelRuntime() bool {
	return strings.TrimSpace(os.Getenv("VERCEL")) != ""
}

// IsRequired reports whether requests must be authenticated.
// Local dev without GLANCE_PASSCODE is allowed; Vercel fails closed if unset.
func IsRequired() bool {
	return configuredPasscode() != "" || isVercelRuntime()
}

// IsMisconfigured reports true when running on Vercel without GLANCE_PASSCODE set.
func IsMisconfigured() bool {
	return isVercelRuntime() && configuredPasscode() == ""
}

func deriveHMACKey(passcode string) []byte {
	sum := sha256.Sum256([]byte("glance-hmac-v1:" + passcode))
	return sum[:]
}

func signToken(issuedUnix int64, passcode string) string {
	ts := strconv.FormatInt(issuedUnix, 10)
	mac := hmac.New(sha256.New, deriveHMACKey(passcode))
	mac.Write([]byte(tokenVersionTag))
	mac.Write([]byte(ts))
	return ts + "." + hex.EncodeToString(mac.Sum(nil))
}

func verifyToken(token, passcode string, now time.Time) bool {
	dot := strings.IndexByte(token, '.')
	if dot <= 0 || dot >= len(token)-1 {
		return false
	}
	tsStr := token[:dot]
	sigHex := token[dot+1:]
	issuedUnix, err := strconv.ParseInt(tsStr, 10, 64)
	if err != nil || issuedUnix <= 0 {
		return false
	}
	// Reject tokens older than 1 year + 1 day or far in the future
	age := now.Unix() - issuedUnix
	if age < -300 || age > cookieMaxAgeSec+86400 {
		return false
	}

	gotSig, err := hex.DecodeString(sigHex)
	if err != nil {
		return false
	}
	mac := hmac.New(sha256.New, deriveHMACKey(passcode))
	mac.Write([]byte(tokenVersionTag))
	mac.Write([]byte(tsStr))
	expectedSig := mac.Sum(nil)
	return hmac.Equal(gotSig, expectedSig)
}

// VerifyPasscode compares a submitted PIN against GLANCE_PASSCODE in constant time.
func VerifyPasscode(submitted string) bool {
	expected := configuredPasscode()
	if expected == "" {
		return false
	}
	a := sha256.Sum256([]byte(strings.TrimSpace(submitted)))
	b := sha256.Sum256([]byte(expected))
	return subtle.ConstantTimeCompare(a[:], b[:]) == 1
}

// IsAuthenticated checks whether the incoming request is allowed access.
func IsAuthenticated(r *http.Request) bool {
	passcode := configuredPasscode()
	if passcode == "" {
		// Fail closed on Vercel; allow open access locally.
		return !isVercelRuntime()
	}
	c, err := r.Cookie(CookieName)
	if err != nil || c == nil || c.Value == "" {
		return false
	}
	return verifyToken(c.Value, passcode, time.Now())
}

// GetStatus returns the current authentication status for GET /api/auth.
func GetStatus(r *http.Request) Status {
	if IsMisconfigured() {
		return Status{
			Authenticated: false,
			Required:      true,
			Misconfigured: true,
		}
	}
	if !IsRequired() {
		return Status{
			Authenticated: true,
			Required:      false,
		}
	}
	return Status{
		Authenticated: IsAuthenticated(r),
		Required:      true,
	}
}

// RequireAuth enforces authentication at the start of any protected API handler.
// Returns true if authorized; otherwise writes 401 JSON and returns false.
func RequireAuth(w http.ResponseWriter, r *http.Request) bool {
	if IsAuthenticated(r) {
		return true
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "private, no-store")
	w.WriteHeader(http.StatusUnauthorized)
	msg := "passcode required"
	if IsMisconfigured() {
		msg = "GLANCE_PASSCODE is not configured on Vercel"
	}
	_ = json.NewEncoder(w).Encode(map[string]string{
		"error": msg,
	})
	return false
}

// SetSessionCookie writes a long-lived signed HttpOnly session cookie for the device.
func SetSessionCookie(w http.ResponseWriter, r *http.Request) bool {
	passcode := configuredPasscode()
	if passcode == "" {
		return false
	}
	token := signToken(time.Now().Unix(), passcode)
	http.SetCookie(w, &http.Cookie{
		Name:     CookieName,
		Value:    token,
		Path:     "/",
		MaxAge:   cookieMaxAgeSec,
		HttpOnly: true,
		Secure:   isHTTPSRequest(r),
		SameSite: http.SameSiteLaxMode,
	})
	return true
}

func isHTTPSRequest(r *http.Request) bool {
	if r.TLS != nil {
		return true
	}
	proto := strings.TrimSpace(r.Header.Get("X-Forwarded-Proto"))
	if idx := strings.IndexByte(proto, ','); idx >= 0 {
		proto = strings.TrimSpace(proto[:idx])
	}
	return strings.EqualFold(proto, "https")
}

func clientIP(r *http.Request) string {
	for _, hdr := range []string{"X-Vercel-Forwarded-For", "X-Real-IP", "X-Forwarded-For"} {
		if val := strings.TrimSpace(r.Header.Get(hdr)); val != "" {
			if comma := strings.IndexByte(val, ','); comma >= 0 {
				val = strings.TrimSpace(val[:comma])
			}
			if val != "" {
				return val
			}
		}
	}
	host, _, err := net.SplitHostPort(strings.TrimSpace(r.RemoteAddr))
	if err == nil && host != "" {
		return host
	}
	return strings.TrimSpace(r.RemoteAddr)
}

// CheckRateLimit returns remaining lockout duration if the IP is currently throttled.
func CheckRateLimit(r *http.Request) time.Duration {
	ip := clientIP(r)
	if ip == "" {
		return 0
	}
	now := time.Now()
	rateMu.Lock()
	defer rateMu.Unlock()

	// Periodically evict expired entries to prevent unbounded map growth
	if len(rateEntries) >= 256 {
		for k, entry := range rateEntries {
			if !now.Before(entry.lockedUntil) && now.Sub(entry.firstFailAt) > failWindow {
				delete(rateEntries, k)
			}
		}
	}

	st, ok := rateEntries[ip]
	if !ok {
		return 0
	}
	if now.Before(st.lockedUntil) {
		return st.lockedUntil.Sub(now)
	}
	if !st.firstFailAt.IsZero() && now.Sub(st.firstFailAt) > failWindow {
		delete(rateEntries, ip)
	}
	return 0
}

// RecordFailure records a failed PIN attempt and returns true if the IP is now locked out.
func RecordFailure(r *http.Request) bool {
	ip := clientIP(r)
	if ip == "" {
		return false
	}
	now := time.Now()
	rateMu.Lock()
	defer rateMu.Unlock()

	// Periodically evict expired entries to prevent unbounded map growth
	if len(rateEntries) >= 256 {
		for k, entry := range rateEntries {
			if !now.Before(entry.lockedUntil) && now.Sub(entry.firstFailAt) > failWindow {
				delete(rateEntries, k)
			}
		}
	}

	st, ok := rateEntries[ip]
	if !ok || now.Sub(st.firstFailAt) > failWindow {
		st = &ipRateState{fails: 1, firstFailAt: now}
		rateEntries[ip] = st
		return false
	}
	st.fails++
	if st.fails >= maxFailedTries {
		st.lockedUntil = now.Add(lockoutDuration)
		return true
	}
	return false
}

// ClearFailures resets failed PIN attempts for the IP after a successful unlock.
func ClearFailures(r *http.Request) {
	ip := clientIP(r)
	if ip == "" {
		return
	}
	rateMu.Lock()
	delete(rateEntries, ip)
	rateMu.Unlock()
}

// ResetRateLimiterForTest clears in-memory rate limit state (for unit tests).
func ResetRateLimiterForTest() {
	rateMu.Lock()
	rateEntries = map[string]*ipRateState{}
	rateMu.Unlock()
}
