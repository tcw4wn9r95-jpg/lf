/* Router and shell wiring. Hash routes so the app works from a file:// URL,
 * a static host, or a home-screen icon with no server behind it. */

import { load, subscribe } from './store.js';
import { clear, closeAllSheets } from './ui.js';
import { loadBrandFonts } from './fonts.js';
import { maybeAutoSync } from './sync.js';

import todayView from './views/today.js';
import quotesView from './views/quotes.js';
import productsView from './views/products.js';
import salesView from './views/sales.js';
import datesView from './views/dates.js';
import settingsView from './views/settings.js';

const ROUTES = {
  today: todayView,
  quotes: quotesView,
  products: productsView,
  sales: salesView,
  dates: datesView,
  settings: settingsView,
};

const viewRoot = document.getElementById('view');
let current = null;

function parseHash() {
  const raw = (location.hash || '#/today').replace(/^#\/?/, '');
  const [name, ...rest] = raw.split('/');
  return { name: ROUTES[name] ? name : 'today', params: rest };
}

function render() {
  const { name, params } = parseHash();
  current = name;
  closeAllSheets();
  clear(viewRoot);
  // Views that own transient form state opt back into this; the default is that a
  // screen redraws when the data under it changes.
  viewRoot.dataset.volatile = 'false';
  try {
    viewRoot.appendChild(ROUTES[name]({ params, navigate }));
  } catch (err) {
    console.error(err);
    viewRoot.appendChild(errorPanel(err));
  }
  viewRoot.scrollTop = 0;
  window.scrollTo(0, 0);
  markActiveTab(name);
}

function errorPanel(err) {
  const wrap = document.createElement('div');
  wrap.className = 'card';
  wrap.innerHTML =
    '<h1 class="page-title">Something broke</h1>' +
    '<p class="prose">This screen failed to draw. Your data is untouched — it is stored separately from the app.</p>';
  const pre = document.createElement('pre');
  pre.className = 'inline-note';
  pre.style.whiteSpace = 'pre-wrap';
  pre.textContent = String(err && err.stack ? err.stack : err);
  wrap.appendChild(pre);
  return wrap;
}

function markActiveTab(name) {
  document.querySelectorAll('.tabbar a').forEach((a) => {
    if (a.dataset.tab === name) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
}

export function navigate(hash) {
  if (location.hash === hash) render();
  else location.hash = hash;
}

document.querySelectorAll('[data-route]').forEach((node) => {
  node.addEventListener('click', () => navigate(node.dataset.route));
});

window.addEventListener('hashchange', render);

// Re-render the live screen when data changes underneath it (import, wipe, edit
// from a sheet). Views that own transient form state opt out via data-volatile.
subscribe(() => {
  if (viewRoot.dataset.volatile === 'true') return;
  if (current === parseHash().name) render();
});

load();
render();

// Resolve Gotham (or the bundled stand-in) early, so the first PDF export does not
// have to wait on it.
loadBrandFonts().catch((err) => console.warn('Font resolution failed', err));

// Pull a newer set of figures in the background when one is configured. Failure is
// never fatal — the figures already on the phone stay exactly as they were.
maybeAutoSync()
  .then((parsed) => {
    if (parsed) render();
  })
  .catch((err) => console.warn('Auto-sync failed', err));

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch((err) => console.warn('Offline cache unavailable', err));
  });
}
