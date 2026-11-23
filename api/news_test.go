package handler

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

const testBBCRSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/"><channel><title>BBC Chinese</title>
<item>
  <title><![CDATA[分析：APEC上與習近平、特朗普歷史性會晤]]></title>
  <description><![CDATA[這並不會讓他離贏得烏克蘭戰爭更近一步。]]></description>
  <link>https://www.bbc.com/zhongwen/articles/cq702kdw845ro/trad?at_medium=RSS&amp;at_campaign=rss</link>
  <pubDate>Sun, 22 Nov 2026 03:46:29 GMT</pubDate>
</item>
<item>
  <title><![CDATA[凱特王妃談癌症如何改變了她]]></title>
  <link>https://www.bbc.com/zhongwen/articles/abc123/trad</link>
</item>
</channel></rss>`

const testGitHubTrending = `<html><body>
<article class="Box-row">
  <h2 class="h3 lh-condensed">
    <a data-hydro-click="{}" href="/obra/superpowers" data-view-component="true" class="Link">
      <span class="text-normal">obra /</span> superpowers</a>
  </h2>
  <p class="col-9 color-fg-muted my-1 tmp-pr-4">
    An agentic skills framework &amp; software development methodology.
  </p>
  <div class="f6 color-fg-muted mt-2">
    <span class="repo-language-color" style="background-color: #89e051"></span>
    <span itemprop="programmingLanguage">Shell</span>
    <a href="/obra/superpowers/stargazers" class="Link">
        <svg aria-hidden="true" class="octicon octicon-star"><path d="M8 .25a.75.75 0 0 1 .673.418"></path></svg>
        324,151</a>
    <a href="/obra/superpowers/forks" class="Link">
        28,758</a>
    <span class="d-inline-block float-sm-right">788 stars today</span>
  </div>
</article>
<article class="Box-row">
  <h2 class="h3 lh-condensed"><a href="/acme/no-desc" class="Link">acme / no-desc</a></h2>
  <a href="/acme/no-desc/stargazers" class="Link"> 1,024</a>
  <span>12 stars today</span>
