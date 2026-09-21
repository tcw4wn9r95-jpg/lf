/* Quotations — the list, and the builder that produces the branded PDF. */

import { CATEGORIES, CATEGORY_LABEL, displayName } from '../catalog.js';
import { load, products, saveQuote, deleteQuote, nextQuoteRef, uid, saveSale } from '../store.js';
import { customiseProduct } from './products.js';
import {
  COUNTRIES, INCOTERMS, country, supplyTreatment, SELLER_COUNTRY, originCode,
  incoterm, CARRIERS, carrierLabel, shipmentSize,
} from '../landed.js';
import { estimateShipping, estimateCustoms } from '../claude.js';
import {
  priceQuote, breakEvenDiscount, maxDiscountForMargin, marginVerdict, VERDICT_TONE,
  VAT_PRESETS, PRICE_DISPLAY, suggestedVatNote, costStack, costBasis, COST_BASIS_LABEL,
} from '../pricing.js';
import { buildQuotePdf, quoteFilename } from '../pdf.js';
import { loadBrandFonts } from '../fonts.js';
import {
  el, card, sectionTitle, empty, button, input, select, field, sheet, closeSheet, toast, pill,
  currency, percent, toFraction, toPercentInput, todayIso, addDays, confirmSheet, downloadBlob,
} from '../ui.js';

const STATUSES = ['draft', 'sent', 'accepted', 'declined'];

export default function quotesView({ params, navigate }) {
  if (!params[0]) return list(navigate);
  // The builder holds an unsaved draft in memory, so it must not be redrawn from
  // under the user when the store changes.
  document.getElementById('view').dataset.volatile = 'true';
  return editor(params[0], navigate);
}

/* --------------------------------------------------------------------- list */

function list(navigate) {
  const data = load();
  const wrap = el('div');

  wrap.appendChild(el('h1', { class: 'page-title' }, 'Quotations'));
  wrap.appendChild(el('p', { class: 'page-sub' }, data.quotes.length ? `${data.quotes.length} saved` : 'None yet'));

  wrap.appendChild(
    el('div', { class: 'btn-row' }, button('New quotation', { variant: 'primary', onclick: () => navigate('#/quotes/new') })),
  );

  if (!data.quotes.length) {
    wrap.appendChild(empty('Quotations you build here stay on this phone until you share the PDF.'));
    return wrap;
  }

  const listEl = el('div', { class: 'list' });
  data.quotes.forEach((q) => {
    const totals = priceQuote(q);
    const floor = q.minMargin ?? data.settings.minMargin;
    const verdict = marginVerdict(totals.margin, floor, totals.profit);
    listEl.appendChild(
      el(
        'button',
        { class: 'row', type: 'button', onclick: () => navigate(`#/quotes/${q.id}`) },
        el(
          'div',
          { class: 'row-main' },
          el('div', { class: 'row-title' }, q.client?.name || 'Untitled'),
          el('div', { class: 'row-sub' }, `${q.ref} · ${q.date} · ${q.status || 'draft'}`),
        ),
        el(
          'div',
          { class: 'row-end' },
          el('div', { class: 'row-value' }, currency(totals.total, { code: q.currency })),
          el(
            'div',
            { class: `row-value-sub ${verdict === 'ok' ? '' : `text-${VERDICT_TONE[verdict]}`}` },
            `${percent(totals.margin)} margin`,
          ),
        ),
      ),
    );
  });
  wrap.appendChild(listEl);

  return wrap;
}

/* ------------------------------------------------------------------- editor */

function blankQuote() {
  const { settings } = load();
  return {
    id: uid('q'),
    ref: nextQuoteRef(),
    date: todayIso(),
    validUntil: addDays(todayIso(), settings.quoteValidDays || 30),
    status: 'draft',
    client: { name: '', contact: '', email: '', phone: '', address: '', country: '', vatNumber: '' },
    subject: '',
    currency: settings.currency,
    /* Where the goods physically leave from, which decides whether this is a UK
       export at all: our own stock, or straight off the factory floor. */
    shipsFrom: SELLER_COUNTRY,
    incoterm: settings.customIncoterm || '',
    remarks: '',
    /* What it costs to get the order there and through customs. Order-level,
       so it lives here rather than being smeared across the lines. */
    logistics: {
      carrier: 'fedex',
      originPostcode: '',
      destPostcode: '',
      dimensions: '',
      grossKg: null,
      cartons: null,
      shipping: null,
      customs: null,
      chargeToCustomer: false,
      chargeAmount: null,
    },
    vatRate: settings.vatRate,
    minMargin: settings.minMargin,
    priceDisplay: settings.priceDisplay,
    vatNote: settings.vatNote,
    discount: 0,
    commissionRate: settings.commissionRate,
    leadTime: settings.leadTime,
    paymentTerms: settings.paymentTerms,
    notes: '',
    lines: [],
  };
}

