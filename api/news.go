package handler

import (
	"bytes"
	"encoding/json"
	"encoding/xml"
	"fmt"
	"html"
	"io"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"glance/auth"
	"glance/config"
)

// /api/news reads the RSS/Atom feeds listed in NEWS_FEEDS and returns one
// column of items per feed. There is no source-specific parsing: every feed is
// reduced to title, link, date, publisher, and a short plain-text summary.
//
// Note: every helper for /api/news lives in this file. Vercel treats each .go
// file in api/ as a serverless entrypoint, so helper-only files there break
// the build.

type NewsFeedConfig struct {
	Name string `json:"name"`
	URL  string `json:"url"`
}

type NewsItem struct {
	Title       string `json:"title"`
	URL         string `json:"url"`
	Source      string `json:"source,omitempty"` // publisher (RSS <source>) or the link's domain
	Summary     string `json:"summary,omitempty"`
	PublishedMs int64  `json:"publishedMs,omitempty"`
}

type NewsFeed struct {
	Name  string     `json:"name"`
	URL   string     `json:"url"`
	Items []NewsItem `json:"items"`
	Error string     `json:"error,omitempty"`
}

type NewsResponse struct {
	FetchedAt  string     `json:"fetchedAt"`
	Date       string     `json:"date"` // YYYY-MM-DD in the Home city's timezone
	Configured bool       `json:"configured"`
	TLDR       bool       `json:"tldr"` // GEMINI_API_KEY is set, so /api/summary is available
	Feeds      []NewsFeed `json:"feeds"`
}

const (
	newsUserAgent    = "glance-dashboard/1.0 (personal wall dashboard)"
	newsMaxFeeds     = 4
	newsItemsPerFeed = 15
	newsSummaryRunes = 280
	newsMinSummary   = 12 // shorter "summaries" (e.g. HN's "Comments" link) are dropped
	newsCacheTTL     = 15 * time.Minute
	newsRetryBackoff = 5 * time.Minute // after a failed fetch, wait before trying again
	newsMaxFeedBytes = 4 << 20
)

var (
	newsHTTPClient = &http.Client{Timeout: 8 * time.Second}

	newsCacheMu sync.Mutex
	newsCache   = map[string]newsCacheEntry{}

	newsTagRe        = regexp.MustCompile(`<[^>]*>`)
	newsWhitespaceRe = regexp.MustCompile(`\s+`)
	newsImageURLRe   = regexp.MustCompile(`(?i)\.(jpe?g|png|gif|webp|avif)(\?.*)?$`)
)

type newsCacheEntry struct {
	fetchedAt time.Time
	value     interface{} // nil until the first successful fetch
	failedAt  time.Time
	lastErr   error
}

// NewsHandler serves GET /api/news on Vercel (and locally via cmd/devserver).
func NewsHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		writeNewsError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	if !auth.RequireAuth(w, r) {
		return
	}

	cfg, _, _, err := config.LoadNormalizedConfig()
	if err != nil {
		writeNewsError(w, http.StatusInternalServerError, fmt.Sprintf("invalid config: %v", err))
		return
	}
	tzName := "America/Los_Angeles"
	if len(cfg.Cities) > 0 && strings.TrimSpace(cfg.Cities[0].Timezone) != "" {
		tzName = cfg.Cities[0].Timezone
	}
	forceRefresh := r.URL.Query().Get("refresh") == "1"

	sources := parseNewsFeedsFromEnv()
	resp := NewsResponse{
		FetchedAt:  time.Now().UTC().Format(time.RFC3339),
		Date:       time.Now().In(loadTimezoneSafe(tzName)).Format("2006-01-02"),
		Configured: len(sources) > 0,
		TLDR:       geminiAPIKey() != "",
		Feeds:      make([]NewsFeed, len(sources)),
	}

	var wg sync.WaitGroup
	for i, src := range sources {
		wg.Add(1)
		go func(i int, src NewsFeedConfig) {
			defer wg.Done()
			feed := NewsFeed{Name: src.Name, URL: src.URL, Items: []NewsItem{}}
			v, err := cachedNews(src.URL, newsCacheTTL, forceRefresh, func() (interface{}, error) {
				return fetchNewsFeed(src.URL)
			})
			if err != nil {
				feed.Error = err.Error()
			} else {
				parsed := v.(parsedNewsFeed)
				feed.Items = parsed.items
				if feed.Name == "" {
					feed.Name = parsed.title
				}
			}
			if feed.Name == "" {
				feed.Name = newsDomain(src.URL)
			}
			resp.Feeds[i] = feed
		}(i, src)
	}
	wg.Wait()

	// The feed list comes from an env var, so never cache it on a shared edge
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "private, no-store")
	w.WriteHeader(http.StatusOK)
	if r.Method == http.MethodHead {
		return
	}
	_ = json.NewEncoder(w).Encode(resp)
}

