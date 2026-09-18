/* Products — the catalogue, and the unit economics behind each one. */

import { CATEGORIES, CATEGORY_LABEL, displayName } from '../catalog.js';
import { load, products, setFinancials, update, uid, hasFinancials } from '../store.js';
import {
  COST_LINES, costStack, costLineLabel, productOrigin, DESTINATION, unitEconomics,
  sheetComparison, priceFromMarkup, ROUNDING,
} from '../pricing.js';
import {
  el, sectionTitle, button, input, select, field, sheet, closeSheet, toast,
  currency, percent, confirmSheet, toFraction, toPercentInput,
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
    el(
      'div',
      { class: 'btn-row' },
      button('Customise a product', { variant: 'primary', onclick: () => chooseBase() }),
      button('Blank product', { onclick: () => editProduct(null) }),
    ),
  );

  return wrap;
}

function productRow(p, data) {
  const { tiers } = unitEconomics(p, data.settings);
  const retail = tiers[0];
  const thin = retail.gross > 0 && retail.margin < 0.2;

  return el(
    'button',
    { class: 'row', type: 'button', onclick: () => openProduct(p.id) },
    el(
      'div',
      { class: 'row-main' },
      el('div', { class: 'row-title' }, displayName(p)),
      el(
        'div',
        { class: 'row-sub' },
        p.basedOn ? `Custom · from ${baseName(p.basedOn)}` : [p.code, p.maker].filter(Boolean).join(' · ') || '—',
      ),
    ),
    el(
      'div',
      { class: 'row-end' },
      el('div', { class: 'row-value' }, p.cost === null ? '—' : currency(retail.cost)),
      el(
        'div',
        { class: `row-value-sub ${thin ? 'text-alert' : ''}` },
        p.cost === null ? 'no cost' : retail.gross ? `${percent(retail.margin)} at retail` : 'no RRP',
      ),
    ),
  );
}

/* ---------------------------------------------------------- unit economics */

function openProduct(id) {
  const p = products().find((x) => x.id === id);
  if (!p) return;
  const { settings } = load();

  const body = el('div');

  if (p.cost === null) {
    body.appendChild(el('p', { class: 'prose' }, 'No unit cost recorded for this product yet.'));
  } else {
    const economics = unitEconomics(p, settings);
    body.appendChild(costStackTable(p, economics, settings));
    body.appendChild(tierTable(p, economics, settings));
    body.appendChild(decisionNotes(p, economics, settings));
  }

  if (p.notes) body.appendChild(el('p', { class: 'inline-note' }, p.notes));

  sheet(displayName(p), body, {
    actions: [
      button(p.basedOn ? 'Edit customisation' : 'Edit figures', {
        variant: 'primary',
        // Replace this sheet rather than stacking on it: the figures behind the
        // editor would otherwise sit there stale until you closed both.
        onclick: () => {
          closeSheet();
          if (!p.basedOn) return editProduct(p);
          const base = products().find((x) => x.id === p.basedOn);
          // The base can be deleted out from under a custom product; fall back to
          // picking a new one rather than failing.
          if (base) buildCustom(base, p);
          else chooseBase(p);
        },
      }),
    ],
  });
}

/**
 * The landed-cost rows for a product, as <tr> elements.
 *
 * Shared so the product screen and the customisation builder show the same
 * breakdown rather than two versions of the truth. `upTo` stops before the total
 * when the caller is going to carry on adding to it.
 */
function costStackRows(p, stack, { includeTotal = true } = {}) {
  const rows = [];
  const line = (key) => rows.push(ledgerRow(costLineLabel(key, p), currency(stack.lines[key])));

  line('manufacture');
  line('packaging');
  rows.push(ledgerRow('FOB', currency(stack.fob), 'is-subtotal'));
  line('freightIn');
  line('freightOut');
  line('insurance');
  line('duty');
  line('importVat');
  rows.push(ledgerRow('Import costs', currency(stack.importCosts), 'is-subtotal'));
  if (stack.recovered) {
    rows.push(ledgerRow('Less import VAT reclaimed', `-${currency(stack.recovered)}`, 'is-good'));
  }
  if (includeTotal) {
    rows.push(ledgerRow('Landed cost (DDP)', currency(stack.baseLanded), 'is-subtotal'));
  }
  return rows;
}

