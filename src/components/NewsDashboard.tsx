import { useEffect, useRef, useState } from 'preact/hooks';
import type { NewsFeed, NewsItem, NewsResponse } from '../types';
import { QRCode } from './QRCode';

export var NEWS_STORAGE_KEY = 'glance:lastNews:v2';
var NEWS_POLL_MS = 15 * 60 * 1000;
var POPOVER_AUTO_CLOSE_MS = 90 * 1000;

// Column accent colors, cycled by feed position
var FEED_ACCENTS = ['#ff6600', '#38bdf8', '#818cf8', '#34d399'];

var CJK_RE = /[㐀-鿿]/;

interface NewsDashboardProps {
  isActive: boolean;
  preload?: boolean;
  nowMs: number;
  isRefreshing: boolean;
  onRefresh: () => void;
  onUnauthorized?: () => void;
}

// AI TL;DR for the item in the popover, from /api/summary (only when the
// server has a GEMINI_API_KEY; otherwise no TL;DR is shown at all)
interface Tldr {
  url: string;
  status: 'loading' | 'ok' | 'none';
  text?: string;
  reason?: string; // why there is no TL;DR (server error or HTTP status)
}

// What the QR popover shows for a tapped item
interface NewsDetail {
  feedName: string;
  accent: string;
  item: NewsItem;
}

function readCachedNews(): NewsResponse | null {
  try {
    // Cache from the pre-RSS Headlines format; no longer readable
    window.localStorage.removeItem('glance:lastNews:v1');
    var raw = window.localStorage.getItem(NEWS_STORAGE_KEY);
    if (!raw) return null;
    var parsed = JSON.parse(raw) as NewsResponse;
    if (parsed && parsed.feeds && parsed.feeds.length > 0) {
      return parsed;
    }
  } catch (_err) {
    // Ignore storage errors
  }
  return null;
}

function writeCachedNews(data: NewsResponse): void {
  try {
    window.localStorage.setItem(NEWS_STORAGE_KEY, JSON.stringify(data));
  } catch (_err) {
    // Ignore storage errors
  }
}

function formatAgo(timeMs: number, nowMs: number): string {
  var mins = Math.max(0, Math.round((nowMs - timeMs) / 60000));
  if (mins < 60) return String(Math.max(1, mins)) + 'm ago';
  var hrs = Math.floor(mins / 60);
  if (hrs < 24) return String(hrs) + 'h ago';
  return String(Math.floor(hrs / 24)) + 'd ago';
}

function formatHeaderDate(dateKey: string): string {
  var parts = (dateKey || '').split('-');
  if (parts.length !== 3) return '';
  var months = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];
  var m = parseInt(parts[1], 10);
  var d = parseInt(parts[2], 10);
  if (!(m >= 1 && m <= 12) || !(d >= 1)) return '';
  return months[m - 1] + ' ' + String(d);
}

// Readable link text (decodes percent-encoded non-ASCII paths);
// the QR code keeps the encoded URL.
function shortURL(url: string): string {
  var text = url;
  try {
    text = decodeURIComponent(url);
  } catch (_err) {
    // Leave malformed escapes as-is
  }
  return text.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');
}

