/* Quotations — the list, and the builder that produces the branded PDF. */

import { CATEGORIES, displayName } from '../catalog.js';
import { load, products, saveQuote, deleteQuote, nextQuoteRef, uid, saveSale } from '../store.js';
import {
  priceQuote, breakEvenDiscount, maxDiscountForMargin, marginVerdict, VERDICT_TONE,
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
    client: { name: '', contact: '', email: '', phone: '', address: '' },
    subject: '',
    currency: settings.currency,
    vatRate: settings.vatRate,
    minMargin: settings.minMargin,
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

  const redrawTotals = () => {
    totalsSlot.replaceChildren(totalsPanel(quote));
    linesSlot.replaceChildren(linesPanel(quote, redrawTotals));
  };

  wrap.appendChild(el('h1', { class: 'page-title' }, existing ? quote.ref : 'New quotation'));
  wrap.appendChild(el('p', { class: 'page-sub' }, existing ? `Saved ${quote.date}` : `Reference ${quote.ref}`));

  /* Client */
  wrap.appendChild(sectionTitle('Client'));
  const clientSlot = el('div', { class: 'list' });
  const drawClient = () => {
    clientSlot.replaceChildren(
      el(
        'button',
        { class: 'row', type: 'button', onclick: () => editClient(quote, drawClient) },
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

  /* Pricing controls */
  wrap.appendChild(sectionTitle('Pricing'));
  wrap.appendChild(pricingPanel(quote, redrawTotals));

  /* Items */
  wrap.appendChild(
    sectionTitle('Items', button('Add', { variant: 'quiet', onclick: () => pickProducts(quote, redrawTotals) })),
  );
  wrap.appendChild(linesSlot);

  /* Totals */
  wrap.appendChild(sectionTitle('Totals'));
  wrap.appendChild(totalsSlot);

  /* Presentation */
  wrap.appendChild(sectionTitle('On the PDF'));
  wrap.appendChild(presentationPanel(quote));

  redrawTotals();

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
      field('VAT %', vatInput, 'Already inside the prices'),
      field('Margin floor %', floorInput, 'Flags anything below'),
    ),
  );
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
                ? `${currency(line.listGross, { code: quote.currency })} → ${currency(line.unitGross, { code: quote.currency })}`
                : `${currency(line.unitGross, { code: quote.currency })} each`,
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
    field('Status', status),
  );
}

/* -------------------------------------------------------------------- sheets */

function editClient(quote, onDone) {
  const c = quote.client;
  const name = input({ value: c.name, placeholder: 'Club, team or shop' });
  const contact = input({ value: c.contact, placeholder: 'Attn. …' });
  const email = input({ type: 'email', value: c.email, autocapitalize: 'off' });
  const phone = input({ type: 'tel', value: c.phone });
  const address = el('textarea', { class: 'input', placeholder: 'One line per line' }, c.address);

  sheet(
    'Client',
    el(
      'div',
      {},
      field('Name', name),
      field('Contact', contact),
      el('div', { class: 'field-grid' }, field('Email', email), field('Phone', phone)),
      field('Address', address),
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
  const all = products();
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

  draw();
  sheet('Add items', el('div', {}, field('Search', search), chips, results), {
    actions: [button('Done', { variant: 'primary', onclick: () => closeSheet() })],
  });
}

function addLine(quote, p) {
  const existing = quote.lines.find((l) => l.productId === p.id);
  if (existing) {
    existing.qty += 1;
    return;
  }
  quote.lines.push({
    id: uid('ln'),
    productId: p.id,
    name: displayName(p),
    code: p.code || p.maker || '',
    qty: 1,
    cost: p.cost ?? 0,
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
      field('Fixed unit price', override, 'Including VAT. Leave blank to use the retail price'),
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
