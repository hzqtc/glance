import { useEffect, useRef, useState } from 'preact/hooks';
import type { PhotoItem, PhotoLocationsResponse, PhotosResponse } from '../types';
import { buildCollageDeck } from '../utils/collage';
import type { CollageFrame } from '../utils/collage';
import { getDemoPhotosResponse, isPhotosDemoMode } from '../data/demoPhotos';
import { getActiveHolidayTheme } from '../utils/holidays';
import { HolidayFrame } from './HolidayFrame';

var DEFAULT_PHOTO_INTERVAL_SEC = 15;
var PHOTO_REFRESH_MS = 30 * 60 * 1000;
var CROSSFADE_MS = 950;

interface PhotosDashboardProps {
  isActive: boolean;
  preload?: boolean;
  slideIntervalSeconds?: number;
  isRefreshing: boolean;
  onRefresh: () => void;
  onUnauthorized?: () => void;
}

function preloadFrameImages(frame: CollageFrame | null): void {
  if (!frame) return;
  var isSingle = frame.layout === 'single' || frame.layout === 'single-portrait';
  for (var i = 0; i < frame.items.length; i++) {
    var img = new Image();
    try {
      img.referrerPolicy = 'no-referrer';
    } catch (_err) {
      // Safari 12 fallback
    }
    img.src = isSingle ? frame.items[i].fullUrl : frame.items[i].tileUrl;
  }
}

function renderPhotoMeta(
  item: PhotoItem,
  locationsById: { [id: string]: string },
  isSingle: boolean
) {
  var loc = item.location || locationsById[item.id] || '';
  var date = item.takenDate || '';
  if (!loc && !date) {
    return null;
  }
  return (
    <div
      class={
        isSingle
          ? 'photo-meta-overlay photo-meta-overlay-single'
          : 'photo-meta-overlay'
      }
    >
      <div class="photo-meta-line">
        {loc ? <span class="photo-meta-loc">{loc}</span> : null}
        {loc && date ? (
          <span class="photo-meta-sep" aria-hidden="true">
            ·
          </span>
        ) : null}
        {date ? <span class="photo-meta-date">{date}</span> : null}
      </div>
    </div>
  );
}

