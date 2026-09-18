/* Quotations — the list, and the builder that produces the branded PDF. */

import { CATEGORIES, displayName } from '../catalog.js';
import { load, products, saveQuote, deleteQuote, nextQuoteRef, uid, saveSale } from '../store.js';
import { priceQuote, PRICING_MODES, ROUNDING, breakEvenDiscount } from '../pricing.js';
import { buildQuotePdf, quoteFilename } from '../pdf.js';
import {
  el, card, sectionTitle, empty, button, input, select, field, sheet, closeSheet, toast,
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
          el('div', { class: 'row-value-sub' }, `${percent(totals.margin)} margin`),
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
    mode: settings.mode,
    targetMargin: settings.targetMargin,
    markup: settings.markup,
    discount: 0,
    rounding: settings.rounding,
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
  const modeSelect = select(
    Object.entries(PRICING_MODES).map(([value, label]) => ({ value, label })),
    { value: quote.mode },
  );
  const marginInput = input({ type: 'number', step: '1', inputmode: 'decimal', value: toPercentInput(quote.targetMargin) });
  const markupInput = input({ type: 'number', step: '5', inputmode: 'decimal', value: toPercentInput(quote.markup) });
  const vatInput = input({ type: 'number', step: '1', inputmode: 'decimal', value: toPercentInput(quote.vatRate) });
  const discountInput = input({ type: 'number', step: '1', inputmode: 'decimal', value: toPercentInput(quote.discount) });
  const roundingSelect = select(ROUNDING.map((r) => ({ value: r.value, label: r.label })), { value: quote.rounding });

  const marginField = field('Net margin %', marginInput, 'Share of the sale price kept');
  const markupField = field('Markup %', markupInput, 'Added on top of cost');

  const syncModeFields = () => {
    marginField.style.display = quote.mode === 'margin' ? '' : 'none';
    markupField.style.display = quote.mode === 'markup' ? '' : 'none';
  };

  modeSelect.addEventListener('change', () => {
    quote.mode = modeSelect.value;
    syncModeFields();
    onChange();
  });
  marginInput.addEventListener('input', () => {
    quote.targetMargin = toFraction(marginInput.value);
    onChange();
  });
  markupInput.addEventListener('input', () => {
    quote.markup = toFraction(markupInput.value);
    onChange();
  });
  vatInput.addEventListener('input', () => {
    quote.vatRate = toFraction(vatInput.value);
    onChange();
  });
  discountInput.addEventListener('input', () => {
    quote.discount = toFraction(discountInput.value);
    onChange();
  });
  roundingSelect.addEventListener('change', () => {
    quote.rounding = parseFloat(roundingSelect.value);
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

  syncModeFields();

  return card(
    field('Price from', modeSelect),
    marginField,
    markupField,
    el('div', { class: 'field-grid' }, field('VAT %', vatInput), field('Discount %', discountInput)),
    presets,
    field('Round prices to', roundingSelect),
  );
}

function linesPanel(quote, onChange) {
  if (!quote.lines.length) return empty('No items yet. Add products to build the quotation.');

  const totals = priceQuote(quote);
  const box = el('div', { class: 'list' });

  totals.lines.forEach((line, index) => {
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
            { class: `row-sub ${line.profit < 0 ? 'text-alert' : ''}` },
            `${currency(line.netUnit, { code: quote.currency })} each · ${percent(line.margin)} margin${
              line.discountApplied > 0.0001 ? ` · ${percent(line.discountApplied)} off` : ''
            }`,
          ),
        ),
        qtyInput,
        el(
          'div',
          { class: 'row-end' },
          el('div', { class: 'row-value' }, currency(line.netTotal, { code: quote.currency })),
        ),
      ),
    );
  });

  return box;
}

function totalsPanel(quote) {
  const t = priceQuote(quote);
  const code = quote.currency;
  const thin = t.margin < 0.2;

  const table = el('table', { class: 'ledger' });
  const tbody = el('tbody');

  const row = (label, value, cls = '') => tbody.appendChild(el('tr', { class: cls }, el('td', {}, label), el('td', {}, value)));

  if (t.discountValue > 0.004) {
    row('Before discount', currency(t.listSubtotal, { code }));
    row(`Discount`, `-${currency(t.discountValue, { code })}`);
  }
  row('Subtotal', currency(t.subtotal, { code }));
  row(`VAT at ${percent(t.vatRate)}`, currency(t.vat, { code }));
  tbody.appendChild(
    el('tr', { class: 'is-total' }, el('td', {}, `Total (${t.units} units)`), el('td', {}, currency(t.total, { code }))),
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

  return card(
    table,
    el('hr', { class: 'divider' }),
    detail,
    el('div', { class: `margin-bar ${thin ? 'is-alert' : ''}` }, el('span', { style: { width: `${Math.max(0, Math.min(1, t.margin)) * 100}%` } })),
    el(
      'p',
      { class: `inline-note ${t.profit < 0 ? 'text-alert' : ''}` },
      `${percent(t.margin, 1)} net margin · ${percent(t.markupOnCost, 0)} on cost`,
    ),
    t.lines.some((l) => l.profit < 0)
      ? el('p', { class: 'inline-note text-alert' }, 'Some lines are below cost — check the discounts.')
      : null,
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
    placeholder: `${priced.listUnit.toFixed(2)} (calculated)`,
  });

  const floor = breakEvenDiscount(priced.listUnit, line.cost, quote.commissionRate);

  sheet(
    line.name,
    el(
      'div',
      {},
      el('div', { class: 'field-grid' }, field('Quantity', qty), field('Line discount %', discount)),
      el(
        'p',
        { class: 'inline-note' },
        `Break-even at ${percent(floor)} off this line's ${currency(priced.listUnit, { code: quote.currency })} list price.`,
      ),
      field('Unit cost', cost, 'Only changes this quotation'),
      field('Fixed unit price', override, 'Leave blank to price from margin'),
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

function exportPdf(quote) {
  const { company, settings } = load();
  try {
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
