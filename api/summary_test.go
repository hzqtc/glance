package handler

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
)

const testArticleFeed = `<rss version="2.0"><channel><title>Bay Area</title>
<item><title>Storm hits the Bay</title><link><![CDATA[https://news.example.com/storm]]></link></item>
<item><title>GBK page</title><link>https://gbk.example.cn/a</link></item>
<item><title>JS-only page</title><link>https://app.example.com/post</link></item>
</channel></rss>`

const testArticleHTML = `<html><head>
<meta property="og:title" content="Storm hits the Bay">
<meta name="description" content="A storm hit the Bay Area.">
</head><body>
<header><p>Hearst Newspapers Logo. Skip to main content. Subscribe now.</p></header>
<p>Sign up for our newsletter.</p>
<article>
  <p>A powerful storm swept across the Bay Area on Sunday, knocking out power to 40,000 homes. Crews worked overnight to restore service.</p>
  <figure><p>Photo: A fallen tree in Oakland. (AP)</p></figure>
  <p>U.S. forecasters said more rain is expected Tuesday. Residents were urged to stay indoors.</p>
  <p>Short.</p>
</article>
<script>var x = "<p>Not text.</p>";</script>
<!-- <p>Commented-out paragraph should not appear.</p> -->
</body></html>`

func TestIsMostlyChinese(t *testing.T) {
	if !isMostlyChinese("中新社北京11月23日电 丁薛祥在新加坡会见新加坡总理黄循财。") {
		t.Fatalf("expected Chinese text to be detected")
	}
	if isMostlyChinese("A powerful storm swept across the Bay Area on Sunday (暴风雨).") {
		t.Fatalf("expected English text with a few Han characters not to count as Chinese")
	}
}

func TestExtractArticlePrefersArticleParagraphs(t *testing.T) {
	title, text := extractArticle(testArticleHTML)
	if title != "Storm hits the Bay" {
		t.Fatalf("title: %q", title)
	}
	want := "A powerful storm swept across the Bay Area on Sunday, knocking out power to 40,000 homes. Crews worked overnight to restore service.\n" +
		"U.S. forecasters said more rain is expected Tuesday. Residents were urged to stay indoors."
	if text != want {
		t.Fatalf("article text:\n got %q\nwant %q", text, want)
	}
	// No paragraphs: fall back to JSON-LD articleBody, then the meta description
	jsonLD := `<html><head><title>Bot check</title><script type="application/ld+json">{"@type":"NewsArticle","articleBody":"Officials said the bridge \"will reopen\" Monday after repairs.\nTraffic is expected to be heavy."}</script></head><body><div id="app"></div></body></html>`
	if _, text := extractArticle(jsonLD); text != `Officials said the bridge "will reopen" Monday after repairs. Traffic is expected to be heavy.` {
		t.Fatalf("expected JSON-LD articleBody fallback, got %q", text)
	}
	if got := pageTitle(jsonLD); got != "Bot check" {
		t.Fatalf("pageTitle: %q", got)
	}
	// No paragraphs: fall back to the meta description
	if _, text := extractArticle(`<html><head><meta name="description" content="Only a description."></head><body><div>JS app</div></body></html>`); text != "Only a description." {
		t.Fatalf("expected meta description fallback, got %q", text)
	}
}

type summaryMocks struct {
	articleFetches int
	geminiCalls    int
	geminiReply    string
	geminiCode     int
}

func setupSummaryTest(t *testing.T, m *summaryMocks) {
	t.Helper()
	origNews, origArticle, origGemini := newsHTTPClient, articleHTTPClient, geminiHTTPClient
	newsHTTPClient = &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
		return newsTestResponse(200, testArticleFeed), nil
	})}
	articleHTTPClient = &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
		m.articleFetches++
		switch r.URL.String() {
		case "https://news.example.com/storm":
			return newsTestResponse(200, testArticleHTML), nil
		case "https://app.example.com/post":
			// A page that renders its text with JavaScript (no paragraphs, no meta description)
			return newsTestResponse(200, `<html><body><div id="root"></div><script>render()</script></body></html>`), nil
		case "https://gbk.example.cn/a":
			resp := newsTestResponse(200, `<html><head><meta charset="gbk"></head><body><p>乱码。</p></body></html>`)
			return resp, nil
		}
		t.Errorf("unexpected article fetch %s", r.URL)
		return newsTestResponse(404, ""), nil
	})}
	geminiHTTPClient = &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
		m.geminiCalls++
		if r.Header.Get("x-goog-api-key") != "test-key" || !strings.Contains(r.URL.Path, "/models/gemini-flash-lite-latest:generateContent") {
			t.Errorf("unexpected Gemini request %s key=%q", r.URL, r.Header.Get("x-goog-api-key"))
		}
		body, _ := io.ReadAll(r.Body)
		if !strings.Contains(string(body), "A powerful storm swept across the Bay Area") {
			t.Errorf("Gemini prompt missing article text: %s", body)
		}
		// English article: no request to write in Chinese
		if strings.Contains(string(body), "Chinese") {
			t.Errorf("English article prompt should not ask for Chinese: %s", body)
		}
		code := m.geminiCode
		if code == 0 {
			code = 200
		}
		return newsTestResponse(code, m.geminiReply), nil
	})}
	resetNewsCache()
	summaryCacheMu.Lock()
	summaryCache = map[string]summaryCacheEntry{}
	summaryCacheMu.Unlock()
	t.Cleanup(func() {
		newsHTTPClient, articleHTTPClient, geminiHTTPClient = origNews, origArticle, origGemini
		resetNewsCache()
	})
	t.Setenv("GLANCE_PASSCODE", "")
	t.Setenv("VERCEL", "")
	t.Setenv("GEMINI_MODEL", "")
	t.Setenv("NEWS_FEEDS", `[{"name":"Bay Area","url":"https://feeds.example.com/bay.rss"}]`)
}