function renderCollageFrame(
  frame: CollageFrame,
  locationsById: { [id: string]: string }
) {
  var items = frame.items;

  if (frame.layout === 'single' && items.length >= 1) {
    return (
      <div class="collage-single">
        <img
          class="collage-img"
          src={items[0].fullUrl}
          alt=""
          draggable={false}
          referrerPolicy="no-referrer"
        />
        {renderPhotoMeta(items[0], locationsById, true)}
      </div>
    );
  }

  if (frame.layout === 'single-portrait' && items.length >= 1) {
    return (
      <div class="collage-single-portrait">
        <img
          class="collage-bg-blur"
          src={items[0].tileUrl}
          alt=""
          aria-hidden="true"
          draggable={false}
          referrerPolicy="no-referrer"
        />
        <img
          class="collage-img-contain"
          src={items[0].fullUrl}
          alt=""
          draggable={false}
          referrerPolicy="no-referrer"
        />
        {renderPhotoMeta(items[0], locationsById, true)}
      </div>
    );
  }

  if (frame.layout === 'duo-vertical' && items.length >= 2) {
    return (
      <div class="collage-row">
        <div class="collage-tile collage-tile-half">
          <img
            class="collage-img"
            src={items[0].tileUrl}
            alt=""
            draggable={false}
            referrerPolicy="no-referrer"
          />
          {renderPhotoMeta(items[0], locationsById, false)}
        </div>
        <div class="collage-tile collage-tile-half collage-tile-last">
          <img
            class="collage-img"
            src={items[1].tileUrl}
            alt=""
            draggable={false}
            referrerPolicy="no-referrer"
          />
          {renderPhotoMeta(items[1], locationsById, false)}
        </div>
      </div>
    );
  }

  if (frame.layout === 'trio-vertical' && items.length >= 3) {
    return (
      <div class="collage-row">
        <div class="collage-tile collage-tile-third">
          <img
            class="collage-img"
            src={items[0].tileUrl}
            alt=""
            draggable={false}
            referrerPolicy="no-referrer"
          />
          {renderPhotoMeta(items[0], locationsById, false)}
        </div>
        <div class="collage-tile collage-tile-third">
          <img
            class="collage-img"
            src={items[1].tileUrl}
            alt=""
            draggable={false}
            referrerPolicy="no-referrer"
          />
          {renderPhotoMeta(items[1], locationsById, false)}
        </div>
        <div class="collage-tile collage-tile-third collage-tile-last">
          <img
            class="collage-img"
            src={items[2].tileUrl}
            alt=""
            draggable={false}
            referrerPolicy="no-referrer"
          />
          {renderPhotoMeta(items[2], locationsById, false)}
        </div>
      </div>
    );
  }

  if (frame.layout === 'bento-left' && items.length >= 3) {
    return (
      <div class="collage-row">
        <div class="collage-tile collage-bento-hero">
          <img
            class="collage-img"
            src={items[0].tileUrl}
            alt=""
            draggable={false}
            referrerPolicy="no-referrer"
          />
          {renderPhotoMeta(items[0], locationsById, false)}
        </div>
        <div class="collage-bento-stack collage-tile-last">
          <div class="collage-tile collage-bento-cell">
            <img
              class="collage-img"
              src={items[1].tileUrl}
              alt=""
              draggable={false}
              referrerPolicy="no-referrer"
            />
            {renderPhotoMeta(items[1], locationsById, false)}
          </div>
          <div class="collage-tile collage-bento-cell collage-bento-cell-last">
            <img
              class="collage-img"
              src={items[2].tileUrl}
              alt=""
              draggable={false}
              referrerPolicy="no-referrer"
            />
            {renderPhotoMeta(items[2], locationsById, false)}
          </div>
        </div>
      </div>
    );
  }

  if (frame.layout === 'bento-right' && items.length >= 3) {
    return (
      <div class="collage-row">
        <div class="collage-bento-stack collage-bento-stack-left">
          <div class="collage-tile collage-bento-cell">
            <img
              class="collage-img"
              src={items[1].tileUrl}
              alt=""
              draggable={false}
              referrerPolicy="no-referrer"
            />
            {renderPhotoMeta(items[1], locationsById, false)}
          </div>
          <div class="collage-tile collage-bento-cell collage-bento-cell-last">
            <img
              class="collage-img"
              src={items[2].tileUrl}
              alt=""
              draggable={false}
              referrerPolicy="no-referrer"
            />
            {renderPhotoMeta(items[2], locationsById, false)}
          </div>
        </div>
        <div class="collage-tile collage-bento-hero collage-tile-last">
          <img
            class="collage-img"
            src={items[0].tileUrl}
            alt=""
            draggable={false}
            referrerPolicy="no-referrer"
          />
          {renderPhotoMeta(items[0], locationsById, false)}
        </div>
      </div>
    );
  }

  // Fallback
  if (items.length >= 1) {
    return (
      <div class="collage-single">
        <img
          class="collage-img"
          src={items[0].fullUrl}
          alt=""
          draggable={false}
          referrerPolicy="no-referrer"
        />
        {renderPhotoMeta(items[0], locationsById, true)}
      </div>
    );
  }
  return null;
}