</article>
</body></html>`

const testOnThisDay = `{"selected":[
  {"year":1963,"text":"John F. Kennedy was assassinated in Dallas.","pages":[{"titles":{"normalized":"Assassination of John F. Kennedy"},"extract":"On November 22, 1963...","content_urls":{"desktop":{"page":"https://en.wikipedia.org/wiki/Assassination_of_John_F._Kennedy"}}}]},
  {"year":1995,"text":"Toy Story was released in theaters.","pages":[{"titles":{"normalized":"Toy Story"},"content_urls":{"desktop":{"page":"https://en.wikipedia.org/wiki/Toy_Story"}}}]}
]}`

func resetNewsCache() {
	newsCacheMu.Lock()
	newsCache = map[string]newsCacheEntry{}
	newsCacheMu.Unlock()
}

func newsTestResponse(status int, body string) *http.Response {
	return &http.Response{StatusCode: status, Body: io.NopCloser(bytes.NewBufferString(body)), Header: http.Header{}}
}

func TestNewsHandlerAggregatesSources(t *testing.T) {
	origClient := newsHTTPClient
	newsHTTPClient = &http.Client{
		Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
			if ua := r.Header.Get("User-Agent"); !strings.HasPrefix(ua, "glance-dashboard/") {
				t.Errorf("expected glance User-Agent, got %q", ua)
			}
			u := r.URL.String()
			switch {
			case u == hnTopStoriesURL:
				return newsTestResponse(200, `[101, 102, 103]`), nil
			case strings.HasSuffix(u, "/item/101.json"):
				return newsTestResponse(200, `{"id":101,"type":"story","title":"Show HN: A wall dashboard","url":"https://www.example.com/post","score":321,"by":"pg","time":1795389130,"descendants":42}`), nil
			case strings.HasSuffix(u, "/item/102.json"):
				return newsTestResponse(200, `{"id":102,"type":"job","title":"We're hiring"}`), nil
			case strings.HasSuffix(u, "/item/103.json"):
				return newsTestResponse(200, `{"id":103,"type":"story","title":"Ask HN: Favorite tools?","score":12,"by":"dang","time":1795389000}`), nil
			case u == bbcChineseRSSURL:
				return newsTestResponse(200, testBBCRSS), nil
			case u == githubTrendingURL:
				return newsTestResponse(200, testGitHubTrending), nil
			case strings.Contains(u, "/feed/onthisday/selected/"):
				return newsTestResponse(200, testOnThisDay), nil
			}
			t.Errorf("unexpected request %s", u)
			return newsTestResponse(404, ""), nil
		}),
	}
	resetNewsCache()
	defer func() {
		newsHTTPClient = origClient
		resetNewsCache()
	}()
	t.Setenv("GLANCE_PASSCODE", "")
	t.Setenv("VERCEL", "")

	rec := httptest.NewRecorder()
	NewsHandler(rec, httptest.NewRequest(http.MethodGet, "/api/news", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	var resp NewsResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("invalid json: %v", err)
	}
	if len(resp.Warnings) != 0 {
		t.Fatalf("unexpected warnings: %v", resp.Warnings)
	}

	// Hacker News: job items dropped, self posts link to the HN thread, order kept
	if len(resp.HN) != 2 || resp.HN[0].ID != 101 || resp.HN[1].ID != 103 {
		t.Fatalf("unexpected HN stories: %+v", resp.HN)
	}
	if resp.HN[0].Domain != "example.com" || resp.HN[0].Comments != 42 || resp.HN[0].TimeMs != 1795389130000 {
		t.Fatalf("unexpected HN story fields: %+v", resp.HN[0])
	}
	if resp.HN[1].URL != "https://news.ycombinator.com/item?id=103" {
		t.Fatalf("expected self post to link to HN, got %q", resp.HN[1].URL)
	}

	// BBC: Traditional converted to Simplified, links point at the simp edition
	if len(resp.BBC) != 2 {
		t.Fatalf("expected 2 BBC stories, got %+v", resp.BBC)
	}
	if resp.BBC[0].Title != "分析：APEC上与习近平、特朗普历史性会晤" || resp.BBC[0].Summary != "这并不会让他离赢得乌克兰战争更近一步。" {
		t.Fatalf("BBC text not converted to Simplified: %+v", resp.BBC[0])
	}
	if resp.BBC[0].URL != "https://www.bbc.com/zhongwen/articles/cq702kdw845ro/simp" || resp.BBC[0].PublishedMs == 0 {
		t.Fatalf("unexpected BBC link/date: %+v", resp.BBC[0])
	}

	// GitHub Trending scrape
	if len(resp.GitHub) != 2 {
		t.Fatalf("expected 2 repos, got %+v", resp.GitHub)
	}
	g := resp.GitHub[0]
	if g.Owner != "obra" || g.Name != "superpowers" || g.Language != "Shell" || g.LanguageColor != "#89e051" ||
		g.Stars != 324151 || g.StarsToday != 788 || g.Description != "An agentic skills framework & software development methodology." ||
		g.URL != "https://github.com/obra/superpowers" {
		t.Fatalf("unexpected repo: %+v", g)
	}
	if resp.GitHub[1].Stars != 1024 || resp.GitHub[1].StarsToday != 12 || resp.GitHub[1].Description != "" {
		t.Fatalf("unexpected second repo: %+v", resp.GitHub[1])
	}

	// Wikipedia: most recent first, with article link
	if len(resp.OnThisDay) != 2 || resp.OnThisDay[0].Year != 1995 || resp.OnThisDay[1].URL != "https://en.wikipedia.org/wiki/Assassination_of_John_F._Kennedy" {
		t.Fatalf("unexpected on-this-day events: %+v", resp.OnThisDay)
	}
}

func TestNewsHandlerPartialFailure(t *testing.T) {
	origClient := newsHTTPClient
	newsHTTPClient = &http.Client{
		Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
			if r.URL.String() == githubTrendingURL {
				return newsTestResponse(200, `<html>redesigned page</html>`), nil
			}
			if strings.Contains(r.URL.String(), "onthisday") {
				return newsTestResponse(200, testOnThisDay), nil
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

	rec := httptest.NewRecorder()
	NewsHandler(rec, httptest.NewRequest(http.MethodGet, "/api/news", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 even when sources fail, got %d", rec.Code)
	}
	var resp NewsResponse
	_ = json.Unmarshal(rec.Body.Bytes(), &resp)
	if len(resp.OnThisDay) != 2 || resp.HN == nil || len(resp.HN) != 0 || len(resp.BBC) != 0 || len(resp.GitHub) != 0 {
		t.Fatalf("expected only Wikipedia data, got %+v", resp)
	}
	if len(resp.Warnings) != 3 {
		t.Fatalf("expected 3 warnings (BBC, GitHub, Hacker News), got %v", resp.Warnings)
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
