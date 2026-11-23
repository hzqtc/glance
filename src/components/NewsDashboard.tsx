import { useEffect, useRef, useState } from 'preact/hooks';
import type { BBCStory, GitHubRepo, HNStory, NewsResponse } from '../types';
import { QRCode } from './QRCode';

export var NEWS_STORAGE_KEY = 'glance:lastNews:v1';
var NEWS_POLL_MS = 15 * 60 * 1000;
var POPOVER_AUTO_CLOSE_MS = 90 * 1000;

interface NewsDashboardProps {
  isActive: boolean;
  preload?: boolean;
  nowMs: number;
  isRefreshing: boolean;
  onRefresh: () => void;
  onUnauthorized?: () => void;
}

// What the QR popover shows for a tapped headline, repo, or event.
interface NewsDetail {
  source: 'hn' | 'bbc' | 'github';
  sourceLabel: string;
  title: string;
  body?: string;
  meta?: string;
  url: string;
}

function readCachedNews(): NewsResponse | null {
  try {
    var raw = window.localStorage.getItem(NEWS_STORAGE_KEY);
    if (!raw) return null;
    var parsed = JSON.parse(raw) as NewsResponse;
    if (parsed && parsed.hn && parsed.bbc && parsed.github) {
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

function formatAgoZh(timeMs: number, nowMs: number): string {
  var mins = Math.max(0, Math.round((nowMs - timeMs) / 60000));
  if (mins < 60) return String(Math.max(1, mins)) + '分钟前';
  var hrs = Math.floor(mins / 60);
  if (hrs < 24) return String(hrs) + '小时前';
  return String(Math.floor(hrs / 24)) + '天前';
}

function formatCount(n: number): string {
  if (n >= 100000) return String(Math.round(n / 1000)) + 'k';
  if (n >= 10000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
  return n.toLocaleString('en-US');
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

function shortURL(url: string): string {
  return url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');
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

  var hn: HNStory[] = data ? data.hn : [];
  var bbc: BBCStory[] = data ? data.bbc : [];
  var github: GitHubRepo[] = data ? data.github : [];
  var nowMs = props.nowMs;
  var dateLabel = data ? formatHeaderDate(data.date) : '';
  var emptyHint = loadError ? 'Unavailable · ' + loadError : 'Loading…';

  function openDetail(d: NewsDetail) {
    setDetail(d);
  }

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

        <div class="news-grid">
          {/* Hacker News */}
          <section class="news-card news-card-hn" aria-label="Hacker News top stories">
            <div class="news-card-head">
              <span class="news-badge news-badge-hn">Y</span>
              <span class="news-card-title">Hacker News</span>
            </div>
            <ol class="news-list">
              {hn.length === 0 ? <li class="news-empty">{emptyHint}</li> : null}
              {hn.map(function (s, i) {
                return (
                  <li
                    key={'hn-' + String(s.id)}
                    class="news-item"
                    onClick={function () {
                      openDetail({
                        source: 'hn',
                        sourceLabel: 'Hacker News',
                        title: s.title,
                        meta:
                          String(s.score) +
                          ' points · ' +
                          String(s.comments) +
                          (s.comments === 1 ? ' comment' : ' comments') +
                          ' · by ' +
                          s.by,
                        url: s.url,
                      });
                    }}
                  >
                    <span class="news-rank">{String(i + 1)}</span>
                    <div class="news-item-main">
                      <div class="news-item-title news-clamp-2">{s.title}</div>
                      <div class="news-item-meta">
                        <span>{String(s.score)} pts</span>
                        <span>
                          {String(s.comments)} {s.comments === 1 ? 'comment' : 'comments'}
                        </span>
                        <span>{formatAgo(s.timeMs, nowMs)}</span>
                        {s.domain ? <span class="news-domain">{s.domain}</span> : null}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ol>
          </section>

          {/* BBC News 中文 */}
          <section class="news-card news-card-bbc" aria-label="BBC News Chinese headlines">
            <div class="news-card-head">
              <span class="news-badge news-badge-bbc">BBC</span>
              <span class="news-card-title">BBC 中文</span>
            </div>
            <ol class="news-list">
              {bbc.length === 0 ? <li class="news-empty">{emptyHint}</li> : null}
              {bbc.map(function (s, i) {
                return (
                  <li
                    key={'bbc-' + String(i) + '-' + s.url}
                    class="news-item news-item-zh"
                    onClick={function () {
                      openDetail({
                        source: 'bbc',
                        sourceLabel: 'BBC 中文',
                        title: s.title,
                        body: s.summary,
                        meta: s.publishedMs ? formatAgoZh(s.publishedMs, nowMs) : undefined,
                        url: s.url,
                      });
                    }}
                  >
                    <div class="news-item-main">
                      <div class="news-item-title news-clamp-2">{s.title}</div>
                      {s.publishedMs ? (
                        <div class="news-item-meta">
                          <span>{formatAgoZh(s.publishedMs, nowMs)}</span>
                        </div>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ol>
          </section>

          {/* GitHub Trending */}
          <section class="news-card news-card-gh" aria-label="GitHub trending repositories">
            <div class="news-card-head">
              <svg class="news-gh-mark" width="18" height="18" viewBox="0 0 16 16" aria-hidden="true">
                <path
                  fill="currentColor"
                  d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"
                />
              </svg>
              <span class="news-card-title">GitHub Trending</span>
            </div>
            <ol class="news-list">
              {github.length === 0 ? <li class="news-empty">{emptyHint}</li> : null}
              {github.map(function (g) {
                return (
                  <li
                    key={'gh-' + g.owner + '/' + g.name}
                    class="news-item"
                    onClick={function () {
                      openDetail({
                        source: 'github',
                        sourceLabel: 'GitHub Trending',
                        title: g.owner + ' / ' + g.name,
                        body: g.description,
                        meta:
                          (g.language ? g.language + ' · ' : '') +
                          '★ ' +
                          g.stars.toLocaleString('en-US') +
                          ' · +' +
                          g.starsToday.toLocaleString('en-US') +
                          ' today',
                        url: g.url,
                      });
                    }}
                  >
                    <div class="news-item-main">
                      <div class="news-item-title news-clamp-1">
                        <span class="news-gh-owner">{g.owner} / </span>
                        {g.name}
                      </div>
                      <div class="news-item-meta">
                        {g.language ? (
                          <span class="news-lang">
                            <span
                              class="news-lang-dot"
                              style={{ backgroundColor: g.languageColor || '#94a3b8' }}
                            />
                            {g.language}
                          </span>
                        ) : null}
                        <span>★ {formatCount(g.stars)}</span>
                        <span class="news-stars-today">+{formatCount(g.starsToday)} today</span>
                      </div>
                      {g.description ? (
                        <div class="news-item-desc news-clamp-2">{g.description}</div>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ol>
          </section>

        </div>
      </div>

      {detail ? (
        <div
          class="news-popover-backdrop"
          onClick={function () {
            setDetail(null);
          }}
        >
          <div
            class={'news-popover news-popover-' + detail.source}
            role="dialog"
            aria-label={detail.title}
            onClick={function (ev) {
              ev.stopPropagation();
            }}
          >
            <div class="news-popover-text">
              <div class="news-popover-source">{detail.sourceLabel}</div>
              <div class="news-popover-title">{detail.title}</div>
              {detail.body ? <div class="news-popover-body">{detail.body}</div> : null}
              {detail.meta ? <div class="news-popover-meta">{detail.meta}</div> : null}
              <div class="news-popover-url">{shortURL(detail.url)}</div>
            </div>
            <div class="news-popover-qr">
              <QRCode value={detail.url} size={168} />
              <div class="news-popover-hint">Scan to open on your phone</div>
            </div>
            <button
              type="button"
              class="news-popover-close"
              aria-label="Close"
              onClick={function () {
                setDetail(null);
              }}
            >
              ×
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