export function PhotosDashboard(props: PhotosDashboardProps) {
  var _respState = useState<PhotosResponse | null>(null);
  var resp = _respState[0];
  var setResp = _respState[1];

  var _loadingState = useState<boolean>(false);
  var isLoading = _loadingState[0];
  var setIsLoading = _loadingState[1];

  var _errorState = useState<string | null>(null);
  var loadError = _errorState[0];
  var setLoadError = _errorState[1];

  var _deckState = useState<CollageFrame[]>([]);
  var deck = _deckState[0];
  var setDeck = _deckState[1];

  var _idxState = useState<number>(0);
  var frameIdx = _idxState[0];
  var setFrameIdx = _idxState[1];

  var _prevFrameState = useState<CollageFrame | null>(null);
  var prevFrame = _prevFrameState[0];
  var setPrevFrame = _prevFrameState[1];

  var _timerResetState = useState<number>(0);
  var timerResetTick = _timerResetState[0];
  var setTimerResetTick = _timerResetState[1];

  var _locState = useState<{ [id: string]: string }>({});
  var locationsById = _locState[0];
  var setLocationsById = _locState[1];

  var photosRef = useRef<PhotoItem[]>([]);
  var deckRef = useRef<CollageFrame[]>([]);
  var frameIdxRef = useRef<number>(0);
  var deckRoundRef = useRef<number>(1);
  var hasPreloadedRef = useRef<boolean>(false);
  var hasActivatedOnceRef = useRef<boolean>(props.isActive);
  var wasActiveRef = useRef<boolean>(props.isActive);
  var lastFetchMsRef = useRef<number>(0);
  var pollTimerRef = useRef<number | null>(null);
  var fadeTimerRef = useRef<number | null>(null);
  var touchStartRef = useRef<{ x: number; y: number } | null>(null);
  var mouseStartRef = useRef<{ x: number; y: number } | null>(null);
  var suppressTapUntilRef = useRef<number>(0);
  var wheelCooldownRef = useRef<number>(0);
  var requestedLocIdsRef = useRef<{ [id: string]: boolean }>({});
  var unmountedRef = useRef<boolean>(false);

  deckRef.current = deck;
  frameIdxRef.current = frameIdx;

  function fetchLocationsForFrames(frames: Array<CollageFrame | null>) {
    if (isPhotosDemoMode()) return;
    var pendingIds: string[] = [];
    for (var f = 0; f < frames.length; f++) {
      var frame = frames[f];
      if (!frame) continue;
      for (var i = 0; i < frame.items.length; i++) {
        var item = frame.items[i];
        if (!item || !item.id || item.location) continue;
        if (item.id.indexOf('demo-') === 0) continue;
        if (requestedLocIdsRef.current[item.id]) continue;
        requestedLocIdsRef.current[item.id] = true;
        pendingIds.push(item.id);
        if (pendingIds.length >= 6) break;
      }
      if (pendingIds.length >= 6) break;
    }
    if (pendingIds.length === 0) return;

    fetch('/api/photos?locate=' + encodeURIComponent(pendingIds.join(',')), {
      cache: 'no-cache',
      credentials: 'same-origin',
    })
      .then(function (r) {
        if (r.status === 401) {
          if (props.onUnauthorized) props.onUnauthorized();
          return null;
        }
        if (!r.ok) return null;
        return r.json();
      })
      .then(function (json: PhotoLocationsResponse | null) {
        if (unmountedRef.current || !json || !json.locations) return;
        var keys = Object.keys(json.locations);
        if (keys.length === 0) return;
        setLocationsById(function (prev) {
          var next: { [id: string]: string } = {};
          var prevKeys = Object.keys(prev);
          for (var p = 0; p < prevKeys.length; p++) {
            next[prevKeys[p]] = prev[prevKeys[p]];
          }
          for (var k = 0; k < keys.length; k++) {
            if (json.locations[keys[k]]) {
              next[keys[k]] = json.locations[keys[k]];
            }
          }
          return next;
        });
      })
      .catch(function () {
        // Allow retry on transient network failure
        for (var r = 0; r < pendingIds.length; r++) {
          delete requestedLocIdsRef.current[pendingIds[r]];
        }
      });
  }

  function applyPhotoList(photos: PhotoItem[]) {
    var prevIds = '';
    for (var i = 0; i < photosRef.current.length; i++) {
      prevIds += photosRef.current[i].id + ',';
    }
    var nextIds = '';
    for (var j = 0; j < photos.length; j++) {
      nextIds += photos[j].id + ',';
    }
    photosRef.current = photos;

    // Only rebuild the deck if we don't have one yet or the album contents changed
    if (deckRef.current.length === 0 || prevIds !== nextIds) {
      deckRoundRef.current += 1;
      var nextDeck = buildCollageDeck(photos, deckRoundRef.current);
      setDeck(nextDeck);
      setFrameIdx(0);
      setPrevFrame(null);
      if (nextDeck.length > 0) {
        preloadFrameImages(nextDeck[0]);
        fetchLocationsForFrames([nextDeck[0]]);
      }
      if (nextDeck.length > 1) {
        preloadFrameImages(nextDeck[1]);
      }
    }
  }

  function fetchPhotos(showLoading: boolean) {
    // Demo mode (?demo=photos): bundled stock photos instead of /api/photos
    if (isPhotosDemoMode()) {
      var demo = getDemoPhotosResponse();
      setResp(demo);
      setLoadError(null);
      setIsLoading(false);
      lastFetchMsRef.current = Date.now();
      applyPhotoList(demo.photos);
      return Promise.resolve(demo);
    }
    if (showLoading) {
      setIsLoading(true);
    }
    return fetch('/api/photos', { cache: 'no-cache', credentials: 'same-origin' })
      .then(function (r) {
        if (r.status === 401) {
          if (props.onUnauthorized) props.onUnauthorized();
          return null;
        }
        if (!r.ok) {
          throw new Error('HTTP ' + String(r.status));
        }
        return r.json();
      })
      .then(function (json: PhotosResponse | null) {
        if (!json) return json;
        setResp(json);
        setLoadError(null);
        setIsLoading(false);
        if (json.photos && json.photos.length > 0) {
          lastFetchMsRef.current = Date.now();
          applyPhotoList(json.photos);
        }
        return json;
      })
      .catch(function (err) {
        setLoadError(err && err.message ? String(err.message) : 'Network error');
        setIsLoading(false);
        return null;
      });
  }

  function stepFrame(delta: number, manual: boolean, instant?: boolean) {
    var curDeck = deckRef.current;
    if (curDeck.length === 0) return;

    var curIdx = frameIdxRef.current;
    var curFrame = curDeck[curIdx] || null;
    var nextIdx = curIdx + delta;

    // Reshuffle a fresh collage deck after completing a full pass
    if (nextIdx >= curDeck.length) {
      if (photosRef.current.length > 0) {
        deckRoundRef.current += 1;
        var freshDeck = buildCollageDeck(photosRef.current, deckRoundRef.current);
        if (freshDeck.length > 0) {
          // Avoid repeating the exact same first photo across deck boundaries if possible
          if (
            curFrame &&
            freshDeck.length > 1 &&
            curFrame.items.length > 0 &&
            freshDeck[0].items.length > 0 &&
            freshDeck[0].items[0].id === curFrame.items[0].id
          ) {
            var swap = freshDeck[0];
            freshDeck[0] = freshDeck[1];
            freshDeck[1] = swap;
          }
          if (instant) {
            if (fadeTimerRef.current !== null) {
              window.clearTimeout(fadeTimerRef.current);
              fadeTimerRef.current = null;
            }
            setPrevFrame(null);
          } else {
            setPrevFrame(curFrame);
            schedulePrevClear();
          }
          setDeck(freshDeck);
          setFrameIdx(0);
          if (freshDeck.length > 1) {
            preloadFrameImages(freshDeck[1]);
          }
          if (manual) {
            setTimerResetTick(function (n) {
              return n + 1;
            });
          }
          return;
        }
      }
      nextIdx = 0;
    } else if (nextIdx < 0) {
      nextIdx = curDeck.length - 1;
    }

    if (curDeck.length === 1) {
      return;
    }

    if (instant) {
      if (fadeTimerRef.current !== null) {
        window.clearTimeout(fadeTimerRef.current);
        fadeTimerRef.current = null;
      }
      setPrevFrame(null);
    } else {
      setPrevFrame(curFrame);
      schedulePrevClear();
    }
    setFrameIdx(nextIdx);
    preloadFrameImages(curDeck[(nextIdx + 1) % curDeck.length]);

    if (manual) {
      setTimerResetTick(function (n) {
        return n + 1;
      });
    }
  }

  function schedulePrevClear() {
    if (fadeTimerRef.current !== null) {
      window.clearTimeout(fadeTimerRef.current);
    }
    fadeTimerRef.current = window.setTimeout(function () {
      fadeTimerRef.current = null;
      setPrevFrame(null);
    }, CROSSFADE_MS + 60);
  }

  // Quietly preload album metadata once after boot while inactive
  useEffect(
    function () {
      if (!props.preload || props.isActive || hasPreloadedRef.current) {
        return;
      }
      hasPreloadedRef.current = true;
      fetchPhotos(false);
    },
    [props.preload, props.isActive]
  );

  // Advance to a fresh preloaded photo/collage whenever rotating back onto the Photos slide
  useEffect(
    function () {
      var prevActive = wasActiveRef.current;
      wasActiveRef.current = props.isActive;
      if (props.isActive) {
        if (!prevActive && hasActivatedOnceRef.current && deckRef.current.length > 1) {
          stepFrame(1, false, true);
        }
        hasActivatedOnceRef.current = true;
      }
    },
    [props.isActive]
  );

  // Fetch when Photos slide activates (if stale) + refresh album list every 30 min
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
          fetchPhotos(false).then(schedulePoll);
        }, PHOTO_REFRESH_MS);
      }

      if (lastFetchMsRef.current > 0 && Date.now() - lastFetchMsRef.current < 5 * 60 * 1000) {
        schedulePoll();
      } else {
        fetchPhotos(photosRef.current.length === 0).then(schedulePoll);
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

  var photoIntervalMs =
    typeof props.slideIntervalSeconds === 'number' && props.slideIntervalSeconds >= 3
      ? props.slideIntervalSeconds * 1000
      : DEFAULT_PHOTO_INTERVAL_SEC * 1000;

  // Shuffle & advance to the next collage on the configured interval while Photos slide is active
  useEffect(
    function () {
      if (!props.isActive || deck.length <= 1) {
        return;
      }
      // Preload upcoming collage immediately
      preloadFrameImages(deck[(frameIdx + 1) % deck.length]);

      var timerId = window.setTimeout(function () {
        stepFrame(1, false);
      }, photoIntervalMs);

      return function () {
        window.clearTimeout(timerId);
      };
    },
    [props.isActive, deck, frameIdx, timerResetTick, photoIntervalMs]
  );

  // Fetch EXIF locations lazily for the current & upcoming collage frames
  useEffect(
    function () {
      if (!props.isActive || deck.length === 0) {
        return;
      }
      var cur = deck[frameIdx] || deck[0] || null;
      var upcoming = deck.length > 1 ? deck[(frameIdx + 1) % deck.length] : null;
      fetchLocationsForFrames([cur, upcoming]);
    },
    [props.isActive, deck, frameIdx]
  );

  // Clean up crossfade timer on unmount
  useEffect(function () {
    unmountedRef.current = false;
    return function () {
      unmountedRef.current = true;
      if (fadeTimerRef.current !== null) {
        window.clearTimeout(fadeTimerRef.current);
      }
    };
  }, []);

  function handleTouchStart(e: TouchEvent) {
    if (!e.touches || e.touches.length !== 1) {
      touchStartRef.current = null;
      return;
    }
    touchStartRef.current = {
      x: e.touches[0].clientX,
      y: e.touches[0].clientY,
    };
  }

  function handleTouchCancel() {
    touchStartRef.current = null;
  }

  function handleTouchEnd(e: TouchEvent) {
    var start = touchStartRef.current;
    touchStartRef.current = null;
    if (!start || !e.changedTouches || e.changedTouches.length === 0) {
      return;
    }
    var dx = e.changedTouches[0].clientX - start.x;
    var dy = e.changedTouches[0].clientY - start.y;
    if (Math.abs(dx) >= 48 && Math.abs(dx) >= Math.abs(dy) * 1.25) {
      suppressTapUntilRef.current = Date.now() + 350;
      stepFrame(dx < 0 ? 1 : -1, true);
    }
  }

  function handleMouseDown(e: MouseEvent) {
    if (e.button !== 0) return;
    mouseStartRef.current = { x: e.clientX, y: e.clientY };
  }

  function handleMouseUp(e: MouseEvent) {
    var start = mouseStartRef.current;
    mouseStartRef.current = null;
    if (!start) return;
    var dx = e.clientX - start.x;
    var dy = e.clientY - start.y;
    if (Math.abs(dx) >= 48 && Math.abs(dx) >= Math.abs(dy) * 1.25) {
      suppressTapUntilRef.current = Date.now() + 350;
      stepFrame(dx < 0 ? 1 : -1, true);
    }
  }

  function handleMouseLeave() {
    mouseStartRef.current = null;
  }

  function handleWheel(e: WheelEvent) {
    if (Math.abs(e.deltaX) < 24 || Math.abs(e.deltaX) <= Math.abs(e.deltaY) * 1.4) {
      return;
    }
    var now = Date.now();
    if (now < wheelCooldownRef.current) return;
    wheelCooldownRef.current = now + 420;
    stepFrame(e.deltaX > 0 ? 1 : -1, true);
  }

  function handleStageClick(e: MouseEvent) {
    if (Date.now() < suppressTapUntilRef.current) return;
    if (deckRef.current.length <= 1) return;
    var target = e.target as HTMLElement | null;
    if (target && target.closest && target.closest('button')) return;
    var width = window.innerWidth || 1024;
    if (e.clientX < width * 0.32) {
      stepFrame(-1, true);
    } else {
      stepFrame(1, true);
    }
  }

  var currentFrame = deck.length > 0 ? deck[frameIdx] || deck[0] : null;
  var isConfigured = resp ? resp.configured : true;
  // Re-evaluated on every frame advance, so the theme rolls over at local midnight
  var holidayTheme = currentFrame ? getActiveHolidayTheme(Date.now()) : null;

  return (
    <div
      class="photos-slide"
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchCancel}
      onMouseDown={handleMouseDown}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseLeave}
      onWheel={handleWheel}
      onClick={handleStageClick}
    >
      {currentFrame ? (
        <div class="photos-stage">
          {prevFrame && prevFrame.key !== currentFrame.key ? (
            <div
              key={'prev-' + prevFrame.key}
              class="photos-frame photos-frame-out"
              aria-hidden="true"
            >
              {renderCollageFrame(prevFrame, locationsById)}
            </div>
          ) : null}
          <div
            key={'cur-' + currentFrame.key}
            class={
              prevFrame && prevFrame.key !== currentFrame.key
                ? 'photos-frame photos-frame-in'
                : 'photos-frame'
            }
          >
            {renderCollageFrame(currentFrame, locationsById)}
          </div>
          {holidayTheme ? <HolidayFrame theme={holidayTheme} /> : null}
        </div>
      ) : (
        <div class="photos-empty-wrap">
          <div class="photos-empty-card">
            <svg
              width="36"
              height="36"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.6"
              stroke-linecap="round"
              stroke-linejoin="round"
              class="photos-empty-icon"
              aria-hidden="true"
            >
              <rect x="3" y="4" width="18" height="16" rx="2" />
              <circle cx="8.5" cy="9.5" r="1.5" />
              <path d="M21 15l-5-5L5 20" />
            </svg>
            <div class="photos-empty-title">
              {isLoading
                ? 'Loading shared album…'
                : !isConfigured
                  ? 'Google Photos Frame'
                  : loadError
                    ? 'Unable to load album'
                    : 'No photos found'}
            </div>
            <div class="photos-empty-sub">
              {isLoading
                ? 'Fetching photos & building collages'
                : !isConfigured
                  ? 'Set PHOTOS_ALBUM_URL in Vercel Env Vars (or .env.local) to a Google Photos shared album link (https://photos.app.goo.gl/...).'
                  : loadError
                    ? loadError
                    : resp && resp.warnings && resp.warnings.length > 0
                      ? resp.warnings[0]
                      : 'Check that link sharing is enabled on your Google Photos album.'}
            </div>
            {!isLoading ? (
              <button
                type="button"
                class="photos-retry-btn"
                onClick={function () {
                  props.onRefresh();
                }}
                disabled={props.isRefreshing}
              >
                {props.isRefreshing ? 'Refreshing…' : 'Refresh'}
              </button>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