/** The landed-cost stack, line by line, the way the financial model builds it. */
function costStackTable(p, { stack }, settings) {
  const out = el('div', {}, sectionTitle('What a unit costs'));

  if (!stack.hasBreakdown) {
    const tbody = el('tbody');
    stack.customisations.forEach((c) => tbody.appendChild(ledgerRow(c.label, currency(c.amount))));
    tbody.appendChild(ledgerRow('Unit cost', currency(stack.landed), 'is-total'));
    out.appendChild(el('table', { class: 'ledger' }, tbody));
    out.appendChild(el('p', { class: 'inline-note' }, 'No cost breakdown imported for this product — only the total.'));
    return out;
  }

  const tbody = el('tbody');
  costStackRows(p, stack, { includeTotal: stack.customisations.length > 0 }).forEach((r) => tbody.appendChild(r));

  if (stack.customisations.length) {
    stack.customisations.forEach((c) => tbody.appendChild(ledgerRow(c.label, currency(c.amount))));
    tbody.appendChild(ledgerRow('Customisation', currency(stack.customisationTotal), 'is-subtotal'));
    tbody.appendChild(ledgerRow('Unit cost', currency(stack.landed), 'is-total'));
  } else {
    tbody.appendChild(ledgerRow('Landed cost (DDP)', currency(stack.landed), 'is-total'));
  }
  out.appendChild(el('table', { class: 'ledger' }, tbody));

  // Where the money actually goes, as a share of unit cost.
  const share = (v) => (stack.landed ? Math.max(0, (v / stack.landed) * 100) : 0);
  out.appendChild(
    el(
      'div',
      { class: 'cost-bar', 'aria-hidden': 'true' },
      el('span', { class: 'seg-make', style: { width: `${share(stack.fob)}%` } }),
      el('span', { class: 'seg-freight', style: { width: `${share(stack.lines.freightIn + stack.lines.freightOut)}%` } }),
      el('span', { class: 'seg-duty', style: { width: `${share(stack.lines.duty + stack.lines.insurance)}%` } }),
      el('span', { class: 'seg-vat', style: { width: `${share(stack.lines.importVat - stack.recovered)}%` } }),
      el('span', { class: 'seg-custom', style: { width: `${share(stack.customisationTotal)}%` } }),
    ),
  );

  const origin = productOrigin(p);
  out.appendChild(
    el(
      'p',
      { class: 'inline-note' },
      [
        `${percent(stack.fob / (stack.landed || 1))} made${origin ? ` in ${origin}` : ''}`,
        `${percent((stack.lines.freightIn + stack.lines.freightOut) / (stack.landed || 1))} shipped to ${DESTINATION}`,
        `${percent((stack.lines.duty + stack.lines.insurance) / (stack.landed || 1))} duty and insurance`,
        stack.lines.importVat && !stack.recovered
          ? `${percent(stack.lines.importVat / (stack.landed || 1))} import VAT`
          : null,
        stack.customisationTotal ? `${percent(stack.customisationTotal / (stack.landed || 1))} customisation` : null,
      ]
        .filter(Boolean)
        .join(', '),
    ),
  );

  return out;
}