function editor(id, navigate) {
  const data = load();
  const existing = id === 'new' ? null : data.quotes.find((q) => q.id === id);
  if (id !== 'new' && !existing) {
    return el('div', {}, el('h1', { class: 'page-title' }, 'Not found'), button('Back to quotations', { onclick: () => navigate('#/quotes') }));
  }

  // Work on a copy so abandoning the screen never half-saves a quote.
  const quote = existing ? structuredClone(existing) : blankQuote();
  const wrap = el('div');
  const totalsSlot = el('div');
  const linesSlot = el('div');
  const pricingSlot = el('div');
  const crossSlot = el('div');

  // The cross-border panel reads the VAT rate and the lines, so it refreshes
  // whenever either moves. Pricing is only redrawn when something else changes
  // the rate underneath it, or a half-typed VAT note would vanish mid-keystroke.
  const redrawCross = () => {
    crossSlot.replaceChildren(
      crossBorderPanel(quote, {
        onChange: () => {
          // Where the goods leave from decides which cost the lines carry, so
          // this is not just a note changing.
          redrawCross();
          redrawTotals();
          if (typeof drawLogistics === 'function') drawLogistics();
        },
        onApply: () => {
          pricingSlot.replaceChildren(pricingPanel(quote, onPricingChange));
          redrawCross();
          redrawTotals();
        },
      }),
    );
  };

  const redrawTotals = () => {
    totalsSlot.replaceChildren(totalsPanel(quote));
    linesSlot.replaceChildren(linesPanel(quote, onPricingChange));
  };

  function onPricingChange() {
    redrawTotals();
    redrawCross();
    if (typeof drawLogistics === 'function') drawLogistics();
  }

  wrap.appendChild(el('h1', { class: 'page-title' }, existing ? quote.ref : 'New quotation'));
  wrap.appendChild(el('p', { class: 'page-sub' }, existing ? `Saved ${quote.date}` : `Reference ${quote.ref}`));

  /* Client */
  wrap.appendChild(sectionTitle('Client'));
  const clientSlot = el('div', { class: 'list' });
  const drawClient = () => {
    clientSlot.replaceChildren(
      el(
        'button',
        {
          class: 'row',
          type: 'button',
          onclick: () =>
            editClient(quote, () => {
              drawClient();
              // The country may have changed, which changes the VAT treatment.
              redrawCross();
            }),
        },
        el(
          'div',
          { class: 'row-main' },
          el('div', { class: 'row-title' }, quote.client.name || 'Add client details'),
          el(
            'div',
            { class: 'row-sub' },
            [quote.client.contact, quote.client.email].filter(Boolean).join(' · ') || 'Name, contact, address',
          ),
        ),
        el('div', { class: 'row-chevron' }, '›'),
      ),
    );
  };
  drawClient();
  wrap.appendChild(clientSlot);

  /* Where it is going, and on whose terms */
  wrap.appendChild(sectionTitle('Destination & VAT'));
  wrap.appendChild(crossSlot);

  /* Pricing controls */
  wrap.appendChild(sectionTitle('Pricing'));
  pricingSlot.appendChild(pricingPanel(quote, onPricingChange));
  wrap.appendChild(pricingSlot);

  /* Items */
  wrap.appendChild(
    sectionTitle('Items', button('Add', { variant: 'quiet', onclick: () => pickProducts(quote, onPricingChange) })),
  );
  wrap.appendChild(linesSlot);

  /* Shipping and customs — after the items, because both are worked out from them */
  wrap.appendChild(sectionTitle('Shipping & customs'));
  const logisticsSlot = el('div', { class: 'list' });
  const drawLogistics = () => {
    const t = priceQuote(quote);
    logisticsSlot.replaceChildren(
      el(
        'button',
        { class: 'row', type: 'button', onclick: () => logisticsSheet(quote, () => { drawLogistics(); redrawTotals(); redrawCross(); }) },
        el(
          'div',
          { class: 'row-main' },
          el('div', { class: 'row-title' }, t.logisticsCost ? 'Shipping & customs' : 'Calculate shipping & customs'),
          el(
            'div',
            { class: 'row-sub' },
            t.logisticsCost
              ? `${carrierLabel(quote.logistics?.carrier)}${t.logistics.chargeToCustomer ? ' · charged to the customer' : ' · absorbed'}`
              : quote.lines.length
                ? 'Work out the freight and the border with Claude'
                : 'Add the products first',
          ),
        ),
        t.logisticsCost
          ? el('div', { class: 'row-end' }, el('div', { class: 'row-value' }, currency(t.logisticsCost, { code: quote.currency })))
          : el('div', { class: 'row-chevron' }, '›'),
      ),
    );
  };
  drawLogistics();
  wrap.appendChild(logisticsSlot);

  /* Totals */
  wrap.appendChild(sectionTitle('Totals'));
  wrap.appendChild(totalsSlot);

  /* Presentation */
  wrap.appendChild(sectionTitle('On the PDF'));
  wrap.appendChild(presentationPanel(quote));

  redrawTotals();
  redrawCross();

  /* Actions */
  wrap.appendChild(
    el(
      'div',
      { class: 'btn-row' },
      button('Save', {
        onclick: () => {
          if (!validate(quote)) return;
          saveQuote(quote);
          toast('Quotation saved.');
          navigate('#/quotes');
        },
      }),
      button('PDF', {
        variant: 'primary',
        onclick: () => {
          if (!validate(quote)) return;
          saveQuote(quote);
          exportPdf(quote);
        },
      }),
    ),
  );

  if (existing) {
    wrap.appendChild(
      el(
        'div',
        { class: 'btn-row' },
        button('Log as sale', {
          onclick: () => {
            const totals = priceQuote(quote);
            if (!totals.lines.length) return toast('Add items first.', 'alert');
            logQuoteAsSale(quote, navigate);
          },
        }),
        button('Delete', {
          variant: 'danger',
          onclick: async () => {
            if (!(await confirmSheet('Delete quotation', `Delete ${quote.ref}? This cannot be undone.`))) return;
            deleteQuote(quote.id);
            toast('Quotation deleted.');
            navigate('#/quotes');
          },
        }),
      ),
    );
  }

  wrap.appendChild(el('div', { class: 'btn-row' }, button('Back', { variant: 'quiet', onclick: () => navigate('#/quotes') })));

  return wrap;
}

function validate(quote) {
  if (!quote.client.name.trim()) {
    toast('The quotation needs a client name.', 'alert');
    return false;
  }
  if (!quote.lines.length) {
    toast('Add at least one item.', 'alert');
    return false;
  }
  return true;
}

/* ------------------------------------------------------------------- panels */

