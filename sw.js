const CACHE_NAME = 'stitchtrack-cache-v3'; 

// Only explicitly pre-cache your guaranteed local files
const urlsToCache = [
  './',
  './index.html',
  './manifest.json',
  './tailor.png' 
];

// 1. INSTALL: Cache local core files
self.addEventListener('install', event => {
  self.skipWaiting(); // Force the waiting service worker to become the active service worker
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        return cache.addAll(urlsToCache);
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
      fetch(req)
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
  event.respondWith(
    caches.match(req).then(response => {
      return response || fetch(req);
    })
  );
});
