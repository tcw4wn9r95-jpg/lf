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
import {
  INCOTERMS, COUNTRIES, country, incoterm, defaultTerms, originCode,
  DEFAULT_INCOTERM, DEFAULT_DESTINATION,
} from '../landed.js';
import { estimateLanded, termsFromEstimate } from '../claude.js';

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
      button('Customise a product', { variant: 'primary', onclick: () => customiseProduct() }),
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
          // The base can be deleted out from under a custom product; the workflow
          // falls back to picking a new one rather than failing.
          customiseProduct({ existing: p });
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
  const terms = stack.terms || null;
  const unknown = new Set(stack.unknown || []);

  // A line the incoterm hands to the buyer still appears — knowing what you are
  // not paying for is half of knowing whether the incoterm was the right choice.
  const line = (key) => {
    if (!stack.lines[key] && key === 'brokerage') return;
    const mine = stack.borne ? stack.borne[key] !== false : true;
    if (!mine && !stack.lines[key]) return;
    const label = costLineLabel(key, p, terms);
    if (unknown.has(key)) {
      rows.push(ledgerRow(`${label} — rate unknown`, 'not counted', 'is-alert'));
      return;
    }
    if (!mine) {
      rows.push(ledgerRow(`${label} — buyer's`, currency(stack.lines[key]), 'is-handed-over'));
      return;
    }
    rows.push(ledgerRow(label, currency(stack.lines[key])));
  };

  rows.push(ledgerRow(costLineLabel('manufacture', p, terms), currency(stack.lines.manufacture)));
  rows.push(ledgerRow(costLineLabel('packaging', p, terms), currency(stack.lines.packaging)));

  // Customisation is stitched in at the factory, so it belongs above the FOB
  // line and inside the value duty is charged on.
  stack.customisations.forEach((c) => rows.push(ledgerRow(c.label, currency(c.amount))));

  rows.push(ledgerRow(stack.customisations.length ? 'FOB — declared value' : 'FOB', currency(stack.fob), 'is-subtotal'));
  line('freightIn');
  line('freightOut');
  line('insurance');
  line('brokerage');
  line('duty');
  line('importVat');
  rows.push(ledgerRow('Import costs', currency(stack.importCosts), 'is-subtotal'));
  if (stack.recovered) {
    rows.push(ledgerRow('Less import VAT reclaimed', `-${currency(stack.recovered)}`, 'is-good'));
  }
  if (includeTotal) {
    rows.push(ledgerRow(landedLabel(terms), currency(stack.landed), 'is-subtotal'));
  }
  return rows;
}

/** What the bottom of the stack is called, given the terms it was costed under. */
function landedLabel(terms) {
  if (!terms) return 'Landed cost (DDP)';
  const to = country(terms.destination);
  // Naming the destination only makes sense when we are the ones getting it there.
  const delivered = incoterm(terms.incoterm).bears.includes('freightIn');
  return delivered && to ? `Our cost — ${terms.incoterm} ${to.name}` : `Our cost — ${terms.incoterm}`;
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
  // The rows already carry the customisation inside the FOB value, so the only
  // thing left to add is the bottom line.
  costStackRows(p, stack, { includeTotal: false }).forEach((r) => tbody.appendChild(r));
  tbody.appendChild(ledgerRow(landedLabel(stack.terms), currency(stack.landed), 'is-total'));
  out.appendChild(el('table', { class: 'ledger' }, tbody));

  // Where the money actually goes, as a share of unit cost. Only what the
  // incoterm leaves with us counts — a line the buyer pays is not our cost.
  const mine = (key) => (stack.borne && stack.borne[key] === false ? 0 : stack.lines[key] || 0);
  const total = stack.landed || 1;
  const share = (v) => Math.max(0, (v / total) * 100);
  const made = stack.fob - stack.customisationTotal;
  const shipping = mine('freightIn') + mine('freightOut') + mine('brokerage');
  const border = mine('duty') + mine('insurance');
  const importVat = Math.max(0, mine('importVat') - stack.recovered);

  out.appendChild(
    el(
      'div',
      { class: 'cost-bar', 'aria-hidden': 'true' },
      el('span', { class: 'seg-make', style: { width: `${share(made)}%` } }),
      el('span', { class: 'seg-freight', style: { width: `${share(shipping)}%` } }),
      el('span', { class: 'seg-duty', style: { width: `${share(border)}%` } }),
      el('span', { class: 'seg-vat', style: { width: `${share(importVat)}%` } }),
      el('span', { class: 'seg-custom', style: { width: `${share(stack.customisationTotal)}%` } }),
    ),
  );

  const origin = productOrigin(p);
  out.appendChild(
    el(
      'p',
      { class: 'inline-note' },
      [
        `${percent(made / total)} made${origin ? ` in ${origin}` : ''}`,
        stack.customisationTotal ? `${percent(stack.customisationTotal / total)} customisation` : null,
        shipping ? `${percent(shipping / total)} shipped to ${shipTo(stack)}` : null,
        border ? `${percent(border / total)} duty and insurance` : null,
        importVat ? `${percent(importVat / total)} import VAT` : null,
      ]
        .filter(Boolean)
        .join(', '),
    ),
  );

  return out;
}

