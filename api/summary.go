package handler

import (
	"bytes"
	"encoding/json"
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
	"unicode"
	"unicode/utf8"

	"glance/auth"
)

// /api/summary?url=<article> returns a short TL;DR for a Headlines item.
//
// Only available when GEMINI_API_KEY is set: the article is fetched, its
// paragraph text extracted, and Gemini writes a 2-3 sentence TL;DR in the
// article's language. Without a key, or if anything fails, there is no TL;DR
// (the popover falls back to the feed's own summary). Only links that appear in the configured NEWS_FEEDS are summarized, so this
// endpoint can't be used as a general-purpose fetcher.
//
// Note: every helper for /api/summary lives in this file. Vercel treats each
// .go file in api/ as a serverless entrypoint, so helper-only files there break
// the build.

type SummaryResponse struct {
	URL   string `json:"url"`
	TLDR  string `json:"tldr,omitempty"`
	Error string `json:"error,omitempty"`
}

const (
	geminiURLFmt        = "https://generativelanguage.googleapis.com/v1beta/models/%s:generateContent"
	geminiDefaultModel  = "gemini-flash-lite-latest"
	summaryCacheTTL     = 24 * time.Hour
	summaryFailureTTL   = 10 * time.Minute
	articleMaxBytes     = 3 << 20
	articleMaxTextRunes = 6000
	minParagraphRunes   = 25
)

var (
	articleHTTPClient = &http.Client{Timeout: 8 * time.Second}
	geminiHTTPClient  = &http.Client{Timeout: 20 * time.Second}

	summaryCacheMu sync.Mutex
	summaryCache   = map[string]summaryCacheEntry{}

	articleCommentRe = regexp.MustCompile(`(?s)<!--.*?-->`)
	articleTitleRe   = regexp.MustCompile(`(?is)<title[^>]*>(.*?)</title>`)
	// "articleBody": "..." inside JSON-LD; the capture keeps the JSON string quotes
	articleJSONBodyRe = regexp.MustCompile(`"articleBody"\s*:\s*("(?:[^"\\]|\\.)*")`)
	articleDropRe     = regexp.MustCompile(`(?is)<(script|style|noscript|svg|nav|header|footer|aside|form|figure|button)\b[^>]*>.*?</(script|style|noscript|svg|nav|header|footer|aside|form|figure|button)>`)
	articleRegionRe   = regexp.MustCompile(`(?is)<article\b[^>]*>(.*?)</article>`)
	articlePRe        = regexp.MustCompile(`(?is)<p\b[^>]*>(.*?)</p>`)
	articleMetaRe     = regexp.MustCompile(`(?is)<meta\b[^>]*>`)
	articleAttrRe     = regexp.MustCompile(`(?is)\b(name|property|content|charset)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)`)
	contentCharsetRe  = regexp.MustCompile(`(?i)charset=["']?([\w-]+)`)
)

type summaryCacheEntry struct {
	at   time.Time
	resp SummaryResponse
}

// SummaryHandler serves GET /api/summary on Vercel (and locally via cmd/devserver).
func SummaryHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeNewsError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	if !auth.RequireAuth(w, r) {
		return
	}
	apiKey := geminiAPIKey()
	if apiKey == "" {
		writeNewsError(w, http.StatusNotFound, "TL;DR is disabled (GEMINI_API_KEY is not set)")
		return
	}
	articleURL := strings.TrimSpace(r.URL.Query().Get("url"))
	if !isHTTPURL(articleURL) {
		writeNewsError(w, http.StatusBadRequest, "invalid url")
		return
	}
	if !isConfiguredNewsItem(articleURL) {
		writeNewsError(w, http.StatusForbidden, "url is not an item in the configured news feeds")
		return
	}

	resp := summarizeCached(apiKey, articleURL)
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "private, no-store")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(resp)
}

// isConfiguredNewsItem reports whether articleURL is a link in one of the
// NEWS_FEEDS feeds, refreshing the (cached) feeds once if it isn't found, e.g.
// on a fresh serverless instance.
func isConfiguredNewsItem(articleURL string) bool {
	sources := parseNewsFeedsFromEnv()
	lookup := func() bool {
		newsCacheMu.Lock()
		defer newsCacheMu.Unlock()
		for _, src := range sources {
			entry, ok := newsCache[src.URL]
			if !ok || entry.value == nil {
				continue
			}
			for _, it := range entry.value.(parsedNewsFeed).items {
				if it.URL == articleURL {
					return true
				}
			}
		}
		return false
	}
	if lookup() {
		return true
	}
	for _, src := range sources {
		u := src.URL
		_, _ = cachedNews(u, newsCacheTTL, false, func() (interface{}, error) { return fetchNewsFeed(u) })
	}
	return lookup()
}

