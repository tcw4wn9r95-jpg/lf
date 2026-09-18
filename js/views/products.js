/* Products — the catalogue and its unit economics. */

import { CATEGORIES, CATEGORY_LABEL, displayName } from '../catalog.js';
import { load, products, setFinancials, update, uid, hasFinancials } from '../store.js';
import {
  el, sectionTitle, button, input, select, field, sheet, closeSheet, toast,
  currency, percent, confirmSheet,
} from '../ui.js';

export default function productsView({ navigate }) {
  const data = load();
  const all = products();
  const wrap = el('div');

  wrap.appendChild(el('h1', { class: 'page-title' }, 'Products'));
  wrap.appendChild(
    el('p', { class: 'page-sub' }, `${all.length} products · ${all.filter((p) => p.hasFinancials).length} with unit costs`),
  );

  if (!hasFinancials()) {
    wrap.appendChild(
      el(
        'div',
        { class: 'hint-block' },
        el('strong', {}, 'No unit costs yet. '),
        'Your figures are kept off the repository on purpose. Import them once in Settings and they stay on this phone.',
        el('div', { class: 'btn-row' }, button('Import my figures', { variant: 'primary', onclick: () => navigate('#/settings') })),
      ),
    );
  }

  const groups = [...CATEGORIES.map((c) => c.id), 'uncategorised'];
  groups.forEach((catId) => {
    const items = all.filter((p) => (CATEGORY_LABEL[p.category] ? p.category : 'uncategorised') === catId);
    if (!items.length) return;

    const list = el('div', { class: 'list' }, el('div', { class: 'list-group-label' }, CATEGORY_LABEL[catId] || 'Other'));
    items.forEach((p) => list.appendChild(productRow(p, data)));
    wrap.appendChild(list);
  });

  wrap.appendChild(
    el('div', { class: 'btn-row' }, button('Add a product', { onclick: () => editProduct(null) })),
  );

  return wrap;
}

function productRow(p, data) {
  const vatRate = data.settings.vatRate;
  // Margin at RRP is the honest headline: what the product earns at its own list price.
  const exVat = p.rrp ? p.rrp / (1 + vatRate) : null;
  const margin = exVat && p.cost !== null ? (exVat - p.cost) / exVat : null;

  return el(
    'button',
    { class: 'row', type: 'button', onclick: () => openProduct(p.id) },
    el(
      'div',
      { class: 'row-main' },
      el('div', { class: 'row-title' }, displayName(p)),
      el('div', { class: 'row-sub' }, [p.code, p.maker].filter(Boolean).join(' · ') || '—'),
    ),
    el(
      'div',
      { class: 'row-end' },
      el('div', { class: 'row-value' }, p.cost === null ? '—' : currency(p.cost)),
      el(
        'div',
        { class: `row-value-sub ${margin !== null && margin < 0.2 ? 'text-alert' : ''}` },
        margin === null ? 'no cost' : `${percent(margin)} at RRP`,
      ),
    ),
  );
}

/* ------------------------------------------------------------------ detail */

function openProduct(id) {
  const p = products().find((x) => x.id === id);
  if (!p) return;
  const data = load();
  const vatRate = data.settings.vatRate;

  const body = el('div');

  if (p.cost === null) {
    body.appendChild(el('p', { class: 'prose' }, 'No unit cost recorded for this product yet.'));
  } else {
    body.appendChild(costTable(p, vatRate, data));
  }

  if (p.breakdown) body.appendChild(breakdownTable(p));
  if (p.notes) body.appendChild(el('p', { class: 'inline-note' }, p.notes));

  sheet(displayName(p), body, {
    actions: [
      button('Edit figures', {
        variant: 'primary',
        // Replace this sheet rather than stacking on it: the figures behind the
        // editor would otherwise sit there stale until you closed both.
        onclick: () => {
          closeSheet();
          editProduct(p);
        },
      }),
    ],
  });
}