// parseNewsFeedsFromEnv reads NEWS_FEEDS: either a JSON array of
// {"name","url"} objects or comma/newline-separated URLs (names then come
// from each feed's own title). At most newsMaxFeeds are used.
func parseNewsFeedsFromEnv() []NewsFeedConfig {
	raw := strings.TrimSpace(os.Getenv("NEWS_FEEDS"))
	if raw == "" {
		return nil
	}
	var feeds []NewsFeedConfig
	if strings.HasPrefix(raw, "[") {
		var parsed []NewsFeedConfig
		if err := json.Unmarshal([]byte(raw), &parsed); err == nil {
			for _, f := range parsed {
				f.Name = strings.TrimSpace(f.Name)
				f.URL = strings.TrimSpace(f.URL)
				if isHTTPURL(f.URL) {
					feeds = append(feeds, f)
				}
			}
		}
	} else {
		for _, part := range strings.FieldsFunc(raw, func(r rune) bool { return r == ',' || r == '\n' || r == '\r' }) {
			if u := strings.TrimSpace(part); isHTTPURL(u) {
				feeds = append(feeds, NewsFeedConfig{URL: u})
			}
		}
	}
	if len(feeds) > newsMaxFeeds {
		feeds = feeds[:newsMaxFeeds]
	}
	return feeds
}

func isHTTPURL(raw string) bool {
	u, err := url.Parse(raw)
	return err == nil && (u.Scheme == "https" || u.Scheme == "http") && u.Host != ""
}

// cachedNews returns a fresh cached value, or calls fetch and caches its result.
// On failure it serves the last good value (if any), and backs off for
// newsRetryBackoff so a rate-limited source isn't hit on every request.
// force (?refresh=1) skips both the TTL and the back-off.
func cachedNews(key string, ttl time.Duration, force bool, fetch func() (interface{}, error)) (interface{}, error) {
	newsCacheMu.Lock()
	entry, ok := newsCache[key]
	newsCacheMu.Unlock()
	hasValue := ok && entry.value != nil
	if !force {
		if hasValue && time.Since(entry.fetchedAt) < ttl {
			return entry.value, nil
		}
		if ok && !entry.failedAt.IsZero() && time.Since(entry.failedAt) < newsRetryBackoff {
			if hasValue {
				return entry.value, nil
			}
			return nil, entry.lastErr
		}
	}
	v, err := fetch()
	newsCacheMu.Lock()
	defer newsCacheMu.Unlock()
	if err != nil {
		entry.failedAt = time.Now()
		entry.lastErr = err
		newsCache[key] = entry
		if hasValue {
			return entry.value, nil
		}
		return nil, err
	}
	newsCache[key] = newsCacheEntry{fetchedAt: time.Now(), value: v}
	return v, nil
}

type parsedNewsFeed struct {
	title string
	items []NewsItem
}

