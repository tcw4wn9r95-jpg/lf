/*
 * Local store.
 *
 * Everything lives in this browser's localStorage and nowhere else: no server,
 * no sync, no analytics. That is deliberate — product costs and sales are the
 * commercially sensitive part of the business and they should not leave the phone.
 *
 * The flipside is that clearing Safari's website data wipes it, so Settings keeps
 * an export button and nags if a backup is stale.
 */

import { CATALOG } from './catalog.js';

const KEY = 'lafuga.v1';
const SCHEMA = 1;

export const DEFAULTS = Object.freeze({
  schema: SCHEMA,
  company: {
    name: 'La Fuga Limited',
    tradingName: 'La Fuga Cycling Society',
    addressLines: ['39 Alpine View', 'Carshalton', 'Surrey', 'SM5 3QJ', 'United Kingdom'],
    companyNumber: '15877615',
    vatNumber: 'GB 486 5028 65',
    eori: 'GB099728444000',
    email: 'hello@lafuga.eu',
    website: 'lafuga.eu',
    bank: { name: '', account: '', sortCode: '', iban: '', bic: '' },
  },
  settings: {
    currency: 'GBP',
    vatRate: 0.2,
    /* The margin a quote should not go below. Drives the verdict on every line. */
    minMargin: 0.3,
    /* How a quotation presents prices, and the VAT wording that goes with it. */
    priceDisplay: 'both',
    vatNote: '',
    commissionRate: 0.02,
    /* Unit-economics assumptions, from the financial model's Suposiciones tab. */
    saleDiscount: 0.05,
    collabDiscount: 0.2,
    distributorDiscount: 0.3,
    insuranceRate: 0.05,
    incomeTaxRate: 0.25,
    /* Import VAT is reclaimable when VAT-registered; off keeps parity with the sheet. */
    reclaimImportVat: false,
    /* The VAT rate the financial model itself assumed, used only to explain how the
       spreadsheet reached its numbers. Never used to price anything. */
    modelVatRate: 0.21,
    quoteValidDays: 30,
    paymentTerms: '50% deposit to confirm the order, balance due before dispatch.',
    leadTime: '6–8 weeks from artwork sign-off.',
    quotePrefix: 'LF',
    nextQuoteNumber: 1,
    monthlyOverheads: 950,
    discountPresets: [
      { label: 'Club / team', value: 0.1 },
      { label: 'Collab', value: 0.2 },
      { label: 'Distributor', value: 0.3 },
    ],
    footerNote: '',
    lastBackupAt: null,
    /* Claude assist for landed-cost estimates. The key lives on this device only,
       never in the repository and never in an export shared with anyone. */
    claudeApiKey: '',
    claudeModel: 'claude-sonnet-5',
    /* What a made-to-order job defaults to before anyone touches it. */
    customIncoterm: 'FOB',
    customDestination: 'GB',
    /* Figures sync. The link lives here, on the phone — never in the repository. */
    syncUrl: '',
    syncAuto: false,
    lastSyncAt: null,
    lastSyncSummary: '',
  },
  /* productId -> { cost, rrp, breakdown?, notes? }. Populated only by import. */
  financials: {},
  /* Products added by hand on the phone, on top of the shipped catalogue. */
  customProducts: [],
  quotes: [],
  sales: [],
  deadlines: { completed: {}, custom: [], dismissed: [] },
});

let cache = null;
const listeners = new Set();

export function load() {
  if (cache) return cache;
  let saved = null;
  try {
    saved = JSON.parse(localStorage.getItem(KEY) || 'null');
  } catch {
    saved = null;
  }
  cache = migrate(saved);
  return cache;
}

export function save(next) {
  cache = next || cache;
  try {
    localStorage.setItem(KEY, JSON.stringify(cache));
  } catch (err) {
    // Quota is the realistic failure here; tell the caller rather than losing data silently.
    console.error('Could not save', err);
    throw new Error('Storage is full — export a backup and remove old quotes.');
  }
  listeners.forEach((fn) => fn(cache));
  return cache;
}

