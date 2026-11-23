package handler

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// RSS 2.0, Hacker News style: the description is only a "Comments" link.
const testHNRSS = `<rss version="2.0"><channel><title>Hacker News</title><link>https://news.ycombinator.com/</link>
<item><title>Show HN: A wall dashboard &#x27;Glance&#x27;</title><link>https://www.example.com/post</link>
<pubDate>Sun, 22 Nov 2026 23:12:10 +0000</pubDate><comments>https://news.ycombinator.com/item?id=1</comments>
<description><![CDATA[<a href="https://news.ycombinator.com/item?id=1">Comments</a>]]></description></item>
<item><title>Ask HN: Favorite tools?</title><link>https://news.ycombinator.com/item?id=2</link>
<pubDate>Sun, 22 Nov 2026 21:01:16 +0000</pubDate></item>
</channel></rss>`

// RSS 2.0, Google News style: publisher in <source>, appended to the title.
const testGoogleNewsRSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>Sunnyvale, CA - Latest - Google News</title>
<item>
  <title>Mountain View movie theater reopening Dec. 1 - Palo Alto Daily Post</title>
  <link>https://news.google.com/rss/articles/CBMiabc?oc=5</link>
  <pubDate>Sun, 22 Nov 2026 00:48:31 GMT</pubDate>
  <description>&lt;a href="https://news.google.com/rss/articles/CBMiabc"&gt;Mountain View movie theater reopening Dec. 1&lt;/a&gt;&amp;nbsp;&amp;nbsp;&lt;font color="#6f6f6f"&gt;Palo Alto Daily Post&lt;/font&gt;</description>
  <source url="https://padailypost.com">Palo Alto Daily Post</source>
</item>
</channel></rss>`

// RSS 1.0 / RDF, DW style: items are siblings of <channel>, dates in dc:date.
const testRDF = `<?xml version="1.0" encoding="UTF-8"?>
<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns="http://purl.org/rss/1.0/" xmlns:dc="http://purl.org/dc/elements/1.1/">
<channel rdf:about="https://www.dw.com/zh"><title>DW 中文</title><link>https://www.dw.com/zh</link></channel>
<item rdf:about="https://www.dw.com/zh/a-1">
  <title>墙外文摘：特朗普到底说了啥？</title>
  <link>https://www.dw.com/zh/a-1?maca=chi-rss</link>
  <description>德国之声每日精选海外媒体对中国的报道与评论，供读者参考。</description>
  <dc:date>2026-11-22T18:30:00Z</dc:date>
</item>
</rdf:RDF>`

// Atom
const testAtom = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom"><title>Example Blog</title>
<link href="https://blog.example.org/"/>
<entry>
  <title type="html">Release &lt;b&gt;2.0&lt;/b&gt; is out</title>
  <link rel="replies" href="https://blog.example.org/2.0#comments"/>
  <link rel="alternate" href="https://blog.example.org/2.0"/>
  <updated>2026-11-21T08:00:00+08:00</updated>
  <summary>Version 2.0 adds offline mode, a new theme, and many fixes.</summary>
</entry>
</feed>`

func resetNewsCache() {
	newsCacheMu.Lock()
	newsCache = map[string]newsCacheEntry{}
	newsCacheMu.Unlock()
}

func newsTestResponse(status int, body string) *http.Response {
	return &http.Response{StatusCode: status, Body: io.NopCloser(bytes.NewBufferString(body)), Header: http.Header{}}
}

func TestParseNewsFeedsFromEnv(t *testing.T) {
	t.Setenv("NEWS_FEEDS", `[{"name":"Hacker News","url":"https://news.ycombinator.com/rss"},{"name":"Bad","url":"ftp://x"},{"url":" https://example.com/feed.xml "}]`)
	feeds := parseNewsFeedsFromEnv()
	if len(feeds) != 2 || feeds[0].Name != "Hacker News" || feeds[1].Name != "" || feeds[1].URL != "https://example.com/feed.xml" {
		t.Fatalf("unexpected JSON feeds: %+v", feeds)
	}

	t.Setenv("NEWS_FEEDS", "https://a.example/rss, https://b.example/rss\nhttps://c.example/rss,https://d.example/rss,https://e.example/rss")
	feeds = parseNewsFeedsFromEnv()
	if len(feeds) != newsMaxFeeds || feeds[0].URL != "https://a.example/rss" || feeds[3].URL != "https://d.example/rss" {
		t.Fatalf("expected the first %d plain URLs, got %+v", newsMaxFeeds, feeds)
	}

	t.Setenv("NEWS_FEEDS", "")
	if feeds = parseNewsFeedsFromEnv(); len(feeds) != 0 {
		t.Fatalf("expected no feeds when unset, got %+v", feeds)
	}
}

