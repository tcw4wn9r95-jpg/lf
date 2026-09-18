/*
 * Figures sync.
 *
 * Reads a CSV of unit economics — one row per product — and folds it into local
 * storage. The same parser serves two routes:
 *
 *   - a file picked in Settings (a CSV exported from Sheets, or opened straight
 *     from Google Drive through the Files app), which keeps everything private;
 *   - a URL fetched over the network, so edits to the sheet reach the phone on
 *     their own.
 *
 * The URL route only works against a sheet published with File -> Share ->
 * Publish to web, because that is the only Google endpoint that sends CORS
 * headers a browser will accept. Publishing makes the sheet readable by anyone
 * holding the link, so the app asks before it is switched on and keeps the URL in
 * this phone's storage rather than in the repository.
 */

import { CATALOG, CATEGORIES } from './catalog.js';
import { load, update } from './store.js';

/* Accepted spellings for each column, lowercased and stripped of punctuation. */
const COLUMNS = {
  id: ['id', 'productid', 'product', 'sku', 'key'],
  name: ['name', 'productname', 'description', 'descripcion'],
  cost: ['cost', 'landedcost', 'unitcost', 'ddp', 'costodp', 'preciodpp', 'precioddp', 'costounitario'],
  rrp: ['rrp', 'price', 'retail', 'retailprice', 'pvp', 'precionormal', 'sellprice'],
  distributorDiscount: ['distributordiscount', 'distributor', 'descuentodistribuidor', 'tradediscount'],
  category: ['category', 'categoria'],
  code: ['code', 'modelnumber', 'model', 'codigo'],
  maker: ['maker', 'manufacturer', 'supplier', 'fabricante'],
  notes: ['notes', 'note', 'comment', 'comentario'],
};

const CATALOG_IDS = new Set(CATALOG.map((p) => p.id));
const CATEGORY_IDS = new Set(CATEGORIES.map((c) => c.id));

/* ------------------------------------------------------------------- parsing */

/** Minimal RFC 4180 reader: quoted fields, embedded commas, quotes and newlines. */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  // Strip a UTF-8 BOM, which Sheets includes and which would poison the first header.
  const src = text.replace(/^﻿/, '');

  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 1;
        } else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

const normalise = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

/** Money as typed by a human: "£1,234.56", "1.234,56", "(12.50)" for negatives. */
export function parseMoney(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  let s = String(value || '').trim();
  if (!s) return null;
  const negative = /^\(.*\)$/.test(s);
  s = s.replace(/[()]/g, '').replace(/[^\d.,-]/g, '');
  if (!s) return null;

  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma > lastDot) {
    // Continental notation: dots group, the comma is the decimal separator.
    s = s.replace(/\./g, '').replace(',', '.');
  } else {
    s = s.replace(/,/g, '');
  }

  const n = parseFloat(s);
  if (!Number.isFinite(n)) return null;
  return negative ? -n : n;
}

/** "25%" and "0.25" both mean a quarter; anything above 1 is read as a percentage. */
export function parseRate(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const n = parseMoney(raw);
  if (n === null) return null;
  if (raw.includes('%')) return n / 100;
  return n > 1 ? n / 100 : n;
}

/**
 * Turn CSV text into the store's shapes.
 * Returns { financials, newProducts, rows, skipped, errors }.
 */
export function parseFigures(text) {
  const rows = parseCsv(text);
  if (!rows.length) throw new Error('That file is empty.');

  const headerIndex = findHeaderRow(rows);
  if (headerIndex < 0) {
    throw new Error('No header row found. It needs columns named id and cost — see the template.');
  }

  const map = mapColumns(rows[headerIndex]);
  if (map.cost === undefined) throw new Error('No "cost" column found.');
  if (map.id === undefined && map.name === undefined) {
    throw new Error('Needs an "id" column (or at least "name") to know which product a row is.');
  }

  const financials = {};
  const newProducts = [];
  const errors = [];
  const skipped = [];
  const seen = new Set();

  rows.slice(headerIndex + 1).forEach((row, i) => {
    const line = headerIndex + i + 2; // 1-based, and past the header.
    const cell = (key) => (map[key] === undefined ? '' : (row[map[key]] || '').trim());

    const name = cell('name');
    const id = cell('id') || slugFromName(name);
    if (!id) return;

    if (seen.has(id)) {
      errors.push(`Line ${line}: "${id}" appears more than once — the later row wins.`);
    }
    seen.add(id);

    const cost = parseMoney(cell('cost'));
    if (cost === null) {
      skipped.push(`${name || id} (no cost)`);
      return;
    }
    if (cost < 0) {
      errors.push(`Line ${line}: "${id}" has a negative cost — ignored.`);
      return;
    }

    const entry = { cost };
    const rrp = parseMoney(cell('rrp'));
    if (rrp !== null && rrp > 0) entry.rrp = rrp;
    const dd = parseRate(cell('distributorDiscount'));
    if (dd !== null) entry.distributorDiscount = dd;
    const notes = cell('notes');
    if (notes) entry.notes = notes;

    financials[id] = entry;

    // A row whose id is not in the shipped catalogue becomes a product of its own,
    // so the sheet can introduce new lines without a code change.
    if (!CATALOG_IDS.has(id)) {
      const category = normalise(cell('category'));
      newProducts.push({
        id,
        name: name || id,
        code: cell('code'),
        maker: cell('maker'),
        category: CATEGORY_IDS.has(category) ? category : 'accessories',
        custom: true,
      });
    }
  });

  if (!Object.keys(financials).length) {
    throw new Error('No usable rows — every row was missing a cost.');
  }

  return { financials, newProducts, rows: Object.keys(financials).length, skipped, errors };
}