function pricingPanel(quote, onChange) {
  const vatInput = input({ type: 'number', step: '1', inputmode: 'decimal', value: toPercentInput(quote.vatRate) });
  const discountInput = input({ type: 'number', step: '1', inputmode: 'decimal', value: toPercentInput(quote.discount) });
  const floorInput = input({ type: 'number', step: '1', inputmode: 'decimal', value: toPercentInput(quote.minMargin) });

  vatInput.addEventListener('input', () => {
    quote.vatRate = toFraction(vatInput.value);
    onChange();
  });
  discountInput.addEventListener('input', () => {
    quote.discount = toFraction(discountInput.value);
    onChange();
  });
  floorInput.addEventListener('input', () => {
    quote.minMargin = toFraction(floorInput.value);
    onChange();
  });

  const presets = el(
    'div',
    { class: 'chips' },
    ...load().settings.discountPresets.map((preset) =>
      el(
        'button',
        {
          class: 'chip',
          type: 'button',
          'aria-pressed': String(Math.abs(quote.discount - preset.value) < 0.0001),
          onclick: (e) => {
            const same = Math.abs(quote.discount - preset.value) < 0.0001;
            quote.discount = same ? 0 : preset.value;
            discountInput.value = toPercentInput(quote.discount);
            e.currentTarget.parentElement.querySelectorAll('.chip').forEach((c) => c.setAttribute('aria-pressed', 'false'));
            e.currentTarget.setAttribute('aria-pressed', String(!same));
            onChange();
          },
        },
        `${preset.label} ${percent(preset.value)}`,
      ),
    ),
  );

  const vatChips = el(
    'div',
    { class: 'chips' },
    ...VAT_PRESETS.map((preset) =>
      el(
        'button',
        {
          class: 'chip',
          type: 'button',
          'aria-pressed': String(Math.abs(quote.vatRate - preset.value) < 0.0001),
          onclick: (e) => {
            quote.vatRate = preset.value;
            vatInput.value = toPercentInput(preset.value);
            e.currentTarget.parentElement.querySelectorAll('.chip').forEach((c) => c.setAttribute('aria-pressed', 'false'));
            e.currentTarget.setAttribute('aria-pressed', 'true');
            // The suggestion lives in the placeholder, so switching rate just
            // re-suggests; anything typed by hand is left alone.
            noteInput.placeholder = suggestedVatNote(preset.value, load().company);
            onChange();
          },
        },
        preset.label,
      ),
    ),
  );

  const noteInput = el('textarea', {
    class: 'input',
    placeholder: suggestedVatNote(quote.vatRate, load().company),
  }, quote.vatNote || '');
  noteInput.addEventListener('input', () => {
    quote.vatNote = noteInput.value;
  });

  const displaySelect = select(
    Object.entries(PRICE_DISPLAY).map(([value, label]) => ({ value, label })),
    { value: quote.priceDisplay || 'both' },
  );
  displaySelect.addEventListener('change', () => {
    quote.priceDisplay = displaySelect.value;
    onChange();
  });

  return card(
    el(
      'p',
      { class: 'prose' },
      'Every line starts at its retail price. Discount from there and the panel below says whether it works.',
    ),
    field('Discount off retail %', discountInput, 'Applies to every line'),
    presets,
    el(
      'div',
      { class: 'field-grid' },
      field('VAT %', vatInput),
      field('Margin floor %', floorInput, 'Flags anything below'),
    ),
    vatChips,
    field('Show prices', displaySelect, 'How the quotation reads'),
    field('VAT note', noteInput, 'Printed under the totals'),
  );
}

/** One unit price, written the way this quotation is set to present prices. */
function unitLabel(line, quote) {
  const code = quote.currency;
  if (!quote.vatRate) return currency(line.unitGross, { code });
  if (quote.priceDisplay === 'incl') return currency(line.unitGross, { code });
  if (quote.priceDisplay === 'excl') return `${currency(line.unitNet, { code })} + VAT`;
  return `${currency(line.unitNet, { code })} + VAT = ${currency(line.unitGross, { code })}`;
}

function linesPanel(quote, onChange) {
  if (!quote.lines.length) return empty('No items yet. Add products to build the quotation.');

  const totals = priceQuote(quote);
  const box = el('div', { class: 'list' });

  const floor = quote.minMargin ?? load().settings.minMargin;

  totals.lines.forEach((line, index) => {
    const verdict = marginVerdict(line.margin, floor, line.profit);
    const qtyInput = input({
      class: 'input qty',
      type: 'number',
      inputmode: 'numeric',
      min: '1',
      step: '1',
      value: line.qty,
      'aria-label': `Quantity for ${line.name}`,
    });
    qtyInput.addEventListener('input', () => {
      quote.lines[index].qty = Math.max(0, parseInt(qtyInput.value, 10) || 0);
      onChange();
    });

    box.appendChild(
      el(
        'div',
        { class: 'line-item' },
        el(
          'button',
          {
            class: 'row-main',
            type: 'button',
            style: { background: 'none', border: 0, padding: 0, font: 'inherit', textAlign: 'left', color: 'inherit' },
            onclick: () => editLine(quote, index, onChange),
          },
          el('div', { class: 'row-title' }, line.name),
          el(
            'div',
            { class: `row-sub ${verdict === 'ok' ? '' : `text-${VERDICT_TONE[verdict]}`}` },
            [
              // Show the journey from list to quoted price, so the discount is legible.
              line.discountApplied > 0.0001
                ? `${currency(line.listGross, { code: quote.currency })} → ${unitLabel(line, quote)}`
                : `${unitLabel(line, quote)} each`,
              line.discountApplied > 0.0001 ? `${percent(line.discountApplied)} off` : null,
              `${percent(line.margin)} margin`,
            ]
              .filter(Boolean)
              .join(' · '),
          ),
        ),
        qtyInput,
        el(
          'div',
          { class: 'row-end' },
          el('div', { class: 'row-value' }, currency(line.grossTotal, { code: quote.currency })),
          verdict !== 'ok' ? pill(verdict === 'loss' ? 'below cost' : 'thin', VERDICT_TONE[verdict]) : null,
        ),
      ),
    );
  });

  return box;
}

function totalsPanel(quote) {
  const t = priceQuote(quote);
  const code = quote.currency;
  const floor = quote.minMargin ?? load().settings.minMargin;
  const verdict = marginVerdict(t.margin, floor, t.profit);
  const losers = t.lines.filter((l) => l.profit < 0);
  const thinLines = t.lines.filter((l) => l.profit >= 0 && floor > 0 && l.margin < floor);

  const table = el('table', { class: 'ledger' });
  const tbody = el('tbody');

  const row = (label, value, cls = '') => tbody.appendChild(el('tr', { class: cls }, el('td', {}, label), el('td', {}, value)));

  if (t.discountValue > 0.004) {
    row('Retail value', currency(t.listGrossSubtotal, { code }));
    row('Discount', `-${currency(t.discountValue, { code })}`);
  }
  row('Net of VAT', currency(t.subtotal, { code }));
  row(`VAT at ${percent(t.vatRate)}`, currency(t.vat, { code }));
  tbody.appendChild(
    el(
      'tr',
      { class: 'is-total' },
      el('td', {}, `Total incl. VAT (${t.units} units)`),
      el('td', {}, currency(t.total, { code })),
    ),
  );
  table.appendChild(tbody);

  const detail = el('table', { class: 'ledger' });
  const dbody = el('tbody');
  dbody.appendChild(el('tr', {}, el('td', {}, 'Cost of goods'), el('td', {}, currency(t.costTotal, { code }))));
  if (t.logisticsCost > 0.004) {
    dbody.appendChild(
      el('tr', {}, el('td', {}, 'Shipping & customs'), el('td', {}, currency(t.logisticsCost, { code }))),
    );
  }
  if (t.commission > 0.004) {
    dbody.appendChild(
      el('tr', {}, el('td', {}, `Commission at ${percent(quote.commissionRate)}`), el('td', {}, currency(t.commission, { code }))),
    );
  }
  dbody.appendChild(
    el(
      'tr',
      { class: t.profit < 0 ? 'is-alert' : 'is-good' },
      el('td', {}, 'Gross profit'),
      el('td', {}, currency(t.profit, { code })),
    ),
  );
  detail.appendChild(dbody);

  const headline = { ok: 'You can do this', thin: 'Tight, but not a loss', loss: 'Do not send this' }[verdict];
  const reason = {
    ok: `${percent(t.margin, 1)} margin, clear of your ${percent(floor)} floor. ${currency(t.profit, { code })} on the order.`,
    thin: `${percent(t.margin, 1)} margin is under your ${percent(floor)} floor. Still ${currency(t.profit, { code })} on the order.`,
    loss: `${percent(t.margin, 1)} margin — this order loses ${currency(Math.abs(t.profit), { code })}.`,
  }[verdict];

  const callouts = [];
  if (losers.length) callouts.push(`Below cost: ${losers.map((l) => l.name).join(', ')}.`);
  if (thinLines.length) callouts.push(`Under the floor: ${thinLines.map((l) => l.name).join(', ')}.`);

  return card(
    t.units
      ? el(
          'div',
          { class: `verdict verdict-${verdict}` },
          el('div', { class: 'verdict-head' }, headline),
          el('div', { class: 'verdict-body' }, reason),
          ...callouts.map((text) => el('div', { class: 'verdict-detail' }, text)),
        )
      : null,
    table,
    el('hr', { class: 'divider' }),
    detail,
    el(
      'div',
      { class: `margin-bar ${verdict === 'loss' ? 'is-alert' : ''}` },
      el('span', { style: { width: `${Math.max(0, Math.min(1, t.margin)) * 100}%` } }),
    ),
    el('p', { class: 'inline-note' }, `${percent(t.margin, 1)} net margin · ${percent(t.markupOnCost, 0)} on cost`),
  );
}