func TestParseNewsFeedFormats(t *testing.T) {
	hn, err := parseNewsFeed([]byte(testHNRSS))
	if err != nil || hn.title != "Hacker News" || len(hn.items) != 2 {
		t.Fatalf("RSS 2.0: %v %+v", err, hn)
	}
	if it := hn.items[0]; it.Title != "Show HN: A wall dashboard 'Glance'" || it.URL != "https://www.example.com/post" ||
		it.Source != "example.com" || it.Summary != "" || it.PublishedMs != time.Date(2026, 11, 22, 23, 12, 10, 0, time.UTC).UnixMilli() {
		t.Fatalf("unexpected HN item: %+v", it)
	}

	gn, err := parseNewsFeed([]byte(testGoogleNewsRSS))
	if err != nil || len(gn.items) != 1 {
		t.Fatalf("Google News: %v %+v", err, gn)
	}
	if it := gn.items[0]; it.Title != "Mountain View movie theater reopening Dec. 1" || it.Source != "Palo Alto Daily Post" ||
		it.Summary != "" || it.PublishedMs == 0 {
		t.Fatalf("unexpected Google News item: %+v", it)
	}

	rdf, err := parseNewsFeed([]byte(testRDF))
	if err != nil || rdf.title != "DW 中文" || len(rdf.items) != 1 {
		t.Fatalf("RDF: %v %+v", err, rdf)
	}
	if it := rdf.items[0]; it.Title != "墙外文摘：特朗普到底说了啥？" || it.Source != "dw.com" ||
		it.Summary != "德国之声每日精选海外媒体对中国的报道与评论，供读者参考。" ||
		it.PublishedMs != time.Date(2026, 11, 22, 18, 30, 0, 0, time.UTC).UnixMilli() {
		t.Fatalf("unexpected RDF item: %+v", it)
	}

	atom, err := parseNewsFeed([]byte(testAtom))
	if err != nil || atom.title != "Example Blog" || len(atom.items) != 1 {
		t.Fatalf("Atom: %v %+v", err, atom)
	}
	if it := atom.items[0]; it.Title != "Release 2.0 is out" || it.URL != "https://blog.example.org/2.0" ||
		it.PublishedMs != time.Date(2026, 11, 21, 0, 0, 0, 0, time.UTC).UnixMilli() || it.Summary == "" {
		t.Fatalf("unexpected Atom item: %+v", it)
	}

	// RFI-style <source> holding a photo credit is not treated as the publisher
	rfi, err := parseNewsFeed([]byte(`<rss><channel><title>RFI</title><item><title>气候大会落幕</title>
		<link>https://www.rfi.fr/cn/a-1</link><source url="https://s.rfi.fr/media/x.jpg">REUTERS - Murad Sezer</source></item></channel></rss>`))
	if err != nil || len(rfi.items) != 1 || rfi.items[0].Source != "rfi.fr" {
		t.Fatalf("expected photo-credit source to fall back to the domain: %v %+v", err, rfi)
	}

	if _, err := parseNewsFeed([]byte(`<html><body>Not a feed</body></html>`)); err == nil {
		t.Fatalf("expected an error for HTML")
	}
}