/** The header is the first row that names a cost column and an id or name column. */
function findHeaderRow(rows) {
  const limit = Math.min(rows.length, 20);
  for (let i = 0; i < limit; i += 1) {
    const map = mapColumns(rows[i]);
    if (map.cost !== undefined && (map.id !== undefined || map.name !== undefined)) return i;
  }
  return -1;
}

function mapColumns(headerRow) {
  const map = {};
  headerRow.forEach((raw, index) => {
    const key = normalise(raw);
    if (!key) return;
    Object.entries(COLUMNS).forEach(([field, aliases]) => {
      if (map[field] === undefined && aliases.includes(key)) map[field] = index;
    });
  });
  return map;
}

function slugFromName(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/* --------------------------------------------------------------------- apply */

/** Write a parsed result into the store. */
export function applyFigures(parsed) {
  update((d) => {
    Object.entries(parsed.financials).forEach(([id, entry]) => {
      // Merge so a hand-typed note or breakdown survives a sync that omits it.
      d.financials[id] = { ...(d.financials[id] || {}), ...entry };
    });
    parsed.newProducts.forEach((p) => {
      const existing = d.customProducts.findIndex((x) => x.id === p.id);
      if (existing >= 0) d.customProducts[existing] = { ...d.customProducts[existing], ...p };
      else d.customProducts.push(p);
    });
  });
  return parsed;
}

/* ---------------------------------------------------------------------- sync */

export function syncUrlIsUsable(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:';
  } catch {
    return false;
  }
}

/** True for the one Google endpoint that sends CORS headers a browser accepts. */
export function looksPublished(url) {
  return /docs\.google\.com\/spreadsheets\/d\/e\/[\w-]+\/pub/.test(url);
}

/**
 * Fetch the configured sheet and apply it.
 * Throws with a message worth showing the user; never leaves a half-applied import.
 */
export async function syncNow(url = load().settings.syncUrl) {
  if (!url) throw new Error('No sync link set.');
  if (!syncUrlIsUsable(url)) throw new Error('That is not an https link.');

  let res;
  try {
    res = await fetch(url, { cache: 'no-store', redirect: 'follow' });
  } catch {
    // A CORS rejection and a dead connection are indistinguishable from here, so
    // name the likely cause rather than the generic failure.
    throw new Error(
      looksPublished(url)
        ? 'Could not reach the sheet. Check the connection.'
        : 'The browser was blocked from reading that link. It has to be a sheet published with File → Share → Publish to web, as CSV.',
    );
  }

  if (!res.ok) {
    throw new Error(
      res.status === 404
        ? 'That link returned nothing. Re-copy it from Publish to web.'
        : `The sheet returned ${res.status}.`,
    );
  }

  const text = await res.text();
  if (/^\s*</.test(text)) {
    throw new Error('That link returned a web page, not CSV. Choose "Comma-separated values" when publishing.');
  }

  const parsed = parseFigures(text);
  applyFigures(parsed);

  update((d) => {
    d.settings.lastSyncAt = new Date().toISOString();
    d.settings.lastSyncSummary = `${parsed.rows} products`;
  });

  return parsed;
}

/** Sync quietly on open, at most once an hour, and never block the interface. */
export async function maybeAutoSync() {
  const { settings } = load();
  if (!settings.syncAuto || !settings.syncUrl) return null;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return null;

  const last = settings.lastSyncAt ? new Date(settings.lastSyncAt).getTime() : 0;
  if (Date.now() - last < 60 * 60 * 1000) return null;

  try {
    return await syncNow(settings.syncUrl);
  } catch (err) {
    console.warn('Background sync failed', err);
    return null;
  }
}

/* ------------------------------------------------------------------ template */

/** A CSV of the current catalogue and figures, in the shape the sync expects. */
export function figuresTemplateCsv() {
  const data = load();
  const all = [...CATALOG, ...data.customProducts];
  const header = ['id', 'name', 'code', 'category', 'maker', 'cost', 'rrp', 'distributor_discount', 'notes'];

  const lines = all.map((p) => {
    const fin = data.financials[p.id] || {};
    return [
      p.id,
      p.name,
      p.code || '',
      p.category || '',
      p.maker || '',
      fin.cost ?? '',
      fin.rrp ?? '',
      fin.distributorDiscount ?? '',
      fin.notes || '',
    ]
      .map(csvCell)
      .join(',');
  });

  return [header.join(','), ...lines].join('\n');
}

function csvCell(value) {
  const s = String(value ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