// geminiAPIKey returns GEMINI_API_KEY; TL;DRs are enabled only when it is set.
func geminiAPIKey() string {
	return strings.TrimSpace(os.Getenv("GEMINI_API_KEY"))
}

func summarizeCached(apiKey, articleURL string) SummaryResponse {
	summaryCacheMu.Lock()
	entry, ok := summaryCache[articleURL]
	summaryCacheMu.Unlock()
	if ok {
		ttl := summaryCacheTTL
		if entry.resp.TLDR == "" {
			ttl = summaryFailureTTL
		}
		if time.Since(entry.at) < ttl {
			return entry.resp
		}
	}
	resp := summarizeArticle(apiKey, articleURL)
	summaryCacheMu.Lock()
	summaryCache[articleURL] = summaryCacheEntry{at: time.Now(), resp: resp}
	summaryCacheMu.Unlock()
	return resp
}

func summarizeArticle(apiKey, articleURL string) SummaryResponse {
	resp := SummaryResponse{URL: articleURL}
	title, text, err := fetchArticleText(articleURL)
	if err != nil {
		resp.Error = err.Error()
		return resp
	}
	tldr, err := geminiTLDR(apiKey, title, text)
	if err != nil {
		resp.Error = err.Error()
		return resp
	}
	resp.TLDR = tldr
	return resp
}