/** Mutate and persist in one step: update(d => { d.sales.push(sale); }). */
export function update(mutator) {
  const data = load();
  mutator(data);
  return save(data);
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function migrate(saved) {
  if (!saved || typeof saved !== 'object') return structuredClone(DEFAULTS);
  const base = structuredClone(DEFAULTS);
  return {
    ...base,
    ...saved,
    schema: SCHEMA,
    company: { ...base.company, ...(saved.company || {}), bank: { ...base.company.bank, ...(saved.company?.bank || {}) } },
    settings: { ...base.settings, ...(saved.settings || {}) },
    financials: saved.financials || {},
    customProducts: saved.customProducts || [],
    // Quotations written before prices could be shown either way were inclusive
    // of VAT; pin them there so a reprint matches what the customer was sent.
    quotes: (saved.quotes || []).map((q) => (q.priceDisplay ? q : { ...q, priceDisplay: 'incl' })),
    sales: saved.sales || [],
    deadlines: { ...base.deadlines, ...(saved.deadlines || {}) },
  };
}

/* ---------------------------------------------------------------- products */

/** Catalogue plus hand-added products, each merged with its local financials. */
export function products() {
  const data = load();
  const all = [...CATALOG, ...data.customProducts];
  return all.map((p) => {
    const fin = data.financials[p.id] || {};
    return {
      ...p,
      cost: numberOr(fin.cost, null),
      rrp: numberOr(fin.rrp, null),
      breakdown: fin.breakdown || null,
      distributorDiscount: numberOr(fin.distributorDiscount, null),
      /* Made-to-order extras on top of a base product, and the markup they price at. */
      customisations: Array.isArray(fin.customisations) ? fin.customisations : [],
      basedOn: fin.basedOn || p.basedOn || null,
      markup: numberOr(fin.markup, null),
      /* Incoterm, destination and the duty rates this was costed under. */
      landedTerms: fin.landedTerms || null,
      notes: fin.notes || '',
      hasFinancials: Number.isFinite(numberOr(fin.cost, null)),
    };
  });
}

export function product(id) {
  return products().find((p) => p.id === id) || null;
}

export function setFinancials(id, patch) {
  return update((d) => {
    d.financials[id] = { ...(d.financials[id] || {}), ...patch };
  });
}

export function hasFinancials() {
  const data = load();
  return Object.keys(data.financials).length > 0;
}

/* ------------------------------------------------------------ import/export */

export function exportBundle({ includeFinancials = true } = {}) {
  const data = load();
  // A backup gets mailed to yourself, dropped in Drive, handed to an accountant.
  // The API key is a live credential and has no business travelling with it.
  const { claudeApiKey, ...settings } = data.settings;
  return {
    kind: 'lafuga-backup',
    schema: SCHEMA,
    exportedAt: new Date().toISOString(),
    company: data.company,
    settings,
    financials: includeFinancials ? data.financials : {},
    customProducts: data.customProducts,
    quotes: data.quotes,
    sales: data.sales,
    deadlines: data.deadlines,
  };
}

/**
 * Merge an import. A file carrying only `financials` tops up unit economics and
 * leaves quotes and sales alone; a full backup replaces everything it contains.
 */
export function importBundle(raw, { replace = false } = {}) {
  const incoming = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (!incoming || typeof incoming !== 'object') throw new Error('That file is not valid JSON.');
  if (incoming.kind && !['lafuga-backup', 'lafuga-financials'].includes(incoming.kind)) {
    throw new Error(`Unrecognised file (kind: ${incoming.kind}).`);
  }

  const summary = { financials: 0, quotes: 0, sales: 0, customProducts: 0 };

  update((d) => {
    if (incoming.company) d.company = { ...d.company, ...incoming.company };
    if (incoming.settings) d.settings = { ...d.settings, ...incoming.settings };

    if (incoming.financials) {
      summary.financials = Object.keys(incoming.financials).length;
      d.financials = replace ? incoming.financials : { ...d.financials, ...incoming.financials };
    }
    if (Array.isArray(incoming.customProducts)) {
      summary.customProducts = incoming.customProducts.length;
      d.customProducts = replace ? incoming.customProducts : mergeById(d.customProducts, incoming.customProducts);
    }
    if (Array.isArray(incoming.quotes)) {
      summary.quotes = incoming.quotes.length;
      d.quotes = replace ? incoming.quotes : mergeById(d.quotes, incoming.quotes);
    }
    if (Array.isArray(incoming.sales)) {
      summary.sales = incoming.sales.length;
      d.sales = replace ? incoming.sales : mergeById(d.sales, incoming.sales);
    }
    if (incoming.deadlines) {
      d.deadlines = replace
        ? { ...DEFAULTS.deadlines, ...incoming.deadlines }
        : {
            completed: { ...d.deadlines.completed, ...(incoming.deadlines.completed || {}) },
            custom: mergeById(d.deadlines.custom, incoming.deadlines.custom || []),
            dismissed: [...new Set([...(d.deadlines.dismissed || []), ...(incoming.deadlines.dismissed || [])])],
          };
    }
  });

  return summary;
}

function mergeById(existing, incoming) {
  const byId = new Map(existing.map((x) => [x.id, x]));
  incoming.forEach((x) => byId.set(x.id, x));
  return [...byId.values()];
}

export function wipe() {
  localStorage.removeItem(KEY);
  cache = null;
  listeners.forEach((fn) => fn(load()));
}

/* ------------------------------------------------------------------ quotes */

export function nextQuoteRef() {
  const { settings } = load();
  const year = new Date().getFullYear();
  const seq = String(settings.nextQuoteNumber || 1).padStart(3, '0');
  return `${settings.quotePrefix || 'LF'}-${year}-${seq}`;
}

export function saveQuote(quote) {
  return update((d) => {
    const idx = d.quotes.findIndex((q) => q.id === quote.id);
    if (idx >= 0) d.quotes[idx] = quote;
    else {
      d.quotes.unshift(quote);
      d.settings.nextQuoteNumber = (d.settings.nextQuoteNumber || 1) + 1;
    }
  });
}

export function deleteQuote(id) {
  return update((d) => {
    d.quotes = d.quotes.filter((q) => q.id !== id);
  });
}

/* ------------------------------------------------------------------- sales */

export function saveSale(sale) {
  return update((d) => {
    const idx = d.sales.findIndex((s) => s.id === sale.id);
    if (idx >= 0) d.sales[idx] = sale;
    else d.sales.unshift(sale);
    d.sales.sort((a, b) => (a.date < b.date ? 1 : -1));
  });
}

export function deleteSale(id) {
  return update((d) => {
    d.sales = d.sales.filter((s) => s.id !== id);
  });
}

/* ------------------------------------------------------------------ helpers */

export function uid(prefix = 'id') {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

function numberOr(v, fallback) {
  const n = typeof v === 'string' ? parseFloat(v) : v;
  return Number.isFinite(n) ? n : fallback;
}
