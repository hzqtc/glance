/* Minimal Safari 12-safe Service Worker (ES5) */
var CACHE_NAME = 'glance-shell-v5';
var API_CACHE = 'glance-api-v5';

function isLocalDevHost() {
  var host = self.location && self.location.hostname ? self.location.hostname : '';
  var port = self.location && self.location.port ? self.location.port : '';
  return (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    port === '5173' ||
    host.indexOf('192.168.') === 0 ||
    host.indexOf('10.') === 0 ||
    host.indexOf('.local') !== -1
  );
}

self.addEventListener('install', function (event) {
  if (isLocalDevHost()) {
    self.skipWaiting();
    return;
  }
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      return cache.addAll(['/', '/manifest.webmanifest']);
    }).then(function () {
      return self.skipWaiting();
    })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys.map(function (key) {
          if (isLocalDevHost() || (key !== CACHE_NAME && key !== API_CACHE)) {
            return caches.delete(key);
          }
          return Promise.resolve();
        })
      );
    }).then(function () {
      return self.clients.claim();
    })
  );
});

self.addEventListener('fetch', function (event) {
  if (isLocalDevHost()) {
    return;
  }

  var req = event.request;
  if (req.method !== 'GET') {
    return;
  }

  var url = req.url || '';
  var apiPrefix = self.location.origin + '/api/';

  /* Never cache /api/auth, /api/summary, private /api/calendar, or private /api/photos responses */
  if (
    url.indexOf(apiPrefix + 'auth') === 0 ||
    url.indexOf(apiPrefix + 'calendar') === 0 ||
    url.indexOf(apiPrefix + 'photos') === 0 ||
    url.indexOf(apiPrefix + 'summary') === 0
  ) {
    return;
  }

  /* Network-first for the other same-origin APIs (weather, stocks, world, news) with cached fallback during Wi-Fi blips */
  if (url.indexOf(apiPrefix) === 0) {
    event.respondWith(
      fetch(req).then(function (resp) {
        if (resp && resp.status === 200) {
          var clone = resp.clone();
          event.waitUntil(
            caches.open(API_CACHE).then(function (cache) {
              return cache.put(req, clone);
            })
          );
        }
        return resp;
      }).catch(function () {
        return caches.match(req);
      })
    );
    return;
  }

  /* Network-first for HTML navigation */
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).then(function (resp) {
        if (resp && resp.status === 200) {
          var clone = resp.clone();
          event.waitUntil(
            caches.open(CACHE_NAME).then(function (cache) {
              return cache.put(req, clone);
            })
          );
        }
        return resp;
      }).catch(function () {
        return caches.match('/').then(function (cachedRoot) {
          return cachedRoot || caches.match(req);
        });
      })
    );
    return;
  }

  /* Only cache hashed production /assets/ and /icons/ */
  var isCacheableStatic =
    url.indexOf(self.location.origin + '/assets/') === 0 ||
    url.indexOf(self.location.origin + '/icons/') === 0 ||
    url.indexOf(self.location.origin + '/manifest.webmanifest') === 0;

  if (!isCacheableStatic) {
    return;
  }

  event.respondWith(
    caches.match(req).then(function (cached) {
      if (cached) {
        return cached;
      }
      return fetch(req).then(function (resp) {
        if (resp && resp.status === 200) {
          var clone = resp.clone();
          event.waitUntil(
            caches.open(CACHE_NAME).then(function (cache) {
              return cache.put(req, clone);
            })
          );
        }
        return resp;
      });
    })
  );
});
