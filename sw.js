const CACHE_NAME = 'stitchtrack-cache-v10'; 

// Explicitly pre-cache every local file the app needs to boot fully offline
const urlsToCache = [
  './',
  './index.html',
  './app.js',
  './styles.css',
  './manifest.json',
  './tailor.png',
  './launchericon144x144.png',
  './launchericon192x192.png',
  './launchericon512x512.png'
];

// 1. INSTALL: Cache local core files — fetched with {cache:'reload'} so the
// browser's own HTTP cache can never hand back stale bytes here. Without
// this, bumping CACHE_NAME creates a new Cache Storage bucket but can still
// fill it with the SAME old cached app.js/styles.css the browser already
// had, because a plain fetch() is allowed to be served from HTTP cache.
self.addEventListener('install', event => {
  self.skipWaiting(); // Force the waiting service worker to become the active service worker
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return Promise.all(urlsToCache.map(url => {
        return fetch(url, { cache: 'reload' }).then(res => {
          if (res && res.ok) return cache.put(url, res);
        });
      }));
    })
  );
});

// 2. ACTIVATE: Clean up old caches
self.addEventListener('activate', event => {
  const cacheWhitelist = [CACHE_NAME];
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheWhitelist.indexOf(cacheName) === -1) {
            console.log('Deleting old StitchTrack cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim()) // Take control of all pages immediately
  );
});

// 3. FETCH: Smart Routing (The Magic Sauce)
self.addEventListener('fetch', event => {
  const req = event.request;
  const url = new URL(req.url);

  // RULE A: Ignore all API Calls (Let your frontend offline-queue handle these)
  if (req.method === 'POST' || url.hostname.includes('script.google.com')) {
    return; // Pass right through to the network
  }

  // RULE B: Dynamic Caching for External CDNs (Fonts, Icons, PDF Libraries)
  if (url.hostname.includes('cdnjs.cloudflare.com') || 
      url.hostname.includes('fonts.googleapis.com') || 
      url.hostname.includes('fonts.gstatic.com')) {
    
    event.respondWith(
      caches.match(req).then(cachedRes => {
        if (cachedRes) return cachedRes; // Return from cache if we have it
        
        // Otherwise, fetch from network, cache a copy, and return it
        return fetch(req).then(networkRes => {
          return caches.open(CACHE_NAME).then(cache => {
            cache.put(req, networkRes.clone());
            return networkRes;
          });
        });
      })
    );
    return;
  }

  // RULE C: Network-First for HTML (Ensures users always get your newest UI updates)
  // Fallback to cache ONLY if offline.
  if (req.mode === 'navigate' || req.headers.get('accept').includes('text/html')) {
    event.respondWith(
      fetch(req, { cache: 'no-store' })
        .then(res => {
          return caches.open(CACHE_NAME).then(cache => {
            cache.put(req, res.clone()); // Update the cache with the newest HTML
            return res;
          });
        })
        .catch(() => {
          return caches.match(req); // Offline? Serve the cached HTML
        })
    );
    return;
  }

  // RULE D: Standard Cache-First for everything else (Images, manifest, etc.)
  // Cache whatever we fetch so it's available next time we're offline too.
  event.respondWith(
    caches.match(req).then(cachedRes => {
      if (cachedRes) return cachedRes;
      return fetch(req).then(networkRes => {
        if (networkRes && networkRes.ok) {
          const clone = networkRes.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(req, clone));
        }
        return networkRes;
      }).catch(() => cachedRes);
    })
  );
});