function costTable(p, vatRate, data) {
  const exVat = p.rrp ? p.rrp / (1 + vatRate) : null;
  const rows = [
    ['Landed unit cost (DDP)', currency(p.cost), ''],
    p.rrp ? ['RRP incl. VAT', currency(p.rrp), ''] : null,
    exVat ? ['RRP excl. VAT', currency(exVat), ''] : null,
  ].filter(Boolean);

  const table = el('table', { class: 'ledger' });
  const tbody = el('tbody');
  rows.forEach(([label, value]) => tbody.appendChild(el('tr', {}, el('td', {}, label), el('td', {}, value))));
  table.appendChild(tbody);

  const out = el('div', {}, table);

  if (exVat) {
    const profit = exVat - p.cost;
    const margin = profit / exVat;
    out.appendChild(
      el('div', { class: `margin-bar ${margin < 0.2 ? 'is-alert' : ''}` }, el('span', { style: { width: `${Math.max(0, Math.min(1, margin)) * 100}%` } })),
    );
    out.appendChild(
      el('p', { class: 'inline-note' }, `${currency(profit)} gross per unit · ${percent(margin, 1)} margin, ${percent(profit / p.cost, 0)} markup on cost`),
    );

    out.appendChild(sectionTitle('At each discount'));
    const dt = el('table', { class: 'ledger' });
    dt.appendChild(
      el('thead', {}, el('tr', {}, el('th', {}, 'Tier'), el('th', {}, 'Price'), el('th', {}, 'Per unit'), el('th', {}, 'Margin'))),
    );
    const dbody = el('tbody');
    [{ label: 'List', value: 0 }, ...data.settings.discountPresets].forEach(({ label, value }) => {
      const price = exVat * (1 - value);
      const unitProfit = price - p.cost;
      const m = price ? unitProfit / price : 0;
      dbody.appendChild(
        el(
          'tr',
          { class: unitProfit < 0 ? 'is-alert' : '' },
          el('td', {}, value ? `${label} (${percent(value)})` : label),
          el('td', {}, currency(price * (1 + vatRate))),
          el('td', {}, currency(unitProfit)),
          el('td', {}, percent(m)),
        ),
      );
    });
    dt.appendChild(dbody);
    out.appendChild(dt);
    out.appendChild(el('p', { class: 'inline-note' }, 'Price column shown inclusive of VAT; per-unit profit and margin exclude it.'));
  }

  return out;
}

function breakdownTable(p) {
  const labels = {
    manufacture: 'Manufacture',
    packaging: 'Packaging',
    fob: 'FOB',
    freight: 'Freight',
    insurance: 'Insurance',
    duty: 'Duty',
    importVat: 'Import VAT',
    importTotal: 'Import costs',
  };
  const entries = Object.entries(p.breakdown).filter(([, v]) => Number.isFinite(v));
  if (!entries.length) return el('div');

  const table = el('table', { class: 'ledger' });
  const tbody = el('tbody');
  entries.forEach(([key, value]) => {
    tbody.appendChild(el('tr', {}, el('td', {}, labels[key] || key), el('td', {}, currency(value))));
  });
  tbody.appendChild(el('tr', { class: 'is-total' }, el('td', {}, 'Landed cost'), el('td', {}, currency(p.cost))));
  table.appendChild(tbody);

  return el('div', {}, sectionTitle('Cost stack'), table);
}

/* ------------------------------------------------------------------- editor */

function editProduct(p) {
  const isNew = !p;

  const nameInput = input({ value: p ? p.name : '', placeholder: 'Product name', required: true });
  const codeInput = input({ value: p?.code || '', placeholder: 'Model number' });
  const makerInput = input({ value: p?.maker || '', placeholder: 'Manufacturer' });
  const categoryInput = select(
    CATEGORIES.map((c) => ({ value: c.id, label: c.label })),
    { value: p?.category || 'accessories' },
  );
  const costInput = input({ type: 'number', step: '0.01', inputmode: 'decimal', value: p?.cost ?? '', placeholder: '0.00' });
  const rrpInput = input({ type: 'number', step: '0.01', inputmode: 'decimal', value: p?.rrp ?? '', placeholder: '0.00' });
  const notesInput = el('textarea', { class: 'input', placeholder: 'Anything worth remembering' }, p?.notes || '');

  const body = el(
    'div',
    {},
    isNew ? field('Name', nameInput) : null,
    isNew ? el('div', { class: 'field-grid' }, field('Model number', codeInput), field('Manufacturer', makerInput)) : null,
    isNew ? field('Category', categoryInput) : null,
    el(
      'div',
      { class: 'field-grid' },
      field('Landed cost', costInput, 'Per unit, DDP, excl. VAT'),
      field('RRP', rrpInput, 'Incl. VAT'),
    ),
    field('Notes', notesInput),
  );

  const actions = [
    button('Save', {
      variant: 'primary',
      onclick: () => {
        const cost = parseFloat(costInput.value);
        const rrp = parseFloat(rrpInput.value);
        let id = p?.id;

        if (isNew) {
          const name = nameInput.value.trim();
          if (!name) return toast('Give the product a name.', 'alert');
          id = uid('prod');
          update((d) => {
            d.customProducts.push({
              id,
              name,
              code: codeInput.value.trim(),
              maker: makerInput.value.trim(),
              category: categoryInput.value,
              custom: true,
            });
          });
        }

        setFinancials(id, {
          cost: Number.isFinite(cost) ? cost : null,
          rrp: Number.isFinite(rrp) ? rrp : null,
          notes: notesInput.value.trim(),
        });
        closeSheet();
        toast(isNew ? 'Product added.' : 'Figures updated.');
      },
    }),
  ];

  if (p?.custom) {
    actions.unshift(
      button('Delete', {
        variant: 'danger',
        onclick: async () => {
          closeSheet();
          if (!(await confirmSheet('Delete product', `Remove ${p.name} from your catalogue?`))) return;
          update((d) => {
            d.customProducts = d.customProducts.filter((x) => x.id !== p.id);
            delete d.financials[p.id];
          });
          toast('Product deleted.');
        },
      }),
    );
  }

  sheet(isNew ? 'Add a product' : displayName(p), body, { actions });
}