function presentationPanel(quote) {
  const subject = el('textarea', { class: 'input', placeholder: 'What the quotation covers' }, quote.subject);
  subject.addEventListener('input', () => {
    quote.subject = subject.value;
  });

  const lead = input({ value: quote.leadTime });
  lead.addEventListener('input', () => {
    quote.leadTime = lead.value;
  });

  const terms = el('textarea', { class: 'input' }, quote.paymentTerms);
  terms.addEventListener('input', () => {
    quote.paymentTerms = terms.value;
  });

  const notes = el('textarea', { class: 'input', placeholder: 'Anything else the client should read' }, quote.notes);
  notes.addEventListener('input', () => {
    quote.notes = notes.value;
  });

  const remarks = el(
    'textarea',
    { class: 'input', rows: '4', placeholder: 'Sizing run, artwork deadline, what the price assumes…' },
    quote.remarks || '',
  );
  remarks.addEventListener('input', () => {
    quote.remarks = remarks.value;
  });

  const date = input({ type: 'date', value: quote.date });
  date.addEventListener('change', () => {
    quote.date = date.value;
  });

  const valid = input({ type: 'date', value: quote.validUntil });
  valid.addEventListener('change', () => {
    quote.validUntil = valid.value;
  });

  const status = select(STATUSES.map((s) => ({ value: s, label: s[0].toUpperCase() + s.slice(1) })), { value: quote.status });
  status.addEventListener('change', () => {
    quote.status = status.value;
  });

  return card(
    field('Subject', subject),
    el('div', { class: 'field-grid' }, field('Date', date), field('Valid until', valid)),
    field('Lead time', lead),
    field('Payment terms', terms),
    field('Notes', notes),
    field('Additional remarks', remarks, 'Printed in full under the terms'),
    field('Status', status),
  );
}



/* ------------------------------------------------------ shipping & customs */

/** The postcode buried in the company's address lines, for the origin field. */
function ownPostcode(company) {
  const found = (company?.addressLines || []).find((l) => /\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/i.test(l));
  return found ? found.trim() : '';
}

/** The quote's lines as the estimators want them: named, counted, valued. */
function shipmentItems(quote, totals, resolve) {
  return totals.lines.map((l) => {
    const p = resolve(l.productId);
    return {
      name: l.name,
      qty: l.qty,
      category: p ? CATEGORY_LABEL[p.category] || p.category : '',
      unitValue: l.unitNet,
      lineValue: l.netTotal,
    };
  });
}

/**
 * What the order costs to ship and to clear.
 *
 * Two separate questions asked of two separate estimators, because they fail
 * differently: a carrier rate is a lane and a weight, while a customs entry is a
 * classification and a trade treatment. Answering them together would let a
 * confident freight number carry a shaky duty number along with it.
 */
