package handler

import (
	"encoding/json"
	"encoding/xml"
	"fmt"
	"html"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"glance/auth"
	"glance/config"
	"glance/zhconv"
)

// Note: every helper for /api/news lives in this file. Vercel treats each .go
// file in api/ as a serverless entrypoint, so helper-only files there break
// the build.

type HNStory struct {
	ID       int    `json:"id"`
	Title    string `json:"title"`
	URL      string `json:"url"`
	Domain   string `json:"domain,omitempty"`
	Score    int    `json:"score"`
	Comments int    `json:"comments"`
	By       string `json:"by"`
	TimeMs   int64  `json:"timeMs"`
	HNURL    string `json:"hnUrl"`
}

type BBCStory struct {
	Title       string `json:"title"`
	Summary     string `json:"summary,omitempty"`
	URL         string `json:"url"`
	PublishedMs int64  `json:"publishedMs,omitempty"`
}

type GitHubRepo struct {
	Owner         string `json:"owner"`
	Name          string `json:"name"`
	Description   string `json:"description,omitempty"`
	Language      string `json:"language,omitempty"`
	LanguageColor string `json:"languageColor,omitempty"`
	Stars         int    `json:"stars"`
	StarsToday    int    `json:"starsToday"`
	URL           string `json:"url"`
}

type NewsResponse struct {
	FetchedAt string       `json:"fetchedAt"`
	Date      string       `json:"date"` // YYYY-MM-DD in the Home city's timezone
	HN        []HNStory    `json:"hn"`
	BBC       []BBCStory   `json:"bbc"`
	GitHub    []GitHubRepo `json:"github"`
	Warnings  []string     `json:"warnings,omitempty"`
}

const (
	hnTopStoriesURL   = "https://hacker-news.firebaseio.com/v0/topstories.json"
	hnItemURLFmt      = "https://hacker-news.firebaseio.com/v0/item/%d.json"
	bbcChineseRSSURL  = "https://feeds.bbci.co.uk/zhongwen/trad/rss.xml"
	githubTrendingURL = "https://github.com/trending"
	newsUserAgent     = "glance-dashboard/1.0 (personal wall dashboard)"

	newsCacheTTL    = 15 * time.Minute
	hnStoryCount    = 12
	bbcStoryCount   = 12
	githubRepoCount = 12
)

var (
	newsHTTPClient = &http.Client{Timeout: 8 * time.Second}

	newsCacheMu sync.Mutex
	newsCache   = map[string]newsCacheEntry{}
)

type newsCacheEntry struct {
	fetchedAt time.Time
	value     interface{}
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

	cfg, _, isDevDisk, err := config.LoadNormalizedConfig()
	if err != nil {
		writeNewsError(w, http.StatusInternalServerError, fmt.Sprintf("invalid config: %v", err))
		return
	}
	tzName := "America/Los_Angeles"
	if len(cfg.Cities) > 0 && strings.TrimSpace(cfg.Cities[0].Timezone) != "" {
		tzName = cfg.Cities[0].Timezone
	}
	today := time.Now().In(loadTimezoneSafe(tzName))
	forceRefresh := r.URL.Query().Get("refresh") == "1"

	resp := NewsResponse{
		FetchedAt: time.Now().UTC().Format(time.RFC3339),
		Date:      today.Format("2006-01-02"),
		HN:        []HNStory{},
		BBC:       []BBCStory{},
		GitHub:    []GitHubRepo{},
	}

	var (
		wg sync.WaitGroup
		mu sync.Mutex
	)
	warn := func(source string, err error) {
		mu.Lock()
		resp.Warnings = append(resp.Warnings, fmt.Sprintf("%s: %v", source, err))
		mu.Unlock()
	}
	wg.Add(3)
	go func() {
		defer wg.Done()
		v, err := cachedNews("hn", newsCacheTTL, forceRefresh, func() (interface{}, error) { return fetchHNStories() })
		if err != nil {
			warn("Hacker News", err)
			return
		}
		resp.HN = v.([]HNStory)
	}()
	go func() {
		defer wg.Done()
		v, err := cachedNews("bbc", newsCacheTTL, forceRefresh, func() (interface{}, error) { return fetchBBCChinese() })
		if err != nil {
			warn("BBC", err)
			return
		}
		resp.BBC = v.([]BBCStory)
	}()
	go func() {
		defer wg.Done()
		v, err := cachedNews("github", newsCacheTTL, forceRefresh, func() (interface{}, error) { return fetchGitHubTrending() })
		if err != nil {
			warn("GitHub", err)
			return
		}
		resp.GitHub = v.([]GitHubRepo)
	}()
	wg.Wait()
	sort.Strings(resp.Warnings)

	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	if isDevDisk || auth.IsRequired() {
		w.Header().Set("Cache-Control", "private, no-store")
	} else {
		w.Header().Set("Cache-Control", "public, s-maxage=600, stale-while-revalidate=600")
	}
	w.WriteHeader(http.StatusOK)
	if r.Method == http.MethodHead {
		return
	}
	_ = json.NewEncoder(w).Encode(resp)
}