func TestNewsHandlerReadsConfiguredFeeds(t *testing.T) {
	origClient := newsHTTPClient
	newsHTTPClient = &http.Client{
		Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
			if ua := r.Header.Get("User-Agent"); !strings.HasPrefix(ua, "glance-dashboard/") {
				t.Errorf("expected glance User-Agent, got %q", ua)
			}
			switch r.URL.String() {
			case "https://news.ycombinator.com/rss":
				return newsTestResponse(200, testHNRSS), nil
			case "https://news.google.com/local.rss":
				return newsTestResponse(200, testGoogleNewsRSS), nil
			case "https://rss.example.com/dw":
				return newsTestResponse(200, testRDF), nil
			}
			return newsTestResponse(503, ""), nil
		}),
	}
	resetNewsCache()
	defer func() {
		newsHTTPClient = origClient
		resetNewsCache()
	}()
	t.Setenv("GLANCE_PASSCODE", "")
	t.Setenv("VERCEL", "")
	t.Setenv("NEWS_FEEDS", `[
		{"name":"Hacker News","url":"https://news.ycombinator.com/rss"},
		{"name":"Sunnyvale","url":"https://news.google.com/local.rss"},
		{"url":"https://rss.example.com/dw"},
		{"name":"Down","url":"https://down.example.com/rss"}
	]`)

	rec := httptest.NewRecorder()
	NewsHandler(rec, httptest.NewRequest(http.MethodGet, "/api/news", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	if cc := rec.Header().Get("Cache-Control"); cc != "private, no-store" {
		t.Fatalf("expected private Cache-Control, got %q", cc)
	}
	var resp NewsResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("invalid json: %v", err)
	}
	if !resp.Configured || len(resp.Feeds) != 4 {
		t.Fatalf("expected 4 feeds in env order, got %+v", resp)
	}
	names := []string{resp.Feeds[0].Name, resp.Feeds[1].Name, resp.Feeds[2].Name, resp.Feeds[3].Name}
	if strings.Join(names, "|") != "Hacker News|Sunnyvale|DW 中文|Down" {
		t.Fatalf("unexpected feed names (env name, else feed title): %v", names)
	}
	if len(resp.Feeds[0].Items) != 2 || len(resp.Feeds[1].Items) != 1 || len(resp.Feeds[2].Items) != 1 {
		t.Fatalf("unexpected item counts: %+v", resp.Feeds)
	}
	// A failing feed keeps its column with an error and no items
	if resp.Feeds[3].Error != "HTTP 503" || resp.Feeds[3].Items == nil || len(resp.Feeds[3].Items) != 0 {
		t.Fatalf("expected failed feed to report its error, got %+v", resp.Feeds[3])
	}
}

func TestNewsHandlerUnconfigured(t *testing.T) {
	t.Setenv("GLANCE_PASSCODE", "")
	t.Setenv("VERCEL", "")
	t.Setenv("NEWS_FEEDS", "")
	rec := httptest.NewRecorder()
	NewsHandler(rec, httptest.NewRequest(http.MethodGet, "/api/news", nil))
	var resp NewsResponse
	_ = json.Unmarshal(rec.Body.Bytes(), &resp)
	if rec.Code != http.StatusOK || resp.Configured || resp.Feeds == nil || len(resp.Feeds) != 0 {
		t.Fatalf("expected configured=false with empty feeds, got %d %s", rec.Code, rec.Body.String())
	}
}

func TestNewsHandlerRequiresAuth(t *testing.T) {
	t.Setenv("GLANCE_PASSCODE", "2468")
	t.Setenv("GLANCE_SESSION_SECRET", "test-session-secret-0123456789abcdef")
	t.Setenv("VERCEL", "1")
	rec := httptest.NewRecorder()
	NewsHandler(rec, httptest.NewRequest(http.MethodGet, "/api/news", nil))
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 without a session cookie, got %d", rec.Code)
	}
}

func TestCachedNewsBacksOffAfterFailure(t *testing.T) {
	resetNewsCache()
	defer resetNewsCache()

	calls := 0
	failing := func() (interface{}, error) {
		calls++
		return nil, errors.New("HTTP 429")
	}
	if _, err := cachedNews("k", time.Minute, false, failing); err == nil || calls != 1 {
		t.Fatalf("expected first failure to call fetch once, calls=%d err=%v", calls, err)
	}
	// Within the back-off window the source is not hit again
	if _, err := cachedNews("k", time.Minute, false, failing); err == nil || err.Error() != "HTTP 429" || calls != 1 {
		t.Fatalf("expected back-off to reuse the last error without fetching, calls=%d err=%v", calls, err)
	}
	// ?refresh=1 bypasses the back-off
	ok := func() (interface{}, error) { calls++; return "fresh", nil }
	if v, err := cachedNews("k", time.Minute, true, ok); err != nil || v != "fresh" || calls != 2 {
		t.Fatalf("expected forced refresh to fetch, calls=%d v=%v err=%v", calls, v, err)
	}
	// A later failure keeps serving the last good value, then backs off
	newsCacheMu.Lock()
	e := newsCache["k"]
	e.fetchedAt = time.Now().Add(-2 * time.Minute) // expire the TTL
	newsCache["k"] = e
	newsCacheMu.Unlock()
	if v, err := cachedNews("k", time.Minute, false, failing); err != nil || v != "fresh" || calls != 3 {
		t.Fatalf("expected stale value on failure, calls=%d v=%v err=%v", calls, v, err)
	}
	if v, _ := cachedNews("k", time.Minute, false, failing); v != "fresh" || calls != 3 {
		t.Fatalf("expected back-off to serve stale value without fetching, calls=%d v=%v", calls, v)
	}
}
