/*
 * Offline cache.
 *
 * The app has to work in a warehouse, on a plane, or anywhere with no signal, so
 * every file it needs is precached on install. Bump CACHE when shipping changes —
 * old caches are dropped on activate.
 *
 * Only app code is cached. Business data lives in localStorage and never passes
 * through here.
 */

const CACHE = 'lafuga-v1';

const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/app.css',
  './vendor/jspdf.umd.min.js',
  './assets/brand-marks.js',
  './assets/wordmark-black.png',
  './assets/icon-180.png',
  './assets/icon-192.png',
  './assets/icon-512.png',
  './assets/favicon-32.png',
  './js/app.js',
  './js/ui.js',
  './js/store.js',
  './js/catalog.js',
  './js/pricing.js',
  './js/pdf.js',
  './js/deadlines.js',
  './js/views/today.js',
  './js/views/quotes.js',
  './js/views/products.js',
  './js/views/sales.js',
  './js/views/dates.js',
  './js/views/settings.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      // addAll is all-or-nothing, so cache individually: one 404 should not leave
      // the app with no offline copy at all.
      .then((cache) => Promise.all(SHELL.map((url) => cache.add(url).catch(() => null))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // Web fonts fall back to system faces.

  // Navigations come from the cached shell first so a cold, offline launch works.
  if (request.mode === 'navigate') {
    event.respondWith(
      caches.match('./index.html').then((cached) => cached || fetch(request)),
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => cached);
      // Serve what we have immediately and refresh it in the background.
      return cached || network;
    }),
  );
});