func getSummary(t *testing.T, articleURL string) (int, SummaryResponse) {
	t.Helper()
	rec := httptest.NewRecorder()
	SummaryHandler(rec, httptest.NewRequest(http.MethodGet, "/api/summary?url="+url.QueryEscape(articleURL), nil))
	var resp SummaryResponse
	_ = json.Unmarshal(rec.Body.Bytes(), &resp)
	return rec.Code, resp
}

func TestSummaryDisabledWithoutGeminiKey(t *testing.T) {
	m := &summaryMocks{}
	setupSummaryTest(t, m)
	t.Setenv("GEMINI_API_KEY", "")

	// No key: no TL;DR, and the article isn't even fetched
	code, resp := getSummary(t, "https://news.example.com/storm")
	if code != http.StatusNotFound || resp.TLDR != "" || m.geminiCalls != 0 || m.articleFetches != 0 {
		t.Fatalf("expected TL;DR disabled without a key, got %d %+v (gemini %d, fetches %d)", code, resp, m.geminiCalls, m.articleFetches)
	}

	// /api/news tells the page TL;DRs are off
	rec := httptest.NewRecorder()
	NewsHandler(rec, httptest.NewRequest(http.MethodGet, "/api/news", nil))
	var news NewsResponse
	_ = json.Unmarshal(rec.Body.Bytes(), &news)
	if news.TLDR {
		t.Fatalf("expected tldr=false in /api/news without a key")
	}
}

func TestSummaryRejectsAndReportsFailures(t *testing.T) {
	m := &summaryMocks{geminiReply: `{"candidates":[{"content":{"parts":[{"text":"ok"}]}}]}`}
	setupSummaryTest(t, m)
	t.Setenv("GEMINI_API_KEY", "test-key")

	// Only links from the configured feeds are summarized
	if code, _ := getSummary(t, "https://evil.example.com/x"); code != http.StatusForbidden {
		t.Fatalf("expected 403 for a link outside the feeds, got %d", code)
	}
	// Errors are short, user-facing reasons (details go to the server log)
	if _, resp := getSummary(t, "https://gbk.example.cn/a"); resp.TLDR != "" || resp.Error != "unsupported page encoding" {
		t.Fatalf("expected unsupported-encoding error, got %+v", resp)
	}
	if _, resp := getSummary(t, "https://app.example.com/post"); resp.TLDR != "" ||
		resp.Error != "no article text found" {
		t.Fatalf("expected no-text error for a JavaScript-only page, got %+v", resp)
	}
	if m.geminiCalls != 0 {
		t.Fatalf("Gemini should not be called without article text, calls=%d", m.geminiCalls)
	}
}

func TestSummaryUsesGeminiAndCaches(t *testing.T) {
	m := &summaryMocks{geminiReply: `{"candidates":[{"content":{"parts":[{"text":"A storm cut power to 40,000 Bay Area homes; more rain is due Tuesday."}]}}]}`}
	setupSummaryTest(t, m)
	t.Setenv("GEMINI_API_KEY", "test-key")

	_, resp := getSummary(t, "https://news.example.com/storm")
	if resp.TLDR != "A storm cut power to 40,000 Bay Area homes; more rain is due Tuesday." {
		t.Fatalf("unexpected AI summary: %+v", resp)
	}

	rec := httptest.NewRecorder()
	NewsHandler(rec, httptest.NewRequest(http.MethodGet, "/api/news", nil))
	var news NewsResponse
	_ = json.Unmarshal(rec.Body.Bytes(), &news)
	if !news.TLDR {
		t.Fatalf("expected tldr=true in /api/news with a key")
	}
	_, again := getSummary(t, "https://news.example.com/storm")
	if again.TLDR != resp.TLDR || m.geminiCalls != 1 {
		t.Fatalf("expected the cached summary without a second Gemini call, calls=%d", m.geminiCalls)
	}
}

func TestSummaryNoTLDRWhenGeminiFails(t *testing.T) {
	m := &summaryMocks{geminiCode: 429, geminiReply: `{"error":{"code":429,"message":"Resource exhausted"}}`}
	setupSummaryTest(t, m)
	t.Setenv("GEMINI_API_KEY", "test-key")

	_, resp := getSummary(t, "https://news.example.com/storm")
	if resp.TLDR != "" || resp.Error != "AI service unavailable" || m.geminiCalls != 1 {
		t.Fatalf("expected no TL;DR after a Gemini error, got %+v (calls %d)", resp, m.geminiCalls)
	}
}

func TestSummaryRequiresAuth(t *testing.T) {
	t.Setenv("GLANCE_PASSCODE", "2468")
	t.Setenv("GLANCE_SESSION_SECRET", "test-session-secret-0123456789abcdef")
	t.Setenv("VERCEL", "1")
	rec := httptest.NewRecorder()
	SummaryHandler(rec, httptest.NewRequest(http.MethodGet, "/api/summary?url=https%3A%2F%2Fnews.example.com%2Fstorm", nil))
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 without a session cookie, got %d", rec.Code)
	}
}
