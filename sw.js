/*
 * Offline cache.
 *
 * The app has to work in a warehouse, on a plane, or anywhere with no signal, so
 * every file it needs is precached on install.
 *
 * Strategy matters more than it looks. App code is served **network-first**: when
 * there is signal you always get the deployed version, and the cache is only a
 * fallback for when there isn't. Cache-first was the obvious choice and the wrong
 * one — it pinned phones to whatever shipped first and made every later deploy
 * invisible until the cache name happened to change.
 *
 * Images and fonts stay cache-first. They are large, they rarely change, and a
 * round trip for them on every launch is waste.
 *
 * VERSION must change on every deploy or the old cache is kept and the old shell
 * with it. `npm run release` (scripts/release.sh) bumps it together with
 * js/version.js so the two cannot drift apart.
 *
 * Only app code is cached. Business data lives in localStorage and never passes
 * through here.
 */

const VERSION = '2026.09.18-9';
const CACHE = `lafuga-${VERSION}`;

const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/app.css',
  './vendor/jspdf.umd.min.js',
  './assets/brand-marks.js',
  './assets/font-fallback.js',
  './assets/fonts/LaFugaSans-Regular.ttf',
  './assets/fonts/LaFugaSans-SemiBold.ttf',
  './assets/lockup-black.png',
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
  './js/fonts.js',
  './js/sync.js',
  './js/version.js',
  './js/deadlines.js',
  './js/landed.js',
  './js/claude.js',
  './js/views/today.js',
  './js/views/quotes.js',
  './js/views/products.js',
  './js/views/sales.js',
  './js/views/dates.js',
  './js/views/settings.js',
];

/** Files that must always reflect the deployed version when there is a network. */
const CODE = /\.(?:html|js|mjs|css|json|webmanifest)$/i;

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

self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // Everything the app needs is same-origin.

  const isCode = request.mode === 'navigate' || CODE.test(url.pathname);
  event.respondWith(isCode ? networkFirst(request) : cacheFirst(request));
});

/** Deployed version wins; the cache catches us when the network does not answer. */
async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      const copy = response.clone();
      caches.open(CACHE).then((cache) => cache.put(request, copy));
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    // A deep link opened offline still has to render: fall back to the shell and
    // let the hash router take it from there.
    if (request.mode === 'navigate') {
      const shell = await caches.match('./index.html');
      if (shell) return shell;
    }
    throw new Error('Offline and not cached');
  }
}

/** Big, stable files: serve from cache and quietly refresh for next time. */
async function cacheFirst(request) {
  const cached = await caches.match(request);
  const network = fetch(request)
    .then((response) => {
      if (response && response.ok) {
        const copy = response.clone();
        caches.open(CACHE).then((cache) => cache.put(request, copy));
      }
      return response;
    })
    .catch(() => cached);
  return cached || network;
}
