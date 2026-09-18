/* Small DOM and formatting helpers. No framework: the app is a handful of screens
 * and a build step would cost more than it saves. */

import { load } from './store.js';
import { currencySymbol } from './pdf.js';

/** el('div', {class: 'x', onclick: fn}, child, child) — attrs, dataset, events, styles. */
export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  Object.entries(props || {}).forEach(([key, value]) => {
    if (value === null || value === undefined || value === false) return;
    if (key === 'class') node.className = value;
    else if (key === 'html') node.innerHTML = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key === 'style' && typeof value === 'object') Object.assign(node.style, value);
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value);
    else if (key in node && key !== 'list' && typeof value !== 'object') node[key] = value;
    else node.setAttribute(key, value);
  });
  append(node, children);
  return node;
}

function append(node, children) {
  children.flat(Infinity).forEach((child) => {
    if (child === null || child === undefined || child === false) return;
    node.appendChild(child instanceof Node ? child : document.createTextNode(String(child)));
  });
}

export const frag = (...children) => {
  const f = document.createDocumentFragment();
  append(f, children);
  return f;
};

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

/* ------------------------------------------------------------------ formatting */

export function currency(value, { code, dp = 2 } = {}) {
  const cur = code || load().settings.currency || 'GBP';
  const n = Number.isFinite(value) ? value : 0;
  return `${n < 0 ? '-' : ''}${currencySymbol(cur)}${Math.abs(n)
    .toFixed(dp)
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
}

export const percent = (v, dp = 0) => `${(Number(v || 0) * 100).toFixed(dp)}%`;

/** Percent typed as a whole number in inputs, stored as a fraction. */
export const toFraction = (v) => (Number.isFinite(parseFloat(v)) ? parseFloat(v) / 100 : 0);
export const toPercentInput = (v) => Math.round((Number(v || 0) * 100 + Number.EPSILON) * 100) / 100;

export const todayIso = () => new Date().toISOString().slice(0, 10);

export function addDays(dateIso, days) {
  const d = new Date(`${dateIso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/* --------------------------------------------------------------------- widgets */

export function field(label, control, hint) {
  return el('label', { class: 'field' }, el('span', { class: 'field-label' }, label), control, hint && el('span', { class: 'field-hint' }, hint));
}

export function input(props = {}) {
  return el('input', { class: 'input', ...props });
}

export function select(options, props = {}) {
  const node = el('select', { class: 'input', ...props });
  options.forEach(({ value, label }) => {
    node.appendChild(el('option', { value, selected: String(value) === String(props.value) }, label));
  });
  // Assigning after the options exist keeps the initial selection reliable.
  if (props.value !== undefined) node.value = props.value;
  return node;
}

export function button(label, props = {}) {
  const { variant = 'ghost', ...rest } = props;
  return el('button', { class: `btn btn-${variant}`, type: 'button', ...rest }, label);
}

export function card(...children) {
  return el('section', { class: 'card' }, ...children);
}

export function sectionTitle(text, action) {
  return el('div', { class: 'section-head' }, el('h2', { class: 'section-title' }, text), action || null);
}

export function empty(message, action) {
  return el('div', { class: 'empty' }, el('p', {}, message), action || null);
}

export function stat(label, value, sub) {
  return el(
    'div',
    { class: 'stat' },
    el('span', { class: 'stat-label' }, label),
    el('span', { class: 'stat-value' }, value),
    sub ? el('span', { class: 'stat-sub' }, sub) : null,
  );
}

export function pill(text, tone = '') {
  return el('span', { class: `pill ${tone ? `pill-${tone}` : ''}` }, text);
}

/* ----------------------------------------------------------- sheets and toasts */

/* Sheets stack: a product picker opened from a form has to sit on top of it, not
 * replace it, or the half-filled form underneath is lost. */
const sheetStack = [];

/** Bottom sheet — the iPhone-native way to show a form without losing the list behind it. */
export function sheet(title, content, { actions = [], onClose } = {}) {
  const body = el('div', { class: 'sheet-body' }, content);
  const panel = el(
    'div',
    { class: 'sheet-panel', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    el(
      'header',
      { class: 'sheet-head' },
      el('h2', {}, title),
      button('Close', { onclick: () => closeSheet(), 'aria-label': 'Close' }),
    ),
    body,
    actions.length ? el('footer', { class: 'sheet-foot' }, ...actions) : null,
  );
  const scrim = el('div', { class: 'sheet-scrim', onclick: () => closeSheet() });
  const root = el('div', { class: 'sheet' }, scrim, panel);
  // Each layer sits above the last so the stack reads as depth, not a redraw.
  root.style.zIndex = String(40 + sheetStack.length * 2);
  document.body.appendChild(root);
  document.body.classList.add('sheet-open');
  requestAnimationFrame(() => root.classList.add('is-open'));
  sheetStack.push({ root, onClose });
  return { root, body, close: closeSheet };
}

/** Close the topmost sheet. */
export function closeSheet() {
  const top = sheetStack.pop();
  if (!top) return;
  if (!sheetStack.length) document.body.classList.remove('sheet-open');
  top.root.classList.remove('is-open');
  setTimeout(() => top.root.remove(), 200);
  if (top.onClose) top.onClose();
}

/** Close every open sheet — used when the route changes underneath them. */
export function closeAllSheets() {
  while (sheetStack.length) closeSheet();
}

let toastTimer = null;
export function toast(message, tone = '') {
  document.querySelectorAll('.toast').forEach((t) => t.remove());
  const node = el('div', { class: `toast ${tone ? `toast-${tone}` : ''}`, role: 'status' }, message);
  document.body.appendChild(node);
  requestAnimationFrame(() => node.classList.add('is-open'));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    node.classList.remove('is-open');
    setTimeout(() => node.remove(), 250);
  }, 3200);
}

export function confirmSheet(title, message, confirmLabel = 'Delete') {
  return new Promise((resolve) => {
    let settled = false;
    const done = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const { close } = sheet(title, el('p', { class: 'prose' }, message), {
      actions: [
        button('Cancel', { onclick: () => closeSheet() }),
        button(confirmLabel, {
          variant: 'danger',
          onclick: () => {
            done(true);
            closeSheet();
          },
        }),
      ],
      onClose: () => done(false),
    });
    return close;
  });
}

/** Save a generated file. Safari needs a real anchor click and a tick before revoke. */
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: filename, style: { display: 'none' } });
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    a.remove();
    URL.revokeObjectURL(url);
  }, 2000);
}