/** What each price on the ladder actually leaves behind. */
function tierTable(p, { tiers, floorGross }, settings) {
  if (!p.rrp) {
    return el(
      'div',
      {},
      sectionTitle('What it earns'),
      el('p', { class: 'prose' }, 'No RRP set, so there is nothing to price against yet.'),
      el('p', { class: 'inline-note' }, `It would need to sell above ${currency(floorGross)} including VAT just to break even.`),
    );
  }

  const out = el('div', {}, sectionTitle('What it earns'));
  const table = el('table', { class: 'ledger' });
  table.appendChild(
    el(
      'thead',
      {},
      el('tr', {}, el('th', {}, 'Tier'), el('th', {}, 'Price'), el('th', {}, 'Net'), el('th', {}, 'Profit'), el('th', {}, 'Margin')),
    ),
  );

  const tbody = el('tbody');
  tiers.forEach((t) => {
    tbody.appendChild(
      el(
        'tr',
        { class: t.profit < 0 ? 'is-alert' : '' },
        el('td', {}, t.discount ? `${t.label} −${percent(t.discount)}` : t.label),
        el('td', {}, currency(t.gross)),
        el('td', {}, currency(t.net)),
        el('td', {}, currency(t.profit)),
        el('td', {}, percent(t.margin)),
      ),
    );
  });
  table.appendChild(tbody);
  out.appendChild(table);

  const retail = tiers[0];
  out.appendChild(
    el(
      'p',
      { class: 'inline-note' },
      `Price shown includes VAT at ${percent(settings.vatRate)}. Net is after VAT; profit is after VAT, ` +
        `${percent(settings.commissionRate)} commission and the landed cost.`,
    ),
  );

  // The single line-by-line breakdown of retail, so the arithmetic is visible.
  const detail = el('table', { class: 'ledger' });
  detail.appendChild(
    el(
      'tbody',
      {},
      ledgerRow(`Retail price (incl. VAT at ${percent(settings.vatRate)})`, currency(retail.gross)),
      ledgerRow('Less VAT to HMRC', `-${currency(retail.vat)}`),
      ledgerRow('Net revenue', currency(retail.net), 'is-subtotal'),
      ledgerRow(`Less commission at ${percent(settings.commissionRate)}`, `-${currency(retail.commission)}`),
      ledgerRow('Less landed cost', `-${currency(retail.cost)}`),
      ledgerRow('Profit per unit', currency(retail.profit), retail.profit < 0 ? 'is-total is-alert' : 'is-total is-good'),
    ),
  );
  out.appendChild(el('hr', { class: 'divider' }));
  out.appendChild(detail);

  return out;
}

function decisionNotes(p, economics, settings) {
  const out = el('div', {}, sectionTitle('Worth knowing'));
  const retail = economics.tiers[0];
  const notes = [];

  notes.push(`Break-even price is ${currency(economics.floorGross)} including VAT — below that the unit loses money.`);

  if (retail.unitsForOverheads) {
    notes.push(
      `${retail.unitsForOverheads} of these a month at retail covers the ${currency(settings.monthlyOverheads)} of fixed costs.`,
    );
  }

  const losing = economics.tiers.filter((t) => t.gross > 0 && t.profit < 0);
  if (losing.length) {
    notes.push(`Sold at a loss on: ${losing.map((t) => t.label.toLowerCase()).join(', ')}.`);
  }

  notes.forEach((text) => out.appendChild(el('p', { class: 'prose' }, text)));

  // Reconcile against the spreadsheet, which reaches a different number.
  const cmp = sheetComparison(p, settings);
  if (cmp && Math.abs(cmp.difference) >= 0.01) {
    out.appendChild(
      el(
        'div',
        { class: 'hint-block' },
        el('strong', {}, `${currency(cmp.difference)} higher than the spreadsheet. `),
        `The model takes VAT as ${percent(cmp.modelVatRate)} of the VAT-inclusive price (${currency(cmp.sheetVat)}) rather than ` +
          `the VAT inside it, and charges commission on the collab price (${currency(cmp.sheetCommission)}) rather than the ` +
          `price being sold at (${currency(retail.commission)}). Both understate profit.` +
          (cmp.sameVatBasis
            ? ''
            : ` The model assumed ${percent(cmp.modelVatRate)} VAT; this app is set to ${percent(settings.vatRate)}.`),
      ),
    );
  }

  if (economics.stack.importVat > 0 && !settings.reclaimImportVat) {
    out.appendChild(
      el(
        'p',
        { class: 'inline-note' },
        `Landed cost includes ${currency(economics.stack.importVat)} of import VAT. La Fuga is VAT registered, so that is ` +
          'reclaimable — switch it off in Settings to see the margin without it.',
      ),
    );
  }

  return out;
}