// fetchArticleText returns the page title and its main paragraph text.
func fetchArticleText(articleURL string) (string, string, error) {
	req, err := http.NewRequest(http.MethodGet, articleURL, nil)
	if err != nil {
		return "", "", err
	}
	req.Header.Set("User-Agent", newsUserAgent)
	req.Header.Set("Accept", "text/html,application/xhtml+xml")
	res, err := articleHTTPClient.Do(req)
	if err != nil {
		return "", "", err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return "", "", fmt.Errorf("article HTTP %d", res.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(res.Body, articleMaxBytes))
	if err != nil {
		return "", "", err
	}
	if cs := declaredCharset(res.Header.Get("Content-Type"), body); cs != "" && cs != "utf-8" && cs != "utf8" {
		return "", "", fmt.Errorf("unsupported charset %s", cs)
	}
	title, text := extractArticle(string(body))
	if text == "" {
		// Describe what came back (e.g. a bot-check page served with HTTP 200)
		return "", "", fmt.Errorf("no article text found (HTTP %d, %s, page title %q)",
			res.StatusCode, formatByteSize(len(body)), pageTitle(string(body)))
	}
	return title, text, nil
}

func formatByteSize(n int) string {
	if n < 1024 {
		return fmt.Sprintf("%d B", n)
	}
	return fmt.Sprintf("%d KB", (n+512)/1024)
}

// pageTitle returns the page's <title>, shortened, for error messages.
func pageTitle(page string) string {
	m := articleTitleRe.FindStringSubmatch(page)
	if m == nil {
		return ""
	}
	t := cleanFeedText(m[1])
	if r := []rune(t); len(r) > 60 {
		t = string(r[:60]) + "…"
	}
	return t
}

func declaredCharset(contentType string, body []byte) string {
	if m := contentCharsetRe.FindStringSubmatch(contentType); m != nil {
		return strings.ToLower(m[1])
	}
	head := body
	if len(head) > 4096 {
		head = head[:4096]
	}
	if m := contentCharsetRe.FindSubmatch(head); m != nil {
		return strings.ToLower(string(m[1]))
	}
	return ""
}

// extractArticle pulls sentence-like paragraphs from the page (preferring the
// <article> element), falling back to the meta description.
func extractArticle(page string) (string, string) {
	title, description := articleMeta(page)
	cleaned := articleDropRe.ReplaceAllString(articleCommentRe.ReplaceAllString(page, " "), " ")

	paragraphs := articleParagraphs(cleaned)
	if m := articleRegionRe.FindStringSubmatch(cleaned); m != nil {
		if inArticle := articleParagraphs(m[1]); len(inArticle) >= 2 {
			paragraphs = inArticle
		}
	}
	var b strings.Builder
	for _, p := range paragraphs {
		if utf8.RuneCountInString(b.String())+utf8.RuneCountInString(p) > articleMaxTextRunes {
			break
		}
		b.WriteString(p)
		b.WriteString("\n")
	}
	text := strings.TrimSpace(b.String())
	if text == "" {
		text = jsonLDArticleBody(page)
	}
	if text == "" {
		text = description
	}
	return title, text
}

// jsonLDArticleBody returns schema.org "articleBody" text from JSON-LD, which
// many news sites embed for search engines (a generic fallback when the
// visible paragraphs can't be found).
func jsonLDArticleBody(page string) string {
	for _, m := range articleJSONBodyRe.FindAllStringSubmatch(page, -1) {
		var body string
		if json.Unmarshal([]byte(m[1]), &body) != nil {
			continue
		}
		body = cleanFeedText(body)
		if utf8.RuneCountInString(body) >= minParagraphRunes {
			if r := []rune(body); len(r) > articleMaxTextRunes {
				body = string(r[:articleMaxTextRunes])
			}
			return body
		}
	}
	return ""
}

func articleParagraphs(fragment string) []string {
	var out []string
	for _, m := range articlePRe.FindAllStringSubmatch(fragment, -1) {
		p := cleanFeedText(m[1])
		if utf8.RuneCountInString(p) < minParagraphRunes || !hasSentenceEnd(p) {
			continue
		}
		out = append(out, p)
	}
	return out
}

func hasSentenceEnd(p string) bool {
	return strings.ContainsAny(p, ".!?。！？")
}

// articleMeta returns og:title/<title> and og:description/description.
func articleMeta(page string) (string, string) {
	var title, desc string
	for _, tag := range articleMetaRe.FindAllString(page, -1) {
		attrs := map[string]string{}
		for _, a := range articleAttrRe.FindAllStringSubmatch(tag, -1) {
			attrs[strings.ToLower(a[1])] = strings.Trim(a[2], `"'`)
		}
		key := strings.ToLower(attrs["property"] + attrs["name"])
		switch key {
		case "og:title":
			if title == "" {
				title = cleanFeedText(attrs["content"])
			}
		case "og:description", "description":
			if desc == "" {
				desc = cleanFeedText(attrs["content"])
			}
		}
	}
	return title, desc
}

// isMostlyChinese reports whether Han characters make up a large share of the
// letters in the text's opening.
func isMostlyChinese(text string) bool {
	han, letters := 0, 0
	for i, r := range text {
		if i > 4000 {
			break
		}
		if unicode.Is(unicode.Han, r) {
			han++
			letters++
		} else if unicode.IsLetter(r) {
			letters++
		}
	}
	return letters > 0 && han*100/letters >= 30
}

// geminiTLDR asks Gemini for a 2-3 sentence TL;DR in the article's language.
func geminiTLDR(apiKey, title, text string) (string, error) {
	model := strings.TrimSpace(os.Getenv("GEMINI_MODEL"))
	if model == "" {
		model = geminiDefaultModel
	}
	// Name the output language explicitly: asking for "the article's language"
	// while mentioning Chinese made the model answer English articles in Chinese.
	language := "Write it in the same language as the article."
	if isMostlyChinese(text) {
		language = "Write it in Simplified Chinese."
	}
	prompt := "Write a TL;DR of this news article in 2-3 short sentences. " + language + " " +
		"Plain text only: no preamble, no markdown, no bullet points.\n\n" +
		"Title: " + title + "\n\nArticle:\n" + text
	payload, _ := json.Marshal(map[string]interface{}{
		"contents": []map[string]interface{}{
			{"role": "user", "parts": []map[string]string{{"text": prompt}}},
		},
		"generationConfig": map[string]interface{}{
			"temperature":     0.2,
			"maxOutputTokens": 1024,
		},
	})
	req, err := http.NewRequest(http.MethodPost, fmt.Sprintf(geminiURLFmt, url.PathEscape(model)), bytes.NewReader(payload))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("x-goog-api-key", apiKey)
	res, err := geminiHTTPClient.Do(req)
	if err != nil {
		return "", err
	}
	defer res.Body.Close()
	body, err := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	if err != nil {
		return "", err
	}
	var out struct {
		Candidates []struct {
			Content struct {
				Parts []struct {
					Text    string `json:"text"`
					Thought bool   `json:"thought"`
				} `json:"parts"`
			} `json:"content"`
		} `json:"candidates"`
		Error *struct {
			Message string `json:"message"`
		} `json:"error"`
	}
	if err := json.Unmarshal(body, &out); err != nil {
		return "", fmt.Errorf("gemini: %v", err)
	}
	if res.StatusCode != http.StatusOK || out.Error != nil {
		msg := fmt.Sprintf("HTTP %d", res.StatusCode)
		if out.Error != nil {
			msg = out.Error.Message
		}
		return "", fmt.Errorf("gemini: %s", msg)
	}
	var b strings.Builder
	if len(out.Candidates) > 0 {
		for _, p := range out.Candidates[0].Content.Parts {
			if !p.Thought {
				b.WriteString(p.Text)
			}
		}
	}
	tldr := strings.TrimSpace(html.UnescapeString(b.String()))
	if tldr == "" {
		return "", fmt.Errorf("gemini: empty response")
	}
	return tldr, nil
}