// cachedNews returns a fresh cached value, or calls fetch and caches its result.
// On fetch failure a stale cached value is preferred over an error.
func cachedNews(key string, ttl time.Duration, force bool, fetch func() (interface{}, error)) (interface{}, error) {
	newsCacheMu.Lock()
	entry, ok := newsCache[key]
	newsCacheMu.Unlock()
	if ok && !force && time.Since(entry.fetchedAt) < ttl {
		return entry.value, nil
	}
	v, err := fetch()
	if err != nil {
		if ok {
			return entry.value, nil
		}
		return nil, err
	}
	newsCacheMu.Lock()
	newsCache[key] = newsCacheEntry{fetchedAt: time.Now(), value: v}
	newsCacheMu.Unlock()
	return v, nil
}

func newsGet(rawURL string, accept string) ([]byte, error) {
	req, err := http.NewRequest(http.MethodGet, rawURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", newsUserAgent)
	if accept != "" {
		req.Header.Set("Accept", accept)
	}
	res, err := newsHTTPClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("HTTP %d", res.StatusCode)
	}
	return io.ReadAll(io.LimitReader(res.Body, 4<<20))
}

// --- Hacker News -------------------------------------------------------------

func fetchHNStories() ([]HNStory, error) {
	body, err := newsGet(hnTopStoriesURL, "application/json")
	if err != nil {
		return nil, err
	}
	var ids []int
	if err := json.Unmarshal(body, &ids); err != nil {
		return nil, err
	}
	if len(ids) > hnStoryCount+6 {
		ids = ids[:hnStoryCount+6] // a few spares for dead/job items
	}

	stories := make([]*HNStory, len(ids))
	var wg sync.WaitGroup
	for i, id := range ids {
		wg.Add(1)
		go func(i, id int) {
			defer wg.Done()
			b, err := newsGet(fmt.Sprintf(hnItemURLFmt, id), "application/json")
			if err != nil {
				return
			}
			var item struct {
				ID          int    `json:"id"`
				Type        string `json:"type"`
				Title       string `json:"title"`
				URL         string `json:"url"`
				Score       int    `json:"score"`
				By          string `json:"by"`
				Time        int64  `json:"time"`
				Descendants int    `json:"descendants"`
				Dead        bool   `json:"dead"`
				Deleted     bool   `json:"deleted"`
			}
			if json.Unmarshal(b, &item) != nil || item.Dead || item.Deleted || item.Type != "story" || item.Title == "" {
				return
			}
			hnURL := fmt.Sprintf("https://news.ycombinator.com/item?id=%d", item.ID)
			link := item.URL
			if link == "" {
				link = hnURL
			}
			stories[i] = &HNStory{
				ID:       item.ID,
				Title:    item.Title,
				URL:      link,
				Domain:   storyDomain(item.URL),
				Score:    item.Score,
				Comments: item.Descendants,
				By:       item.By,
				TimeMs:   item.Time * 1000,
				HNURL:    hnURL,
			}
		}(i, id)
	}
	wg.Wait()

	out := make([]HNStory, 0, hnStoryCount)
	for _, s := range stories {
		if s != nil && len(out) < hnStoryCount {
			out = append(out, *s)
		}
	}
	if len(out) == 0 {
		return nil, fmt.Errorf("no stories")
	}
	return out, nil
}

func storyDomain(raw string) string {
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" {
		return ""
	}
	return strings.TrimPrefix(strings.ToLower(u.Host), "www.")
}

// --- BBC News 中文 -------------------------------------------------------------

// fetchBBCChinese reads the Traditional Chinese RSS feed (the Simplified feed
// URLs all redirect to it) and converts titles and summaries to Simplified.
func fetchBBCChinese() ([]BBCStory, error) {
	body, err := newsGet(bbcChineseRSSURL, "application/rss+xml, application/xml")
	if err != nil {
		return nil, err
	}
	stories, err := parseBBCRSS(body)
	if err != nil {
		return nil, err
	}
	if len(stories) == 0 {
		return nil, fmt.Errorf("no stories")
	}
	return stories, nil
}

