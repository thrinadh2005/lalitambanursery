// =====================================================
// Sri Lalitamba Nursery - Production Service Worker
// Cache Strategy: Cache-First for assets, Network-First for pages
// =====================================================

const CACHE_VERSION = 'v3';
const STATIC_CACHE = `lalitamba-static-${CACHE_VERSION}`;
const DYNAMIC_CACHE = `lalitamba-dynamic-${CACHE_VERSION}`;
const IMAGE_CACHE = `lalitamba-images-${CACHE_VERSION}`;

const STATIC_ASSETS = [
  '/',
  '/about',
  '/gallery',
  '/contact',
  '/css/style.css',
  '/css/ui-fixes.css',
  '/js/utils.js',
  '/manifest.json',
  '/offline.html',
  'https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css',
  'https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;700;900&family=Inter:wght@400;600;700&family=Outfit:wght@400;600;700;800&display=swap'
];

// =====================================================
// INSTALL - Pre-cache all static assets
// =====================================================
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => {
      console.log('[SW] Pre-caching static assets...');
      return cache.addAll(STATIC_ASSETS).catch(err => {
        console.warn('[SW] Some assets failed to cache:', err);
      });
    })
  );
  self.skipWaiting();
});

// =====================================================
// ACTIVATE - Clean old caches
// =====================================================
self.addEventListener('activate', (event) => {
  const VALID_CACHES = [STATIC_CACHE, DYNAMIC_CACHE, IMAGE_CACHE];
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((name) => {
          if (!VALID_CACHES.includes(name)) {
            console.log('[SW] Deleting old cache:', name);
            return caches.delete(name);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// =====================================================
// FETCH - Intelligent caching strategy
// =====================================================
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET and admin routes (never cache admin pages)
  if (request.method !== 'GET' || url.pathname.startsWith('/admin')) {
    return;
  }

  // IMAGES: Cache-First with dedicated image cache
  if (request.destination === 'image' || url.pathname.match(/\.(jpe?g|png|gif|svg|webp|ico)$/i)) {
    event.respondWith(
      caches.open(IMAGE_CACHE).then((cache) =>
        cache.match(request).then((cached) => {
          if (cached) return cached;
          return fetch(request).then((response) => {
            if (response.ok) cache.put(request, response.clone());
            return response;
          });
        })
      )
    );
    return;
  }

  // CSS / JS / FONTS: Cache-First strategy
  if (request.destination === 'style' || request.destination === 'script' || request.destination === 'font') {
    event.respondWith(
      caches.match(request).then((cached) => cached || fetch(request).then((response) => {
        if (response.ok) {
          caches.open(STATIC_CACHE).then(c => c.put(request, response.clone()));
        }
        return response;
      }))
    );
    return;
  }

  // PAGES: Network-First, fallback to cache, fallback to offline
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          caches.open(DYNAMIC_CACHE).then((cache) => cache.put(request, response.clone()));
        }
        return response;
      })
      .catch(() => {
        return caches.match(request).then((cached) => {
          if (cached) return cached;
          if (request.mode === 'navigate') {
            return caches.match('/offline.html');
          }
        });
      })
  );
});