export function NewsDashboard(props: NewsDashboardProps) {
  var _dataState = useState<NewsResponse | null>(function () {
    return readCachedNews();
  });
  var data = _dataState[0];
  var setData = _dataState[1];

  var _errorState = useState<string | null>(null);
  var loadError = _errorState[0];
  var setLoadError = _errorState[1];

  var _detailState = useState<NewsDetail | null>(null);
  var detail = _detailState[0];
  var setDetail = _detailState[1];

  var _tldrState = useState<Tldr | null>(null);
  var tldr = _tldrState[0];
  var setTldr = _tldrState[1];
  var tldrCacheRef = useRef<{ [url: string]: Tldr }>({});

  var tldrEnabled = Boolean(data && data.tldr);

  // Fetch (or reuse) the TL;DR whenever a popover opens
  useEffect(
    function () {
      if (!detail || !tldrEnabled) {
        setTldr(null);
        return;
      }
      var url = detail.item.url;
      var cached = tldrCacheRef.current[url];
      if (cached) {
        setTldr(cached);
        return;
      }
      var cancelled = false;
      setTldr({ url: url, status: 'loading' });
      fetch('/api/summary?url=' + encodeURIComponent(url), { credentials: 'same-origin' })
        .then(function (resp) {
          // Error responses also carry a JSON {error}; keep it to explain the failure
          return resp.json().then(
            function (json: { tldr?: string; error?: string }) {
              return json;
            },
            function () {
              return { error: 'HTTP ' + String(resp.status) };
            }
          );
        })
        .then(function (json: { tldr?: string; error?: string }) {
          var result: Tldr = json.tldr
            ? { url: url, status: 'ok', text: json.tldr }
            : { url: url, status: 'none', reason: json.error || 'no summary returned' };
          tldrCacheRef.current[url] = result;
          if (!cancelled) setTldr(result);
        })
        .catch(function () {
          // Network failure: don't cache, so reopening the item retries
          if (!cancelled) setTldr({ url: url, status: 'none', reason: 'network error' });
        });
      return function () {
        cancelled = true;
      };
    },
    [detail, tldrEnabled]
  );

  var hasPreloadedRef = useRef<boolean>(false);
  var lastFetchMsRef = useRef<number>(0);
  var pollTimerRef = useRef<number | null>(null);

  function fetchNews() {
    return fetch('/api/news', { cache: 'no-cache', credentials: 'same-origin' })
      .then(function (resp) {
        if (resp.status === 401) {
          if (props.onUnauthorized) props.onUnauthorized();
          return null;
        }
        if (!resp.ok) {
          throw new Error('HTTP ' + String(resp.status));
        }
        return resp.json();
      })
      .then(function (json: NewsResponse | null) {
        if (!json) return json;
        lastFetchMsRef.current = Date.now();
        setData(json);
        setLoadError(null);
        writeCachedNews(json);
        return json;
      })
      .catch(function (err) {
        setLoadError(err && err.message ? String(err.message) : 'Network error');
        return null;
      });
  }

  // Quiet preload while inactive after boot
  useEffect(
    function () {
      if (!props.preload || props.isActive || hasPreloadedRef.current) return;
      hasPreloadedRef.current = true;
      fetchNews();
    },
    [props.preload, props.isActive]
  );

  // Fetch on visit + poll every 15 min while active
  useEffect(
    function () {
      if (!props.isActive) {
        if (pollTimerRef.current !== null) {
          window.clearTimeout(pollTimerRef.current);
          pollTimerRef.current = null;
        }
        return;
      }
      var cancelled = false;
      function schedulePoll() {
        if (cancelled) return;
        if (pollTimerRef.current !== null) {
          window.clearTimeout(pollTimerRef.current);
        }
        pollTimerRef.current = window.setTimeout(function () {
          fetchNews().then(schedulePoll);
        }, NEWS_POLL_MS);
      }
      if (lastFetchMsRef.current > 0 && Date.now() - lastFetchMsRef.current < 5 * 60 * 1000) {
        schedulePoll();
      } else {
        fetchNews().then(schedulePoll);
      }
      return function () {
        cancelled = true;
        if (pollTimerRef.current !== null) {
          window.clearTimeout(pollTimerRef.current);
          pollTimerRef.current = null;
        }
      };
    },
    [props.isActive]
  );

  // Close the QR popover when leaving the slide, or after a while untouched
  useEffect(
    function () {
      if (!detail) return;
      if (!props.isActive) {
        setDetail(null);
        return;
      }
      var id = window.setTimeout(function () {
        setDetail(null);
      }, POPOVER_AUTO_CLOSE_MS);
      return function () {
        window.clearTimeout(id);
      };
    },
    [detail, props.isActive]
  );

  var feeds: NewsFeed[] = data ? data.feeds : [];
  var nowMs = props.nowMs;
  var dateLabel = data ? formatHeaderDate(data.date) : '';
  var notConfigured = Boolean(data && !data.configured);
  // One equal-width column per feed
  var columnWidth = 'calc(' + String(100 / Math.max(1, feeds.length)) + '% - 12px)';

  return (
    <div class="news-slide">
      <div class="news-backdrop" aria-hidden="true" />

      <div class="dashboard-content news-content">
        <header class="news-header">
          <div class="news-header-left">
            <h1 class="news-title">Headlines</h1>
            {dateLabel ? <span class="news-date-tag">{dateLabel}</span> : null}
          </div>
          <div class="news-header-center">
            <div class="top-controls" role="toolbar" aria-label="Headlines controls">
              <button
                type="button"
                class="ctrl-btn ctrl-btn-icon"
                onClick={props.onRefresh}
                disabled={props.isRefreshing}
                title="Hard reload & clear cache"
                aria-label="Hard reload and clear cache"
              >
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2.1"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  class={props.isRefreshing ? 'ctrl-svg ctrl-spinning' : 'ctrl-svg'}
                  aria-hidden="true"
                >
                  <path d="M21 12a9 9 0 1 1-2.64-6.36" />
                  <polyline points="21 3 21 9 15 9" />
                </svg>
              </button>
            </div>
          </div>
          <div class="news-header-right">
            {data && data.fetchedAt ? (
              <span class="news-updated">
                Updated {formatAgo(new Date(data.fetchedAt).getTime(), nowMs)}
              </span>
            ) : null}
          </div>
        </header>

        {notConfigured ? (
          <div class="news-setup">
            <div class="news-setup-title">No news feeds configured</div>
            <div class="news-setup-hint">
              Set <code>NEWS_FEEDS</code> in Vercel Env Vars (or .env.local) to a JSON list of RSS
              feeds, e.g. <code>[{'{'}"name":"Hacker News","url":"https://news.ycombinator.com/rss"{'}'}]</code>
            </div>
          </div>
        ) : feeds.length === 0 ? (
          <div class="news-setup">
            <div class="news-setup-hint">{loadError ? 'Unavailable · ' + loadError : 'Loading…'}</div>
          </div>
        ) : (
          <div class="news-grid">
            {feeds.map(function (feed, feedIdx) {
              var accent = FEED_ACCENTS[feedIdx % FEED_ACCENTS.length];
              return (
                <section
                  key={'feed-' + String(feedIdx) + '-' + feed.url}
                  class="news-card"
                  style={{ width: columnWidth }}
                  aria-label={feed.name}
                >
                  <div class="news-card-accent" style={{ backgroundColor: accent }} />
                  <div class="news-card-head">
                    <span class="news-badge" style={{ backgroundColor: accent }}>
                      {(feed.name || '?').charAt(0).toUpperCase()}
                    </span>
                    <span class="news-card-title">{feed.name}</span>
                  </div>
                  <ol class="news-list">
                    {feed.items.length === 0 ? (
                      <li class="news-empty">
                        {feed.error ? 'Unavailable · ' + feed.error : 'No items'}
                      </li>
                    ) : null}
                    {feed.items.map(function (item, itemIdx) {
                      return (
                        <li
                          key={'item-' + String(itemIdx) + '-' + item.url}
                          class={CJK_RE.test(item.title) ? 'news-item news-item-zh' : 'news-item'}
                          onClick={function () {
                            setDetail({ feedName: feed.name, accent: accent, item: item });
                          }}
                        >
                          <div class="news-item-main">
                            <div class="news-item-title news-clamp-2">{item.title}</div>
                            <div class="news-item-meta">
                              {item.publishedMs ? <span>{formatAgo(item.publishedMs, nowMs)}</span> : null}
                              {item.source ? <span class="news-domain">{item.source}</span> : null}
                            </div>
                          </div>
                        </li>
                      );
                    })}
                  </ol>
                </section>
              );
            })}
          </div>
        )}
      </div>

      {detail ? (
        <div
          class="news-popover-backdrop"
          onClick={function () {
            setDetail(null);
          }}
        >
          <div
            class="news-popover"
            style={{ borderTopColor: detail.accent }}
            role="dialog"
            aria-label={detail.item.title}
            onClick={function (ev) {
              ev.stopPropagation();
            }}
          >
            <div class="news-popover-text">
              <div class="news-popover-source">{detail.feedName}</div>
              <div class="news-popover-title">{detail.item.title}</div>
              {/* The feed's own summary always shows; the AI TL;DR goes below it */}
              {detail.item.summary ? (
                <div class="news-popover-body">{detail.item.summary}</div>
              ) : null}
              {tldr && tldr.url === detail.item.url && tldr.status === 'ok' ? (
                <div class="news-tldr">
                  <div class="news-tldr-label">
                    TL;DR<span class="news-tldr-kind">AI summary</span>
                  </div>
                  <div class="news-popover-body">{tldr.text}</div>
                </div>
              ) : tldr && tldr.url === detail.item.url && tldr.status === 'loading' ? (
                <div class="news-tldr news-tldr-loading" aria-live="polite">
                  <div class="news-tldr-label">
                    TL;DR
                    <span class="news-tldr-kind">
                      <span class="news-tldr-spark" aria-hidden="true">✦</span>
                      Generating AI summary…
                    </span>
                  </div>
                  <div class="news-tldr-skeleton" aria-hidden="true">
                    <span />
                    <span />
                    <span />
                  </div>
                </div>
              ) : tldr && tldr.url === detail.item.url && tldr.status === 'none' ? (
                <div class="news-tldr-unavailable">
                  AI summary unavailable{tldr.reason ? ' · ' + tldr.reason : ''}
                </div>
              ) : null}
              <div class="news-popover-meta">
                {(detail.item.source || '') +
                  (detail.item.source && detail.item.publishedMs ? ' · ' : '') +
                  (detail.item.publishedMs ? formatAgo(detail.item.publishedMs, nowMs) : '')}
              </div>
              <div class="news-popover-url">{shortURL(detail.item.url)}</div>
            </div>
            <div class="news-popover-qr">
              <QRCode
                value={detail.item.url}
                size={184}
                logoText={(detail.feedName || '?').charAt(0).toUpperCase()}
                logoColor={detail.accent}
              />
              <div class="news-popover-hint">Scan to open on your phone</div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