func parseBBCRSS(body []byte) ([]BBCStory, error) {
	var feed struct {
		Items []struct {
			Title       string `xml:"title"`
			Description string `xml:"description"`
			Link        string `xml:"link"`
			PubDate     string `xml:"pubDate"`
		} `xml:"channel>item"`
	}
	if err := xml.Unmarshal(body, &feed); err != nil {
		return nil, err
	}
	out := make([]BBCStory, 0, bbcStoryCount)
	for _, it := range feed.Items {
		title := strings.TrimSpace(it.Title)
		if title == "" {
			continue
		}
		s := BBCStory{
			Title:   zhconv.ToSimplified(title),
			Summary: zhconv.ToSimplified(strings.TrimSpace(it.Description)),
			URL:     bbcSimplifiedURL(it.Link),
		}
		if t, err := time.Parse(time.RFC1123, strings.TrimSpace(it.PubDate)); err == nil {
			s.PublishedMs = t.UnixNano() / int64(time.Millisecond)
		}
		out = append(out, s)
		if len(out) >= bbcStoryCount {
			break
		}
	}
	return out, nil
}

// bbcSimplifiedURL drops RSS tracking params and points the article at its
// Simplified Chinese edition (".../articles/<id>/trad" -> ".../simp").
func bbcSimplifiedURL(raw string) string {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil {
		return strings.TrimSpace(raw)
	}
	u.RawQuery = ""
	u.Fragment = ""
	if strings.HasSuffix(u.Path, "/trad") {
		u.Path = strings.TrimSuffix(u.Path, "/trad") + "/simp"
	}
	u.Path = strings.Replace(u.Path, "/zhongwen/trad/", "/zhongwen/simp/", 1)
	return u.String()
}

// --- GitHub Trending ---------------------------------------------------------

var (
	ghArticleRe    = regexp.MustCompile(`(?s)<article class="Box-row">(.*?)</article>`)
	ghRepoHrefRe   = regexp.MustCompile(`(?s)<h2[^>]*>\s*<a[^>]*\shref="/([^/"]+)/([^/"]+)"`)
	ghDescRe       = regexp.MustCompile(`(?s)<p class="col-9[^"]*">(.*?)</p>`)
	ghLangRe       = regexp.MustCompile(`itemprop="programmingLanguage">([^<]+)<`)
	ghLangColorRe  = regexp.MustCompile(`repo-language-color" style="background-color: (#[0-9a-fA-F]{3,8})"`)
	ghStarsTodayRe = regexp.MustCompile(`([\d,]+) stars today`)
	ghTagRe        = regexp.MustCompile(`<[^>]+>`)
	ghWhitespaceRe = regexp.MustCompile(`\s+`)
)

// fetchGitHubTrending scrapes github.com/trending (there is no official API).
func fetchGitHubTrending() ([]GitHubRepo, error) {
	body, err := newsGet(githubTrendingURL, "text/html")
	if err != nil {
		return nil, err
	}
	repos := parseGitHubTrending(string(body))
	if len(repos) == 0 {
		return nil, fmt.Errorf("no repositories found (page layout may have changed)")
	}
	return repos, nil
}

func parseGitHubTrending(page string) []GitHubRepo {
	out := make([]GitHubRepo, 0, githubRepoCount)
	for _, m := range ghArticleRe.FindAllStringSubmatch(page, -1) {
		block := m[1]
		href := ghRepoHrefRe.FindStringSubmatch(block)
		if href == nil {
			continue
		}
		owner, name := href[1], href[2]
		repo := GitHubRepo{
			Owner: owner,
			Name:  name,
			URL:   "https://github.com/" + owner + "/" + name,
		}
		if d := ghDescRe.FindStringSubmatch(block); d != nil {
			repo.Description = cleanHTMLText(d[1])
		}
		if l := ghLangRe.FindStringSubmatch(block); l != nil {
			repo.Language = cleanHTMLText(l[1])
		}
		if c := ghLangColorRe.FindStringSubmatch(block); c != nil {
			repo.LanguageColor = c[1]
		}
		starsRe := regexp.MustCompile(`href="/` + regexp.QuoteMeta(owner) + `/` + regexp.QuoteMeta(name) + `/stargazers"[^>]*>(?s)(.*?)</a>`)
		if s := starsRe.FindStringSubmatch(block); s != nil {
			// The link wraps an SVG star icon before the count
			repo.Stars = parseCommaInt(cleanHTMLText(s[1]))
		}
		if s := ghStarsTodayRe.FindStringSubmatch(block); s != nil {
			repo.StarsToday = parseCommaInt(s[1])
		}
		out = append(out, repo)
		if len(out) >= githubRepoCount {
			break
		}
	}
	return out
}

func cleanHTMLText(s string) string {
	s = ghTagRe.ReplaceAllString(s, "")
	s = html.UnescapeString(s)
	return strings.TrimSpace(ghWhitespaceRe.ReplaceAllString(s, " "))
}

func parseCommaInt(s string) int {
	n, _ := strconv.Atoi(strings.ReplaceAll(strings.TrimSpace(s), ",", ""))
	return n
}

func writeNewsError(w http.ResponseWriter, status int, message string) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": message})
}