function ledgerRow(label, value, cls = '') {
  return el('tr', { class: cls }, el('td', {}, label), el('td', {}, value));
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
  const rrpInput = input({ type: 'number', step: '0.01', inputmode: 'decimal', value: p?.rrp ?? '', placeholder: '0.00' });
  const notesInput = el('textarea', { class: 'input', placeholder: 'Anything worth remembering' }, p?.notes || '');

  // Every element of the stack is editable, so a freight rise can be tried on.
  const stack = costStack(p || {});
  const costInputs = {};
  COST_LINES.forEach(({ key }) => {
    costInputs[key] = input({
      type: 'number',
      step: '0.01',
      inputmode: 'decimal',
      value: stack.hasBreakdown ? stack.lines[key] : '',
      placeholder: '0.00',
    });
  });
  const flatCostInput = input({
    type: 'number',
    step: '0.01',
    inputmode: 'decimal',
    value: stack.hasBreakdown ? '' : (p?.cost ?? ''),
    placeholder: '0.00',
  });

  const total = el('p', { class: 'inline-note' });
  const recalc = () => {
    const lines = Object.fromEntries(COST_LINES.map(({ key }) => [key, parseFloat(costInputs[key].value) || 0]));
    const sum = Object.values(lines).reduce((t, v) => t + v, 0);
    const flat = parseFloat(flatCostInput.value);
    const landed = sum > 0 ? sum : Number.isFinite(flat) ? flat : 0;
    total.textContent = `Landed cost ${currency(landed)}`;
  };
  Object.values(costInputs).forEach((node) => node.addEventListener('input', recalc));
  flatCostInput.addEventListener('input', recalc);
  recalc();

  const costField = (key) => field(costLineLabel(key, p || {}), costInputs[key]);

  const body = el(
    'div',
    {},
    isNew ? field('Name', nameInput) : null,
    isNew ? el('div', { class: 'field-grid' }, field('Model number', codeInput), field('Manufacturer', makerInput)) : null,
    isNew ? field('Category', categoryInput) : null,
    field('RRP', rrpInput, 'Including VAT'),
    sectionTitle('Cost stack'),
    el('div', { class: 'field-grid' }, costField('manufacture'), costField('packaging')),
    el('div', { class: 'field-grid' }, costField('freightIn'), costField('freightOut')),
    el('div', { class: 'field-grid' }, costField('insurance'), costField('duty')),
    costField('importVat'),
    total,
    field('Or a single landed cost', flatCostInput, 'Used only when the stack above is empty'),
    field('Notes', notesInput),
  );

  const actions = [
    button('Save', {
      variant: 'primary',
      onclick: () => {
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

        const lines = {};
        let sum = 0;
        COST_LINES.forEach(({ key }) => {
          const v = parseFloat(costInputs[key].value);
          if (Number.isFinite(v)) {
            lines[key] = v;
            sum += v;
          }
        });

        const flat = parseFloat(flatCostInput.value);
        const hasStack = Object.keys(lines).length > 0 && sum > 0;
        const rrp = parseFloat(rrpInput.value);

        setFinancials(id, {
          cost: hasStack ? Math.round(sum * 100) / 100 : Number.isFinite(flat) ? flat : null,
          breakdown: hasStack ? { ...lines, fob: round2(lines.manufacture || 0) + (lines.packaging || 0) } : null,
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

const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

/* --------------------------------------------------- made-to-order products */

/** Costs that come up on nearly every custom order, offered as one-tap starters. */
const CUSTOMISATION_PRESETS = [
  { label: 'Full sublimation artwork', amount: 4.5 },
  { label: 'Silk-screen logo', amount: 1.5 },
  { label: 'Woven neck label', amount: 0.3 },
  { label: 'Elastic Interface pad upgrade', amount: 6 },
  { label: 'Collar straps', amount: 0.4 },
  { label: 'Sample before production', amount: 8 },
];

function baseName(id) {
  const base = products().find((p) => p.id === id);
  return base ? displayName(base) : 'a deleted product';
}

/** Pick the product whose cost structure the custom one inherits. */
function chooseBase(existing = null) {
  const withCosts = products().filter((p) => p.hasFinancials && !p.basedOn);
  if (!withCosts.length) {
    return toast('No products with costs to base one on yet.', 'alert');
  }

  const search = input({ type: 'search', placeholder: 'Search products', autocapitalize: 'off' });
  const results = el('div', { class: 'list' });

  const draw = () => {
    const term = search.value.trim().toLowerCase();
    const matches = withCosts.filter((p) => !term || `${displayName(p)} ${p.code || ''} ${p.maker || ''}`.toLowerCase().includes(term));
    results.replaceChildren();
    matches.forEach((p) => {
      results.appendChild(
        el(
          'button',
          {
            class: 'row',
            type: 'button',
            onclick: () => {
              closeSheet();
              buildCustom(p, existing);
            },
          },
          el(
            'div',
            { class: 'row-main' },
            el('div', { class: 'row-title' }, displayName(p)),
            el('div', { class: 'row-sub' }, `${currency(costStack(p).landed)} landed${p.maker ? ` · ${p.maker}` : ''}`),
          ),
          el('div', { class: 'row-chevron' }, '›'),
        ),
      );
    });
  };

  search.addEventListener('input', draw);
  draw();
  sheet('Base it on', el('div', {}, field('Search', search), results));
}

/**
 * Build a made-to-order product: inherit a cost structure, add the extras this
 * job needs, put a markup on the lot, and read off the price.
 */
function buildCustom(base, existing = null) {
  const { settings } = load();
  const baseStack = costStack(base, { reclaimImportVat: settings.reclaimImportVat });

  const nameInput = input({
    value: existing?.name || '',
    placeholder: `e.g. Club kit — ${displayName(base)}`,
  });
  const codeInput = input({ value: existing?.code || '', placeholder: 'Your reference' });
  const markupInput = input({
    type: 'number',
    step: '5',
    inputmode: 'decimal',
    value: toPercentInput(existing?.markup ?? 1.5),
  });
  const roundingSelect = select(ROUNDING.map((r) => ({ value: r.value, label: r.label })), { value: 1 });
  const notesInput = el('textarea', { class: 'input', placeholder: 'Anything worth remembering' }, existing?.notes || '');

  let extras = (existing?.customisations || []).map((c) => ({ ...c }));

  const extrasSlot = el('div');
  const readout = el('div');

  const recalc = () => {
    const unitCost = round2(baseStack.landed + extras.reduce((t, x) => t + (parseFloat(x.amount) || 0), 0));
    const priced = priceFromMarkup({
      cost: unitCost,
      markup: toFraction(markupInput.value),
      vatRate: settings.vatRate,
      rounding: parseFloat(roundingSelect.value),
      commissionRate: settings.commissionRate,
    });

    const table = el('table', { class: 'ledger' });
    const tbody = el('tbody');
    // The inherited stack in full, so a custom price can be argued from the
    // manufacture cost up rather than from a single inherited number.
    if (baseStack.hasBreakdown) {
      costStackRows(base, baseStack).forEach((r) => tbody.appendChild(r));
    } else {
      tbody.appendChild(ledgerRow(`Landed cost · ${displayName(base)}`, currency(baseStack.landed), 'is-subtotal'));
    }

    extras.forEach((x) => {
      if (parseFloat(x.amount)) tbody.appendChild(ledgerRow(x.label || 'Customisation', currency(parseFloat(x.amount))));
    });
    if (extras.some((x) => parseFloat(x.amount))) {
      tbody.appendChild(
        ledgerRow(
          'Customisation',
          currency(round2(extras.reduce((t, x) => t + (parseFloat(x.amount) || 0), 0))),
          'is-subtotal',
        ),
      );
    }
    tbody.appendChild(ledgerRow('Unit cost', currency(unitCost), 'is-subtotal'));
    tbody.appendChild(ledgerRow(`Markup at ${percent(toFraction(markupInput.value))}`, currency(priced.net - unitCost)));
    tbody.appendChild(ledgerRow('Sale price excl. VAT', currency(priced.net), 'is-subtotal'));
    tbody.appendChild(ledgerRow(`VAT at ${percent(settings.vatRate)}`, currency(priced.vat)));
    tbody.appendChild(ledgerRow('Sale price incl. VAT', currency(priced.gross), 'is-total'));
    table.appendChild(tbody);

    readout.replaceChildren(
      table,
      el(
        'p',
        { class: `inline-note ${priced.margin < settings.minMargin ? 'text-alert' : 'text-good'}` },
        `${currency(priced.profit)} a unit at ${percent(priced.margin, 1)} margin` +
          (priced.margin < settings.minMargin ? ` — under your ${percent(settings.minMargin)} floor` : ''),
      ),
      el('p', { class: 'inline-note' }, 'The quotation shows only the price including VAT. None of this breakdown reaches the customer.'),
    );
  };

  const drawExtras = () => {
    extrasSlot.replaceChildren();
    if (extras.length) {
      const list = el('div', { class: 'list' });
      extras.forEach((x, i) => {
        const label = input({ value: x.label, placeholder: 'What it is' });
        const amount = input({ type: 'number', step: '0.01', inputmode: 'decimal', value: x.amount, style: { maxWidth: '88px' } });
        label.addEventListener('input', () => {
          extras[i].label = label.value;
        });
        amount.addEventListener('input', () => {
          extras[i].amount = parseFloat(amount.value) || 0;
          recalc();
        });
        list.appendChild(
          el(
            'div',
            { class: 'line-item' },
            el('div', { style: { flex: '1' } }, label),
            amount,
            button('×', {
              variant: 'quiet',
              'aria-label': `Remove ${x.label || 'line'}`,
              onclick: () => {
                extras.splice(i, 1);
                drawExtras();
                recalc();
              },
            }),
          ),
        );
      });
      extrasSlot.appendChild(list);
    }

    extrasSlot.appendChild(
      el(
        'div',
        { class: 'chips' },
        ...CUSTOMISATION_PRESETS.filter((preset) => !extras.some((x) => x.label === preset.label)).map((preset) =>
          el(
            'button',
            {
              class: 'chip',
              type: 'button',
              onclick: () => {
                extras.push({ ...preset });
                drawExtras();
                recalc();
              },
            },
            `+ ${preset.label}`,
          ),
        ),
        el(
          'button',
          {
            class: 'chip',
            type: 'button',
            onclick: () => {
              extras.push({ label: '', amount: 0 });
              drawExtras();
            },
          },
          '+ Something else',
        ),
      ),
    );
  };

  markupInput.addEventListener('input', recalc);
  roundingSelect.addEventListener('change', recalc);
  drawExtras();
  recalc();

  const body = el(
    'div',
    {},
    field('Name', nameInput, 'What it is called on the quotation'),
    field('Reference', codeInput),
    el(
      'p',
      { class: 'inline-note' },
      `Inherits the cost structure of ${displayName(base)}${productOrigin(base) ? `, made in ${productOrigin(base)}` : ''}.`,
    ),
    sectionTitle('Costs on top'),
    extrasSlot,
    sectionTitle('Price'),
    el('div', { class: 'field-grid' }, field('Markup on cost %', markupInput), field('Round price to', roundingSelect)),
    readout,
    field('Notes', notesInput),
  );

  sheet(existing ? `Edit ${existing.name}` : 'Customise a product', body, {
    actions: [
      button('Save', {
        variant: 'primary',
        onclick: () => {
          const name = nameInput.value.trim();
          if (!name) return toast('Give it a name.', 'alert');

          const cleaned = extras
            .map((x) => ({ label: (x.label || '').trim() || 'Customisation', amount: parseFloat(x.amount) || 0 }))
            .filter((x) => x.amount !== 0);
          const unitCost = round2(baseStack.landed + cleaned.reduce((t, x) => t + x.amount, 0));
          const markup = toFraction(markupInput.value);
          const priced = priceFromMarkup({
            cost: unitCost,
            markup,
            vatRate: settings.vatRate,
            rounding: parseFloat(roundingSelect.value),
            commissionRate: settings.commissionRate,
          });

          const id = existing?.id || uid('prod');
          if (!existing) {
            update((d) => {
              d.customProducts.push({
                id,
                name,
                code: codeInput.value.trim(),
                maker: base.maker || '',
                category: base.category,
                custom: true,
                basedOn: base.id,
              });
            });
          } else {
            update((d) => {
              const idx = d.customProducts.findIndex((x) => x.id === id);
              if (idx >= 0) {
                d.customProducts[idx] = { ...d.customProducts[idx], name, code: codeInput.value.trim() };
              }
            });
          }

          setFinancials(id, {
            cost: unitCost,
            // Keep the inherited stack so the product screen can still show where
            // the base cost came from, with the extras listed after it.
            breakdown: base.breakdown ? { ...base.breakdown } : null,
            customisations: cleaned,
            basedOn: base.id,
            markup,
            rrp: priced.gross,
            notes: notesInput.value.trim(),
          });

          closeSheet();
          toast(`${name} priced at ${currency(priced.gross)}.`);
        },
      }),
    ],
  });
}
