// Service worker — app-shell cache for the cards-tracker PWA.
//
// Strategy: network-first for same-origin GETs, cache only as the offline
// fallback. While online you always get fresh files — no staleness footgun.
// Cross-origin requests (Firebase, Firestore, the Chart.js CDN) are never
// intercepted, so data is always live and never cached here.
//
// Bump CACHE_VERSION on any deploy that changes a shell file below; the
// activate handler purges every cache that isn't the current version.

const CACHE_VERSION = 'cards-v22';

const SHELL = [
  '/',
  '/index.html',
  '/manifest.json',
  '/css/style.css',
  '/js/app.js',
  '/js/config.js',
  '/js/auth.js',
  '/js/dashboard.js',
  '/js/transactions.js',
  '/js/voucher-trades.js',
  '/js/aep-ledger.js',
  '/js/rewards.js',
  '/js/settings.js',
  '/js/charts.js',
  '/js/utils.js',
  '/js/points-config.js',
  '/js/vendor/flatpickr.min.js',
  '/js/vendor/flatpickr.min.css',
  '/icon-192.png',
  '/icon-512.png',
  '/icon-180.png',
  '/icon-maskable-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_VERSION)
      .then((c) => c.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const { request } = e;
  if (request.method !== 'GET') return;
  if (new URL(request.url).origin !== self.location.origin) return;

  e.respondWith(
    fetch(request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE_VERSION).then((c) => c.put(request, copy));
        return res;
      })
      .catch(() => caches.match(request).then((cached) => cached || caches.match('/index.html')))
  );
});