func fetchNewsFeed(feedURL string) (parsedNewsFeed, error) {
	req, err := http.NewRequest(http.MethodGet, feedURL, nil)
	if err != nil {
		return parsedNewsFeed{}, err
	}
	req.Header.Set("User-Agent", newsUserAgent)
	req.Header.Set("Accept", "application/rss+xml, application/atom+xml, application/xml;q=0.9, */*;q=0.8")
	res, err := newsHTTPClient.Do(req)
	if err != nil {
		return parsedNewsFeed{}, err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return parsedNewsFeed{}, fmt.Errorf("HTTP %d", res.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(res.Body, newsMaxFeedBytes))
	if err != nil {
		return parsedNewsFeed{}, err
	}
	feed, err := parseNewsFeed(body)
	if err != nil {
		return parsedNewsFeed{}, err
	}
	if len(feed.items) == 0 {
		return parsedNewsFeed{}, fmt.Errorf("no items")
	}
	return feed, nil
}

// feedEntry covers the fields of an RSS 2.0 <item>, RSS 1.0 (RDF) <item>, and
// Atom <entry>; tags without a namespace match any namespace (e.g. dc:date).
type feedEntry struct {
	Title string `xml:"title"`
	Links []struct {
		Href string `xml:"href,attr"`
		Rel  string `xml:"rel,attr"`
		Text string `xml:",chardata"`
	} `xml:"link"`
	PubDate     string `xml:"pubDate"`
	Date        string `xml:"date"`
	Published   string `xml:"published"`
	Updated     string `xml:"updated"`
	Description string `xml:"description"`
	Summary     string `xml:"summary"`
	Source      struct {
		Text string `xml:",chardata"`
		URL  string `xml:"url,attr"`
	} `xml:"source"`
}

// parseNewsFeed reads RSS 2.0, RSS 1.0/RDF, or Atom by walking the XML for
// <item>/<entry> elements wherever they appear.
func parseNewsFeed(body []byte) (parsedNewsFeed, error) {
	dec := xml.NewDecoder(bytes.NewReader(body))
	dec.Strict = false
	dec.Entity = xml.HTMLEntity
	dec.CharsetReader = func(charset string, input io.Reader) (io.Reader, error) {
		// Feeds are expected in UTF-8; pass other declared charsets through as-is
		return input, nil
	}

	var out parsedNewsFeed
	sawRoot := false
	for {
		tok, err := dec.Token()
		if err == io.EOF {
			break
		}
		if err != nil {
			if len(out.items) > 0 {
				break // keep what parsed before a malformed tail
			}
			return out, err
		}
		start, ok := tok.(xml.StartElement)
		if !ok {
			continue
		}
		switch start.Name.Local {
		case "rss", "RDF", "feed":
			sawRoot = true
		case "title":
			// The first title outside an item names the feed
			if out.title == "" && len(out.items) == 0 {
				var t string
				if dec.DecodeElement(&t, &start) == nil {
					out.title = cleanFeedText(t)
				}
			}
		case "item", "entry":
			var e feedEntry
			if err := dec.DecodeElement(&e, &start); err != nil {
				continue
			}
			if item, ok := newsItemFromEntry(e); ok && len(out.items) < newsItemsPerFeed {
				out.items = append(out.items, item)
			}
		}
	}
	if !sawRoot {
		return out, fmt.Errorf("not an RSS or Atom feed")
	}
	return out, nil
}

func newsItemFromEntry(e feedEntry) (NewsItem, bool) {
	title := cleanFeedText(e.Title)
	link := ""
	for _, l := range e.Links {
		if l.Href != "" && (l.Rel == "" || l.Rel == "alternate") {
			link = strings.TrimSpace(l.Href)
			break
		}
		if t := strings.TrimSpace(l.Text); t != "" && link == "" {
			link = t
		}
	}
	if title == "" || !isHTTPURL(link) {
		return NewsItem{}, false
	}

	// RSS <source> names the publisher; some feeds misuse it for photo
	// credits (its url then points at an image), which are ignored.
	source := ""
	if !newsImageURLRe.MatchString(e.Source.URL) {
		source = cleanFeedText(e.Source.Text)
	}
	// Aggregators like Google News append " - <Publisher>" to the title
	if source != "" {
		title = strings.TrimSpace(strings.TrimSuffix(title, " - "+source))
	} else {
		source = newsDomain(link)
	}

	summary := cleanFeedText(firstNonEmpty(e.Description, e.Summary))
	if utf8.RuneCountInString(summary) < newsMinSummary || strings.HasPrefix(summary, title) {
		summary = ""
	} else if utf8.RuneCountInString(summary) > newsSummaryRunes {
		summary = string([]rune(summary)[:newsSummaryRunes]) + "…"
	}

	item := NewsItem{Title: title, URL: link, Source: source, Summary: summary}
	if t, ok := parseFeedTime(firstNonEmpty(e.PubDate, e.Published, e.Date, e.Updated)); ok {
		item.PublishedMs = t.UnixNano() / int64(time.Millisecond)
	}
	return item, true
}

// cleanFeedText strips HTML tags and entities and collapses whitespace.
func cleanFeedText(s string) string {
	s = html.UnescapeString(newsTagRe.ReplaceAllString(s, " "))
	return strings.TrimSpace(newsWhitespaceRe.ReplaceAllString(s, " "))
}

var feedTimeLayouts = []string{
	time.RFC1123Z,
	time.RFC1123,
	"Mon, 2 Jan 2006 15:04:05 -0700",
	"Mon, 2 Jan 2006 15:04:05 MST",
	"2 Jan 2006 15:04:05 -0700",
	time.RFC3339,
	"2006-01-02T15:04:05Z0700",
	"2006-01-02T15:04:05",
	"2006-01-02",
}

func parseFeedTime(raw string) (time.Time, bool) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return time.Time{}, false
	}
	for _, layout := range feedTimeLayouts {
		if t, err := time.Parse(layout, raw); err == nil {
			return t, true
		}
	}
	return time.Time{}, false
}

func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if strings.TrimSpace(v) != "" {
			return v
		}
	}
	return ""
}

func newsDomain(raw string) string {
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" {
		return ""
	}
	return strings.TrimPrefix(strings.ToLower(u.Host), "www.")
}

func writeNewsError(w http.ResponseWriter, status int, message string) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": message})
}