function logisticsSheet(quote, onDone) {
  const { settings, company } = load();
  const all = products();
  const resolve = (id) => all.find((p) => p.id === id) || null;
  const totals = priceQuote(quote);
  const size = shipmentSize(quote.lines, resolve);

  const L = quote.logistics || (quote.logistics = {});
  if (!L.originPostcode && (quote.shipsFrom || SELLER_COUNTRY) === SELLER_COUNTRY) {
    L.originPostcode = ownPostcode(company);
  }
  if (!Number.isFinite(L.grossKg)) L.grossKg = size.grossKg;
  if (!Number.isFinite(L.cartons)) L.cartons = size.cartons;

  const body = el('div');
  let lastError = null;
  const draw = () => {
    const bits = [];
    const key = load().settings.claudeApiKey;
    const fromCountry = country(quote.shipsFrom || SELLER_COUNTRY);
    const toCountry = country(quote.client.country);

    if (!quote.lines.length) {
      bits.push(el('p', { class: 'inline-note text-alert' }, 'Add the products first — the weight and the declared value both come from them.'));
      body.replaceChildren(...bits);
      return;
    }

    const carrier = select(CARRIERS, { value: L.carrier || 'fedex' });
    carrier.addEventListener('change', () => {
      L.carrier = carrier.value;
    });

    const origin = input({ value: L.originPostcode || '', placeholder: 'Postcode', autocapitalize: 'characters' });
    origin.addEventListener('input', () => {
      L.originPostcode = origin.value;
    });
    const dest = input({ value: L.destPostcode || '', placeholder: 'Postcode', autocapitalize: 'characters' });
    dest.addEventListener('input', () => {
      L.destPostcode = dest.value;
    });

    const weight = input({ type: 'number', step: '0.1', inputmode: 'decimal', value: L.grossKg });
    weight.addEventListener('input', () => {
      L.grossKg = parseFloat(weight.value) || 0;
    });
    const cartons = input({ type: 'number', step: '1', inputmode: 'numeric', value: L.cartons });
    cartons.addEventListener('input', () => {
      L.cartons = parseInt(cartons.value, 10) || 1;
    });
    const dims = input({ value: L.dimensions || '', placeholder: 'e.g. 60 x 40 x 40 cm' });
    dims.addEventListener('input', () => {
      L.dimensions = dims.value;
    });

    const basis = costBasis(quote);
    bits.push(
      el(
        'p',
        { class: 'inline-note' },
        `Lines are costed ${basis === 'exw' ? 'ex works' : 'landed'}: ${COST_BASIS_LABEL[basis]}.`,
      ),
      el('div', { class: 'field-grid' }, field('Carrier', carrier), field('Cartons', cartons)),
      el(
        'div',
        { class: 'field-grid' },
        field('From', origin, fromCountry ? fromCountry.name : 'Origin'),
        field('To', dest, toCountry ? toCountry.name : 'Set the client’s country'),
      ),
      el('div', { class: 'field-grid' }, field('Gross weight (kg)', weight, `${size.units} garments`), field('Carton size', dims, 'Optional')),
      el(
        'p',
        { class: 'inline-note' },
        `Weight estimated from the garments: ${size.goodsKg} kg of kit in ${size.cartons} carton${size.cartons === 1 ? '' : 's'}. Change it if you have weighed it.`,
      ),
    );

    if (!key) {
      bits.push(el('p', { class: 'inline-note text-alert' }, 'Add an Anthropic API key in Settings to work these out.'));
      body.replaceChildren(...bits);
      return;
    }

    /* ---- shipping ---- */
    bits.push(sectionTitle('Shipping'));
    const ship = L.shipping;
    if (ship) {
      const amount = input({ type: 'number', step: '0.01', inputmode: 'decimal', value: ship.amount });
      amount.addEventListener('input', () => {
        ship.amount = parseFloat(amount.value) || 0;
      });
      bits.push(
        field(`${carrierLabel(L.carrier)} — whole shipment`, amount, ship.service || ''),
        el(
          'p',
          { class: `inline-note ${ship.confidence === 'low' ? 'text-alert' : ''}` },
          `${ship.reasoning || ''}${ship.transitDays ? ` Transit ${ship.transitDays}.` : ''}`,
        ),
      );
      if (ship.chargeableKg) bits.push(el('p', { class: 'inline-note' }, `Chargeable weight ${ship.chargeableKg} kg${ship.surcharges ? ` · ${ship.surcharges}` : ''}`));
      (ship.caveats || []).forEach((c) => bits.push(el('p', { class: 'inline-note' }, `· ${c}`)));
      bits.push(el('p', { class: 'inline-note' }, `Estimated by Claude · ${ship.confidence} confidence.`));
    }

    bits.push(
      el(
        'div',
        { class: 'btn-row' },
        button(ship ? 'Price it again' : 'Calculate shipping', {
          variant: ship ? 'ghost' : 'primary',
          onclick: async (e) => {
            const btn = e.currentTarget;
            btn.disabled = true;
            btn.textContent = 'Asking the freight desk…';
            try {
              const raw = await estimateShipping(
                {
                  carrierLabel: carrierLabel(L.carrier),
                  originPostcode: L.originPostcode,
                  originCountryName: fromCountry?.name,
                  destPostcode: L.destPostcode,
                  destCountryName: toCountry?.name,
                  incoterm: quote.incoterm,
                  currency: quote.currency,
                  units: size.units,
                  cartons: L.cartons,
                  goodsKg: size.goodsKg,
                  grossKg: L.grossKg,
                  dimensions: L.dimensions,
                  items: shipmentItems(quote, totals, resolve),
                  declaredValue: totals.subtotal,
                },
                { apiKey: key, model: load().settings.claudeModel },
              );
              L.shipping = raw;
              draw();
              toast('Shipping in. The figure is editable.');
            } catch (err) {
              lastError = err.message || 'That did not work.';
              toast(lastError, 'alert');
              draw();
            }
          },
        }),
      ),
    );

    /* ---- customs ---- */
    bits.push(sectionTitle('Import costs'));
    if (!toCountry || toCountry.code === (quote.shipsFrom || SELLER_COUNTRY)) {
      bits.push(
        el(
          'p',
          { class: 'inline-note' },
          toCountry
            ? `${toCountry.name} to ${toCountry.name} crosses no border, so there is nothing to clear.`
            : 'Set the client’s country and this can be worked out.',
        ),
      );
    } else {
      const cus = L.customs;
      if (cus) {
        const money = (label, valueKey) => {
          const node = input({ type: 'number', step: '0.01', inputmode: 'decimal', value: cus[valueKey] ?? 0 });
          node.addEventListener('input', () => {
            cus[valueKey] = parseFloat(node.value) || 0;
          });
          return field(label, node);
        };
        bits.push(
          el('div', { class: 'field-grid' }, money('Duty', 'duty'), money('Import VAT', 'importVat')),
          el('div', { class: 'field-grid' }, money('Clearance', 'brokerage'), money('Other taxes', 'otherTaxes')),
          el('p', { class: `inline-note ${cus.confidence === 'low' ? 'text-alert' : ''}` }, cus.reasoning || ''),
        );
        if (cus.hsCodes?.length) bits.push(el('p', { class: 'inline-note' }, `Classified ${cus.hsCodes.join(' · ')}`));
        if (cus.customsValue) {
          bits.push(
            el(
              'p',
              { class: 'inline-note' },
              `On a customs value of ${currency(cus.customsValue, { code: quote.currency })} (${(cus.valuationBasis || 'cif').toUpperCase()}).`,
            ),
          );
        }
        (cus.caveats || []).forEach((c) => bits.push(el('p', { class: 'inline-note' }, `· ${c}`)));
        bits.push(el('p', { class: 'inline-note' }, `Estimated by Claude · ${cus.confidence} confidence. A broker signs off the entry, not this.`));
      }

      bits.push(
        el(
          'div',
          { class: 'btn-row' },
          button(cus ? 'Work it out again' : 'Calculate import costs', {
            variant: cus ? 'ghost' : 'primary',
            onclick: async (e) => {
              const btn = e.currentTarget;
              btn.disabled = true;
              btn.textContent = 'Classifying the goods…';
              try {
                const origins = [...new Set(quote.lines.map((l) => originCode(resolve(l.productId))).filter(Boolean))];
                const raw = await estimateCustoms(
                  {
                    originName: origins.map((c) => country(c)?.name).filter(Boolean).join(' and ') || null,
                    shipsFromName: fromCountry?.name,
                    destCountryName: toCountry.name,
                    incoterm: quote.incoterm,
                    incotermSummary: quote.incoterm ? incoterm(quote.incoterm).summary : '',
                    currency: quote.currency,
                    items: shipmentItems(quote, totals, resolve),
                    declaredValue: totals.subtotal,
                    freight: L.shipping?.amount || null,
                    insurance: null,
                    grossKg: L.grossKg,
                    cartons: L.cartons,
                  },
                  { apiKey: key, model: load().settings.claudeModel },
                );
                L.customs = raw;
                draw();
                toast('Import costs in. Every figure is editable.');
              } catch (err) {
                lastError = err.message || 'That did not work.';
                toast(lastError, 'alert');
                draw();
              }
            },
          }),
        ),
      );
    }

    /* ---- what it does to the quote ---- */
    const after = priceQuote(quote);
    if (after.logisticsCost) {
      bits.push(sectionTitle('On this quotation'));
      const tbody = el('tbody');
      const row = (a, b, cls = '') => tbody.appendChild(el('tr', { class: cls }, el('td', {}, a), el('td', {}, b)));
      if (after.logistics.shipping) row('Shipping', currency(after.logistics.shipping, { code: quote.currency }));
      if (after.logistics.customs) row('Duty, taxes and clearance', currency(after.logistics.customs, { code: quote.currency }));
      row('Shipping & customs', currency(after.logisticsCost, { code: quote.currency }), 'is-subtotal');
      bits.push(el('table', { class: 'ledger' }, tbody));

      const charge = el('input', { type: 'checkbox', checked: Boolean(L.chargeToCustomer) });
      charge.addEventListener('change', () => {
        L.chargeToCustomer = charge.checked;
        draw();
      });
      bits.push(
        el('label', { class: 'toggle-row' }, charge, el('span', {}, 'Charge it to the customer')),
      );

      if (L.chargeToCustomer) {
        const amount = input({
          type: 'number',
          step: '0.01',
          inputmode: 'decimal',
          value: L.chargeAmount ?? after.logisticsCost,
        });
        amount.addEventListener('input', () => {
          L.chargeAmount = amount.value === '' ? null : parseFloat(amount.value) || 0;
        });
        bits.push(field('Charge, excl. VAT', amount, 'Appears on the PDF as a line'));
      }

      bits.push(
        el(
          'p',
          { class: `inline-note ${after.profit < 0 ? 'text-alert' : ''}` },
          L.chargeToCustomer
            ? `Passed on, the order totals ${currency(after.total, { code: quote.currency })} and keeps ${currency(after.profit, { code: quote.currency })} at ${percent(after.margin, 1)}.`
            : `Absorbed, the order keeps ${currency(after.profit, { code: quote.currency })} at ${percent(after.margin, 1)} — ${currency(after.logisticsCost, { code: quote.currency })} off the bottom line.`,
        ),
      );
    }

    // Kept on screen rather than left to a toast, so it can be read back.
    if (lastError) bits.push(el('p', { class: 'inline-note text-alert' }, lastError));
    body.replaceChildren(...bits);
  };

  draw();
  sheet('Shipping & customs', body, {
    actions: [button('Done', { variant: 'primary', onclick: () => { closeSheet(); onDone(); } })],
  });
}

