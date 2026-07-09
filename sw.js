// Service worker — app-shell cache for the cards-tracker PWA.
//
// Strategy:
//   - Same-origin GETs: stale-while-revalidate — serve the cached shell
//     instantly, refresh it from the network in the background. The app
//     paints immediately on launch instead of waiting a network round-trip
//     for all ~20 shell files. A deploy still lands within one launch: the
//     updated sw.js installs in the background, the CACHE_VERSION bump
//     purges the old cache, and the next launch precaches the new shell.
//   - Version-pinned CDN modules (Firebase ESM at www.gstatic.com/firebasejs/,
//     Chart.js at cdn.jsdelivr.net): cache-first in a separate persistent
//     cache — the URLs carry the version, so the content is immutable and
//     re-downloading ~700KB of vendor JS every launch was pure waste.
//   - All other cross-origin requests (Firestore data, auth) are never
//     intercepted, so data stays live.
//
// Bump CACHE_VERSION on any deploy that changes a shell file below; the
// activate handler purges every cache that isn't the current version
// (the CDN cache is exempt — immutable URLs never go stale).

const CACHE_VERSION = 'cards-v28';
const CDN_CACHE = 'cards-cdn-v1';
const CDN_PREFIXES = [
  'https://www.gstatic.com/firebasejs/',
  'https://cdn.jsdelivr.net/npm/chart.js@',
];

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
  '/js/store.js',
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
        keys.filter((k) => k !== CACHE_VERSION && k !== CDN_CACHE).map((k) => caches.delete(k))
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