/** Where this product is actually going, given its own terms. */
function shipTo(stack) {
  const to = stack.terms?.destination ? country(stack.terms.destination) : null;
  return to ? to.name : DESTINATION;
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

/**
 * Run the made-to-order workflow from wherever it is needed — the catalogue, or
 * a quotation that wants a product which does not exist yet.
 *
 * `onSaved` gets the saved product, so a quote can put it straight on the line
 * it was being built for rather than sending you to Products to find it.
 */
export function customiseProduct({ existing = null, onSaved = null } = {}) {
  const base = existing?.basedOn ? products().find((p) => p.id === existing.basedOn) : null;
  if (base) buildCustom(base, existing, onSaved);
  else chooseBase(existing, onSaved);
}

/** Pick the product whose cost structure the custom one inherits. */
function chooseBase(existing = null, onSaved = null) {
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
              buildCustom(p, existing, onSaved);
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
/**
 * Build a made-to-order product: inherit a cost structure, add the extras this
 * job needs, settle where it is going and on whose terms, then read off a price.
 *
 * The extras are not an afterthought bolted onto a landed cost. They are made at
 * the same factory in the same run, so they go into the FOB value and the duty,
 * insurance and import VAT all move with them. On a £10 customisation into the
 * UK that is another £4 of cost that would otherwise go unnoticed.
 */
function buildCustom(base, existing = null, onSaved = null) {
  const { settings } = load();

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
  let terms =
    existing?.landedTerms ||
    defaultTerms({
      product: base,
      incoterm: settings.customIncoterm || DEFAULT_INCOTERM,
      destination: settings.customDestination || DEFAULT_DESTINATION,
    });

  const extrasSlot = el('div');
  const termsSlot = el('div');
  const readout = el('div');

  /* The product as it would be saved, so the stack is built from one source. */
  const draft = () => ({ ...base, customisations: extras.filter((x) => parseFloat(x.amount)) });
  const stackNow = () => costStack(draft(), { reclaimImportVat: settings.reclaimImportVat, terms });

  const recalc = () => {
    const stack = stackNow();
    const unitCost = stack.landed;
    const priced = priceFromMarkup({
      cost: unitCost,
      markup: toFraction(markupInput.value),
      vatRate: settings.vatRate,
      rounding: parseFloat(roundingSelect.value),
      commissionRate: settings.commissionRate,
    });

    const tbody = el('tbody');
    if (stack.hasBreakdown) {
      costStackRows(draft(), stack, { includeTotal: false }).forEach((r) => tbody.appendChild(r));
    } else {
      tbody.appendChild(ledgerRow(`Cost · ${displayName(base)}`, currency(stack.landed), 'is-subtotal'));
    }
    tbody.appendChild(ledgerRow(`Unit cost — ${landedLabel(terms).replace('Our cost — ', '')}`, currency(unitCost), 'is-subtotal'));
    tbody.appendChild(ledgerRow(`Markup at ${percent(toFraction(markupInput.value))}`, currency(priced.net - unitCost)));
    tbody.appendChild(ledgerRow('Sale price excl. VAT', currency(priced.net), 'is-subtotal'));
    tbody.appendChild(ledgerRow(`VAT at ${percent(settings.vatRate)}`, currency(priced.vat)));
    tbody.appendChild(ledgerRow('Sale price incl. VAT', currency(priced.gross), 'is-total'));

    const bits = [
      el('table', { class: 'ledger' }, tbody),
      el(
        'p',
        { class: `inline-note ${priced.margin < settings.minMargin ? 'text-alert' : 'text-good'}` },
        `${currency(priced.profit)} a unit at ${percent(priced.margin, 1)} margin` +
          (priced.margin < settings.minMargin ? ` — under your ${percent(settings.minMargin)} floor` : ''),
      ),
    ];

    // What the customisation really cost, once it had dragged duty up with it.
    if (stack.customisationTotal) {
      const direct = stack.customisationTotal;
      const total = stack.customisationLanded;
      bits.push(
        el(
          'p',
          { class: 'inline-note' },
          total > direct + 0.005
            ? `The extras add ${currency(direct)} at the factory and ${currency(total)} landed — duty, insurance and import VAT rise with them.`
            : `The extras add ${currency(direct)} a unit.`,
        ),
      );
    }

    // The inherited freight is for the route this product normally takes. Quoting
    // a Denver club on a Spain-to-UK rate is a quiet way to lose money.
    const staleLane =
      stack.terms &&
      stack.terms.destination !== DEFAULT_DESTINATION &&
      !Number.isFinite(stack.terms.freightIn) &&
      (stack.borne?.freightIn ?? true) &&
      stack.lines.freightIn;
    if (staleLane) {
      bits.push(
        el(
          'p',
          { class: 'inline-note text-alert' },
          `Freight is still the ${currency(stack.lines.freightIn)} we pay to bring these into the UK. Getting them to ${country(stack.terms.destination)?.name || 'the customer'} will not cost that.`,
        ),
      );
    }

    if (stack.unknown?.length) {
      bits.push(
        el(
          'p',
          { class: 'inline-note text-alert' },
          'This price does not include a rate we do not have. Estimate it or type one in before quoting.',
        ),
      );
    }

    bits.push(
      el('p', { class: 'inline-note' }, 'The quotation shows only the price, on whichever VAT basis it is set to. None of this breakdown reaches the customer.'),
    );
    readout.replaceChildren(...bits);
  };

  /* ------------------------------------------------------- shipping & duty */

  const drawTerms = () => {
    const to = country(terms.destination);
    const from = country(terms.origin || originCode(base));
    const term = incoterm(terms.incoterm);

    const incotermSelect = select(
      INCOTERMS.map((i) => ({ value: i.code, label: `${i.code} — ${i.name}` })),
      { value: terms.incoterm },
    );
    incotermSelect.addEventListener('change', () => {
      // Which lines are ours changes; what the destination charges does not.
      terms = { ...terms, incoterm: incotermSelect.value };
      drawTerms();
      recalc();
    });

    const destSelect = select(
      COUNTRIES.map((c) => ({ value: c.code, label: c.name })),
      { value: terms.destination },
    );
    destSelect.addEventListener('change', () => {
      // A rate worked out for one country tells you nothing about the next, so
      // the estimate is dropped rather than quietly carried over.
      terms = defaultTerms({ product: base, incoterm: terms.incoterm, destination: destSelect.value });
      drawTerms();
      recalc();
    });

    const rate = (value, apply) => {
      const node = input({
        type: 'number',
        step: '0.5',
        inputmode: 'decimal',
        value: Number.isFinite(value) ? toPercentInput(value) : '',
        placeholder: '—',
      });
      node.addEventListener('input', () => {
        terms = { ...terms, ...apply(node.value === '' ? null : toFraction(node.value)), source: 'manual' };
        recalc();
      });
      return node;
    };
    const money = (value, apply) => {
      const node = input({
        type: 'number',
        step: '0.25',
        inputmode: 'decimal',
        value: Number.isFinite(value) ? value : '',
        placeholder: 'inherited',
      });
      node.addEventListener('input', () => {
        terms = { ...terms, ...apply(node.value === '' ? null : parseFloat(node.value)), source: 'manual' };
        recalc();
      });
      return node;
    };

    const bits = [
      el('div', { class: 'field-grid' }, field('Incoterm', incotermSelect), field('Customer is in', destSelect)),
      el('p', { class: 'inline-note' }, term.summary),
    ];

    if (from && to) {
      bits.push(
        el(
          'p',
          { class: `inline-note ${terms.confidence === 'low' ? 'text-alert' : ''}` },
          `${from.name} → ${to.name}. ${terms.note || ''}`,
        ),
      );
    }

    (terms.caveats || []).forEach((c) => bits.push(el('p', { class: 'inline-note' }, `· ${c}`)));

    if (terms.source === 'claude') {
      bits.push(
        el(
          'p',
          { class: 'inline-note' },
          `Estimated by Claude${terms.hsCode ? `, classified ${terms.hsCode}` : ''} · ${terms.confidence} confidence. Check it against a broker before committing.`,
        ),
      );
    }

    bits.push(
      el(
        'div',
        { class: 'field-grid' },
        field('Duty %', rate(terms.dutyRate, (v) => ({ dutyRate: v }))),
        field('Import VAT %', rate(terms.vatRate, (v) => ({ vatRate: v }))),
      ),
      el(
        'div',
        { class: 'field-grid' },
        field('Freight in / unit', money(terms.freightIn, (v) => ({ freightIn: v }))),
        field('Delivery / unit', money(terms.freightOut, (v) => ({ freightOut: v }))),
      ),
    );

    const key = load().settings.claudeApiKey;
    const estimate = button(terms.source === 'claude' ? 'Ask Claude again' : 'Estimate with Claude', {
      variant: 'quiet',
      onclick: async (e) => {
        const btn = e.currentTarget;
        btn.disabled = true;
        btn.textContent = 'Working it out…';
        try {
          const stack = stackNow();
          const raw = await estimateLanded(
            {
              name: nameInput.value.trim() || displayName(base),
              category: CATEGORY_LABEL[base.category] || base.category,
              basedOn: displayName(base),
              maker: base.maker,
              originName: from?.name,
              destinationName: to?.name || terms.destination,
              incoterm: terms.incoterm,
              incotermSummary: term.summary,
              currency: settings.currency,
              quantity: null,
              manufacture: stack.lines.manufacture || 0,
              packaging: stack.lines.packaging || 0,
              customisations: stack.customisations,
              fob: stack.fob,
              knownFreight: base.breakdown?.freightIn || null,
              knownRoute: from ? `${from.name} → United Kingdom, our usual lane` : null,
            },
            { apiKey: key, model: load().settings.claudeModel },
          );
          terms = termsFromEstimate(terms, raw);
          drawTerms();
          recalc();
          toast('Estimate in. Every figure is editable.');
        } catch (err) {
          toast(err.message || 'That did not work.', 'alert');
          btn.disabled = false;
          btn.textContent = 'Estimate with Claude';
        }
      },
    });

    if (key) {
      bits.push(el('div', { class: 'btn-row' }, estimate));
    } else {
      bits.push(
        el('p', { class: 'inline-note' }, 'Add an Anthropic API key in Settings and Claude can work out the duty, VAT and freight for a destination this app has no rate for.'),
      );
    }

    termsSlot.replaceChildren(...bits);
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
  drawTerms();
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
    sectionTitle('Made at the factory'),
    el('p', { class: 'inline-note' }, 'These go into the FOB value, so duty and import VAT rise with them.'),
    extrasSlot,
    sectionTitle('Shipping & duty'),
    termsSlot,
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
          const stack = costStack(
            { ...base, customisations: cleaned },
            { reclaimImportVat: settings.reclaimImportVat, terms },
          );
          const unitCost = stack.landed;
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
                // Made-to-order work groups under Custom rather than scattering
                // through the catalogue it was based on.
                category: 'custom',
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
            // the base cost came from, with the extras listed inside it.
            breakdown: base.breakdown ? { ...base.breakdown } : null,
            customisations: cleaned,
            basedOn: base.id,
            markup,
            // The terms it was costed under, so reopening it months later adds up
            // the same way whatever the rules have done in the meantime.
            landedTerms: terms,
            rrp: priced.gross,
            notes: notesInput.value.trim(),
          });

          closeSheet();
          toast(`${name} priced at ${currency(priced.gross)}.`);
          if (onSaved) onSaved(products().find((x) => x.id === id));
        },
      }),
    ],
  });
}