/* -------------------------------------------------------------- cross-border */

/**
 * Whether UK VAT belongs on this quotation at all, and what the customer is
 * actually being promised.
 *
 * Three facts decide it and the app cannot infer any of them: where the customer
 * is, where the goods physically leave from, and which incoterm was quoted. Left
 * unasked, a quote to a Dublin club goes out as a UK domestic sale with 20% on
 * it — which is why this sits next to the client rather than in a setting.
 */
function crossBorderPanel(quote, { onChange, onApply }) {
  const { settings } = load();
  const all = products();
  const lineProducts = quote.lines.map((l) => all.find((p) => p.id === l.productId)).filter(Boolean);

  // Somewhere the goods can leave from: our own stock, or a factory we use.
  // Built from the whole catalogue, not from this quote's lines — the panel sits
  // above Items, so deriving it from the lines left a select with one option on
  // every new quotation.
  const makersByCountry = new Map();
  all.forEach((p) => {
    const code = originCode(p);
    if (!code || !p.maker) return;
    if (!makersByCountry.has(code)) makersByCountry.set(code, new Set());
    makersByCountry.get(code).add(p.maker);
  });

  const factoryOptions = [...makersByCountry.entries()]
    .map(([code, makers]) => ({
      value: code,
      label: `${country(code)?.name || code} — direct from ${[...makers].sort().join(' / ')}`,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));

  const fromOptions = [
    { value: SELLER_COUNTRY, label: `${country(SELLER_COUNTRY).name} — our stock` },
    ...factoryOptions,
    // Anything else is unusual but not impossible — a third-party maker, or
    // stock already sitting with a distributor abroad.
    ...COUNTRIES.filter(
      (c) => c.code !== SELLER_COUNTRY && !makersByCountry.has(c.code),
    ).map((c) => ({ value: c.code, label: c.name })),
  ];

  const fromSelect = select(fromOptions, { value: quote.shipsFrom || SELLER_COUNTRY });
  fromSelect.addEventListener('change', () => {
    quote.shipsFrom = fromSelect.value;
    onChange();
  });

  const incotermSelect = select(
    [{ value: '', label: 'Not stated' }, ...INCOTERMS.map((i) => ({ value: i.code, label: `${i.code} — ${i.name}` }))],
    { value: quote.incoterm || '' },
  );
  incotermSelect.addEventListener('change', () => {
    quote.incoterm = incotermSelect.value;
    onChange();
  });

  const treatment = supplyTreatment({
    clientCountry: quote.client.country,
    goodsFrom: quote.shipsFrom || SELLER_COUNTRY,
    incoterm: quote.incoterm,
    clientVatNumber: quote.client.vatNumber,
    domesticRate: settings.vatRate,
  });

  const warnings = [...treatment.warnings];

  // A product costed to land in one country, quoted to a customer in another.
  const costedFor = [...new Set(lineProducts.map((p) => p.landedTerms?.destination).filter(Boolean))];
  costedFor
    .filter((code) => quote.client.country && code !== quote.client.country)
    .forEach((code) => {
      warnings.push(
        `A line was costed to land in ${country(code)?.name || code}, but this quotation is for ${country(quote.client.country)?.name}. Its duty and freight will not be right.`,
      );
    });

  // Costed on cheaper terms than the quote promises: the gap is ours to eat.
  const costedTerms = [...new Set(lineProducts.map((p) => p.landedTerms?.incoterm).filter(Boolean))];
  if (quote.incoterm === 'DDP' && costedTerms.length && !costedTerms.includes('DDP')) {
    warnings.push(
      `You are quoting DDP but the ${costedTerms.join('/')} costing behind it stops short of duty and import VAT. That difference comes out of this margin.`,
    );
  }

  const bits = [
    el(
      'div',
      { class: 'field-grid' },
      field('Goods ship from', fromSelect, 'Our stock, or straight off the factory floor'),
      field('Incoterm', incotermSelect, 'Printed on the quotation'),
    ),
  ];

  const mismatch = Math.abs((quote.vatRate ?? 0) - treatment.rate) > 0.0001;
  bits.push(
    el(
      'p',
      { class: `inline-note ${mismatch ? 'text-alert' : ''}` },
      `${treatment.label}. ${treatment.rate ? `UK VAT at ${percent(treatment.rate)}` : 'No UK VAT'} applies` +
        (mismatch ? `, but this quotation is set to ${percent(quote.vatRate ?? 0)}.` : '.'),
    ),
  );

  if (mismatch) {
    bits.push(
      el(
        'div',
        { class: 'btn-row' },
        button(treatment.rate ? `Charge VAT at ${percent(treatment.rate)}` : 'Zero-rate this quotation', {
          onclick: () => {
            quote.vatRate = treatment.rate;
            // The wording has to move with the rate, or the PDF contradicts itself.
            if (treatment.note) quote.vatNote = treatment.note;
            else if (!treatment.rate) quote.vatNote = '';
            onApply();
          },
        }),
      ),
    );
  }

  warnings.forEach((w) => bits.push(el('p', { class: 'inline-note text-alert' }, `· ${w}`)));

  if (!quote.client.country) {
    bits.push(el('p', { class: 'inline-note' }, 'Set the client’s country and this works itself out.'));
  } else {
    bits.push(
      el('p', { class: 'inline-note' }, 'A prompt, not advice — anything unusual is worth an accountant’s eye before it goes out.'),
    );
  }

  return card(...bits);
}

/* -------------------------------------------------------------------- sheets */

function editClient(quote, onDone) {
  const c = quote.client;
  const name = input({ value: c.name, placeholder: 'Club, team or shop' });
  const contact = input({ value: c.contact, placeholder: 'Attn. …' });
  const email = input({ type: 'email', value: c.email, autocapitalize: 'off' });
  const phone = input({ type: 'tel', value: c.phone });
  const address = el('textarea', { class: 'input', placeholder: 'One line per line' }, c.address);
  // The country is not decoration: it decides whether UK VAT belongs on this
  // quotation at all, so it sits with the address rather than in a setting.
  const countrySelect = select(
    [{ value: '', label: '—' }, ...COUNTRIES.map((x) => ({ value: x.code, label: x.name }))],
    { value: c.country || '' },
  );
  const vatNumber = input({ value: c.vatNumber || '', placeholder: 'For a business abroad', autocapitalize: 'characters' });

  sheet(
    'Client',
    el(
      'div',
      {},
      field('Name', name),
      field('Contact', contact),
      el('div', { class: 'field-grid' }, field('Email', email), field('Phone', phone)),
      field('Address', address),
      el('div', { class: 'field-grid' }, field('Country', countrySelect, 'Decides the VAT treatment'), field('Their VAT number', vatNumber)),
    ),
    {
      actions: [
        button('Done', {
          variant: 'primary',
          onclick: () => {
            Object.assign(quote.client, {
              name: name.value.trim(),
              contact: contact.value.trim(),
              email: email.value.trim(),
              phone: phone.value.trim(),
              address: address.value.trim(),
              country: countrySelect.value,
              vatNumber: vatNumber.value.trim(),
            });
            closeSheet();
            onDone();
          },
        }),
      ],
    },
  );
}

function pickProducts(quote, onChange) {
  let all = products();
  const search = input({ type: 'search', placeholder: 'Search products', autocapitalize: 'off' });
  const results = el('div', { class: 'list' });
  let category = 'all';

  const draw = () => {
    const term = search.value.trim().toLowerCase();
    const matches = all.filter((p) => {
      if (category !== 'all' && p.category !== category) return false;
      if (!term) return true;
      return `${displayName(p)} ${p.code || ''} ${p.maker || ''}`.toLowerCase().includes(term);
    });

    results.replaceChildren();
    if (!matches.length) {
      results.appendChild(el('div', { class: 'row' }, el('div', { class: 'row-main' }, 'Nothing matches.')));
      return;
    }

    matches.forEach((p) => {
      const already = quote.lines.find((l) => l.productId === p.id);
      results.appendChild(
        el(
          'button',
          {
            class: 'row',
            type: 'button',
            onclick: () => {
              addLine(quote, p);
              onChange();
              draw();
              toast(`${displayName(p)} added.`);
            },
          },
          el(
            'div',
            { class: 'row-main' },
            el('div', { class: 'row-title' }, displayName(p)),
            el(
              'div',
              { class: 'row-sub' },
              p.cost === null ? 'No cost on file' : `${currency(p.cost)} cost${p.rrp ? ` · ${currency(p.rrp)} RRP` : ''}`,
            ),
          ),
          el('div', { class: 'row-value-sub' }, already ? `×${already.qty}` : '+'),
        ),
      );
    });
  };

  search.addEventListener('input', draw);

  const chips = el(
    'div',
    { class: 'chips' },
    ...[{ id: 'all', label: 'All' }, ...CATEGORIES].map((c) =>
      el(
        'button',
        {
          class: 'chip',
          type: 'button',
          'aria-pressed': String(category === c.id),
          onclick: (e) => {
            category = c.id;
            e.currentTarget.parentElement.querySelectorAll('.chip').forEach((x) => x.setAttribute('aria-pressed', 'false'));
            e.currentTarget.setAttribute('aria-pressed', 'true');
            draw();
          },
        },
        c.label,
      ),
    ),
  );

  // A club job usually needs a garment that does not exist yet. Build it here,
  // on top of the sheet, and it lands on the quotation the moment it is saved —
  // no trip to Products and back to find what you just made.
  const customise = button('+ Customise a product', {
    variant: 'ghost',
    onclick: () =>
      customiseProduct({
        onSaved: (p) => {
          if (!p) return;
          addLine(quote, p);
          onChange();
          all = products();
          draw();
          toast(`${displayName(p)} added to the quotation.`);
        },
      }),
  });

  draw();
  sheet('Add items', el('div', {}, field('Search', search), chips, el('div', { class: 'btn-row' }, customise), results), {
    actions: [button('Done', { variant: 'primary', onclick: () => closeSheet() })],
  });
}

function addLine(quote, p) {
  const existing = quote.lines.find((l) => l.productId === p.id);
  if (existing) {
    existing.qty += 1;
    return;
  }
  // Both costs travel with the line, because which one applies is a property of
  // the quotation and can change after the line is added.
  const stack = costStack(p, { reclaimImportVat: load().settings.reclaimImportVat });
  quote.lines.push({
    id: uid('ln'),
    productId: p.id,
    name: displayName(p),
    // The reference only, never the maker: the factory's name has no business on
    // a customer's quotation.
    code: p.code || '',
    qty: 1,
    exw: stack.exw,
    landed: stack.landed,
    cost: p.cost ?? stack.landed,
    rrp: p.rrp ?? 0,
    discount: 0,
  });
}

function editLine(quote, index, onChange) {
  const line = quote.lines[index];
  const priced = priceQuote(quote).lines[index];

  const qty = input({ type: 'number', inputmode: 'numeric', min: '1', value: line.qty });
  const discount = input({ type: 'number', inputmode: 'decimal', step: '1', value: toPercentInput(line.discount) });
  const cost = input({ type: 'number', inputmode: 'decimal', step: '0.01', value: line.cost });
  const spec = input({ value: line.spec || '', placeholder: 'Fabric, pad, colourway…' });
  const override = input({
    type: 'number',
    inputmode: 'decimal',
    step: '0.01',
    value: line.mode === 'fixed' ? line.fixed : '',
    placeholder: `${priced.listGross.toFixed(2)} (calculated)`,
  });

  const minMargin = quote.minMargin ?? load().settings.minMargin;
  const breakEven = breakEvenDiscount(priced.listGross, line.cost, quote.commissionRate, quote.vatRate);
  const atFloor = maxDiscountForMargin(priced.listGross, line.cost, minMargin, quote.commissionRate, quote.vatRate);
  const verdict = marginVerdict(priced.margin, minMargin, priced.profit);

  sheet(
    line.name,
    el(
      'div',
      {},
      el(
        'div',
        { class: `verdict verdict-${verdict}` },
        el(
          'div',
          { class: 'verdict-head' },
          verdict === 'loss' ? 'Below cost' : verdict === 'thin' ? 'Under your floor' : 'Fine as it stands',
        ),
        el(
          'div',
          { class: 'verdict-body' },
          `${currency(priced.unitGross, { code: quote.currency })} each leaves ${currency(priced.profit / (priced.qty || 1), {
            code: quote.currency,
          })} a unit at ${percent(priced.margin)}.`,
        ),
      ),
      el('div', { class: 'field-grid' }, field('Quantity', qty), field('Line discount %', discount)),
      el(
        'table',
        { class: 'ledger' },
        el(
          'tbody',
          {},
          el(
            'tr',
            {},
            el('td', {}, `Most you can give at ${percent(minMargin)} margin`),
            el('td', {}, percent(atFloor)),
          ),
          el('tr', {}, el('td', {}, 'Break-even discount'), el('td', {}, percent(breakEven))),
          el(
            'tr',
            {},
            el('td', {}, 'Retail price before discount'),
            el('td', {}, currency(priced.listGross, { code: quote.currency })),
          ),
          el('tr', {}, el('td', {}, 'Landed cost'), el('td', {}, currency(line.cost, { code: quote.currency }))),
          el(
            'tr',
            {},
            el('td', {}, `Net of VAT at ${percent(quote.vatRate)}`),
            el('td', {}, currency(priced.unitNet, { code: quote.currency })),
          ),
        ),
      ),
      el(
        'p',
        { class: 'inline-note' },
        `A quote-wide discount of ${percent(quote.discount)} is already applied on top of anything set here.`,
      ),
      field('Unit cost', cost, 'Only changes this quotation'),
      field(
        'Fixed unit price',
        override,
        // Prices are held VAT-inclusive whatever the quotation is set to show, so
        // say so rather than letting the display setting mislead what to type.
        quote.vatRate
          ? `Including VAT at ${percent(quote.vatRate)}. Leave blank to use the retail price`
          : 'Leave blank to use the retail price',
      ),
      field('Spec line', spec, 'Printed under the item name'),
    ),
    {
      actions: [
        button('Remove', {
          variant: 'danger',
          onclick: () => {
            quote.lines.splice(index, 1);
            closeSheet();
            onChange();
          },
        }),
        button('Done', {
          variant: 'primary',
          onclick: () => {
            line.qty = Math.max(0, parseInt(qty.value, 10) || 0);
            line.discount = toFraction(discount.value);
            line.cost = parseFloat(cost.value) || 0;
            line.spec = spec.value.trim();
            const fixed = parseFloat(override.value);
            if (Number.isFinite(fixed) && fixed > 0) {
              line.mode = 'fixed';
              line.fixed = fixed;
            } else {
              delete line.mode;
              delete line.fixed;
            }
            closeSheet();
            onChange();
          },
        }),
      ],
    },
  );
}

/* --------------------------------------------------------------------- output */

async function exportPdf(quote) {
  const { company, settings } = load();
  try {
    // Usually resolved at startup; awaiting here covers a very fast first export.
    await loadBrandFonts();
    const doc = buildQuotePdf({ quote, company, settings });
    const filename = quoteFilename(quote, company);
    // Safari on iOS ignores the download attribute for blobs in some versions, so
    // fall back to opening the PDF, from where Share works as normal.
    const blob = doc.output('blob');
    downloadBlob(blob, filename);
    toast('PDF ready — use Share to send it.');
  } catch (err) {
    console.error(err);
    toast('Could not build the PDF.', 'alert');
  }
}

function logQuoteAsSale(quote, navigate) {
  const totals = priceQuote(quote);
  sheet(
    'Log as sale',
    el(
      'div',
      {},
      el('p', { class: 'prose' }, `Record ${quote.ref} as a sale of ${currency(totals.total, { code: quote.currency })} to ${quote.client.name}?`),
      el('p', { class: 'inline-note' }, 'The sale keeps its own copy of the figures, so later edits to the quotation will not change it.'),
    ),
    {
      actions: [
        button('Cancel', { onclick: () => closeSheet() }),
        button('Record sale', {
          variant: 'primary',
          onclick: () => {
            saveSale({
              id: uid('sale'),
              date: todayIso(),
              customer: quote.client.name,
              channel: 'quote',
              reference: quote.ref,
              currency: quote.currency,
              vatRate: quote.vatRate,
              net: totals.subtotal,
              vat: totals.vat,
              gross: totals.total,
              cost: totals.costTotal,
              units: totals.units,
              notes: quote.subject || '',
            });
            quote.status = 'accepted';
            saveQuote(quote);
            closeSheet();
            toast('Sale logged.');
            navigate('#/sales');
          },
        }),
      ],
    },
  );
}
