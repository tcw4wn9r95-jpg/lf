/* Sales — a hand-kept ledger, so the dashboard and the VAT position mean something. */

import { displayName } from '../catalog.js';
import { load, products, saveSale, deleteSale, uid } from '../store.js';
import {
  el, empty, button, input, select, field, sheet, closeSheet, toast,
  currency, percent, todayIso, toFraction, toPercentInput, confirmSheet, stat,
} from '../ui.js';

const CHANNELS = [
  { value: 'web', label: 'Web shop' },
  { value: 'club', label: 'Club / team' },
  { value: 'distributor', label: 'Distributor' },
  { value: 'collab', label: 'Collab' },
  { value: 'event', label: 'Event / market' },
  { value: 'quote', label: 'From a quotation' },
  { value: 'other', label: 'Other' },
];

const PERIODS = [
  { id: 'month', label: 'This month' },
  { id: 'quarter', label: 'This quarter' },
  { id: 'year', label: 'This year' },
  { id: 'all', label: 'All time' },
];

let activePeriod = 'month';

export default function salesView() {
  const data = load();
  const wrap = el('div');

  wrap.appendChild(el('h1', { class: 'page-title' }, 'Sales'));
  wrap.appendChild(el('p', { class: 'page-sub' }, data.sales.length ? `${data.sales.length} entries` : 'Nothing logged yet'));

  const body = el('div');
  const draw = () => {
    const sales = filterByPeriod(data.sales, activePeriod);
    body.replaceChildren(summary(sales), ledger(sales, draw));
  };

  wrap.appendChild(
    el(
      'div',
      { class: 'chips' },
      ...PERIODS.map((p) =>
        el(
          'button',
          {
            class: 'chip',
            type: 'button',
            'aria-pressed': String(activePeriod === p.id),
            onclick: (e) => {
              activePeriod = p.id;
              e.currentTarget.parentElement.querySelectorAll('.chip').forEach((c) => c.setAttribute('aria-pressed', 'false'));
              e.currentTarget.setAttribute('aria-pressed', 'true');
              draw();
            },
          },
          p.label,
        ),
      ),
    ),
  );

  wrap.appendChild(el('div', { class: 'btn-row' }, button('Log a sale', { variant: 'primary', onclick: () => editSale(null) })));
  wrap.appendChild(body);
  draw();

  return wrap;
}

/* ------------------------------------------------------------------ periods */

export function periodStart(period, today = new Date()) {
  const y = today.getUTCFullYear();
  const m = today.getUTCMonth();
  if (period === 'month') return new Date(Date.UTC(y, m, 1));
  if (period === 'quarter') return new Date(Date.UTC(y, Math.floor(m / 3) * 3, 1));
  if (period === 'year') return new Date(Date.UTC(y, 0, 1));
  return new Date(0);
}

function filterByPeriod(sales, period) {
  const from = periodStart(period);
  return sales.filter((s) => new Date(`${s.date}T00:00:00Z`) >= from);
}

export function totalsFor(sales) {
  return sales.reduce(
    (t, s) => ({
      net: t.net + (s.net || 0),
      vat: t.vat + (s.vat || 0),
      gross: t.gross + (s.gross || 0),
      cost: t.cost + (s.cost || 0),
      units: t.units + (s.units || 0),
    }),
    { net: 0, vat: 0, gross: 0, cost: 0, units: 0 },
  );
}

/* ------------------------------------------------------------------ display */

function summary(sales) {
  const t = totalsFor(sales);
  const profit = t.net - t.cost;
  const margin = t.net ? profit / t.net : 0;

  return el(
    'div',
    { class: 'stat-grid' },
    stat('Net sales', currency(t.net), `${t.units} units`),
    stat('Gross profit', currency(profit), `${percent(margin)} margin`),
    stat('VAT collected', currency(t.vat), 'On these sales'),
    stat('Cost of goods', currency(t.cost), `${sales.length} entries`),
  );
}

function ledger(sales, redraw) {
  if (!sales.length) return empty('No sales in this period.');

  const byMonth = new Map();
  sales.forEach((s) => {
    const key = s.date.slice(0, 7);
    if (!byMonth.has(key)) byMonth.set(key, []);
    byMonth.get(key).push(s);
  });

  const out = el('div');
  [...byMonth.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .forEach(([month, entries]) => {
      const t = totalsFor(entries);
      const list = el(
        'div',
        { class: 'list' },
        el('div', { class: 'list-group-label' }, `${monthLabel(month)} · ${currency(t.net)} net`),
      );
      entries.forEach((s) => {
        const profit = (s.net || 0) - (s.cost || 0);
        list.appendChild(
          el(
            'button',
            { class: 'row', type: 'button', onclick: () => editSale(s, redraw) },
            el(
              'div',
              { class: 'row-main' },
              el('div', { class: 'row-title' }, s.customer || 'Sale'),
              el(
                'div',
                { class: 'row-sub' },
                [s.date, CHANNELS.find((c) => c.value === s.channel)?.label, s.reference].filter(Boolean).join(' · '),
              ),
            ),
            el(
              'div',
              { class: 'row-end' },
              el('div', { class: 'row-value' }, currency(s.gross, { code: s.currency })),
              el('div', { class: `row-value-sub ${profit < 0 ? 'text-alert' : ''}` }, `${currency(profit)} profit`),
            ),
          ),
        );
      });
      out.appendChild(list);
    });

  return out;
}

function monthLabel(key) {
  const [y, m] = key.split('-');
  return new Date(Date.UTC(Number(y), Number(m) - 1, 1)).toLocaleDateString('en-GB', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/* ------------------------------------------------------------------- editor */

function editSale(sale, redraw = () => {}) {
  const { settings } = load();
  const isNew = !sale;
  const items = sale?.items ? structuredClone(sale.items) : [];

  const date = input({ type: 'date', value: sale?.date || todayIso() });
  const customer = input({ value: sale?.customer || '', placeholder: 'Who bought it' });
  const channel = select(CHANNELS, { value: sale?.channel || 'web' });
  const reference = input({ value: sale?.reference || '', placeholder: 'Order or invoice number' });
  const gross = input({ type: 'number', inputmode: 'decimal', step: '0.01', value: sale?.gross ?? '' });
  const vatRate = input({ type: 'number', inputmode: 'decimal', step: '1', value: toPercentInput(sale?.vatRate ?? settings.vatRate) });
  const cost = input({ type: 'number', inputmode: 'decimal', step: '0.01', value: sale?.cost ?? '' });
  const units = input({ type: 'number', inputmode: 'numeric', step: '1', value: sale?.units ?? '' });
  const notes = el('textarea', { class: 'input' }, sale?.notes || '');

  const readout = el('p', { class: 'inline-note' });
  const itemsSlot = el('div');

  const derive = () => {
    const g = parseFloat(gross.value) || 0;
    const rate = toFraction(vatRate.value);
    const net = g / (1 + rate);
    const c = parseFloat(cost.value) || 0;
    const profit = net - c;
    readout.textContent = `${currency(net)} net · ${currency(g - net)} VAT · ${currency(profit)} profit${
      net ? ` (${percent(profit / net)})` : ''
    }`;
    readout.className = `inline-note ${profit < 0 ? 'text-alert' : ''}`;
  };

  const drawItems = () => {
    itemsSlot.replaceChildren();
    if (!items.length) return;
    const list = el('div', { class: 'list' });
    items.forEach((it, i) => {
      list.appendChild(
        el(
          'button',
          {
            class: 'row',
            type: 'button',
            onclick: () => {
              items.splice(i, 1);
              recalcFromItems();
            },
          },
          el(
            'div',
            { class: 'row-main' },
            el('div', { class: 'row-title' }, `${it.qty} × ${it.name}`),
            el('div', { class: 'row-sub' }, `${currency(it.unitGross)} each · ${currency(it.unitCost)} cost · tap to remove`),
          ),
          el('div', { class: 'row-value' }, currency(it.qty * it.unitGross)),
        ),
      );
    });
    itemsSlot.appendChild(list);
  };

  const recalcFromItems = () => {
    if (items.length) {
      gross.value = items.reduce((t, i) => t + i.qty * i.unitGross, 0).toFixed(2);
      cost.value = items.reduce((t, i) => t + i.qty * i.unitCost, 0).toFixed(2);
      units.value = items.reduce((t, i) => t + i.qty, 0);
    }
    drawItems();
    derive();
  };

  [gross, vatRate, cost].forEach((node) => node.addEventListener('input', derive));
  derive();
  drawItems();

  const body = el(
    'div',
    {},
    el('div', { class: 'field-grid' }, field('Date', date), field('Channel', channel)),
    field('Customer', customer),
    field('Reference', reference),
    el(
      'div',
      { class: 'btn-row' },
      button(items.length ? 'Add more products' : 'Build from products', {
        onclick: () => pickSaleItems(items, recalcFromItems),
      }),
    ),
    itemsSlot,
    el('div', { class: 'field-grid' }, field('Total incl. VAT', gross), field('VAT %', vatRate)),
    el('div', { class: 'field-grid' }, field('Cost of goods', cost), field('Units', units)),
    readout,
    field('Notes', notes),
  );

  const actions = [
    button('Save', {
      variant: 'primary',
      onclick: () => {
        const g = parseFloat(gross.value);
        if (!Number.isFinite(g) || g <= 0) return toast('Enter the sale total.', 'alert');
        const rate = toFraction(vatRate.value);
        const net = g / (1 + rate);
        saveSale({
          id: sale?.id || uid('sale'),
          date: date.value || todayIso(),
          customer: customer.value.trim(),
          channel: channel.value,
          reference: reference.value.trim(),
          currency: sale?.currency || settings.currency,
          vatRate: rate,
          gross: round2(g),
          net: round2(net),
          vat: round2(g - net),
          cost: round2(parseFloat(cost.value) || 0),
          units: parseInt(units.value, 10) || 0,
          items: items.length ? items : undefined,
          notes: notes.value.trim(),
        });
        closeSheet();
        toast(isNew ? 'Sale logged.' : 'Sale updated.');
        redraw();
      },
    }),
  ];

  if (sale) {
    actions.unshift(
      button('Delete', {
        variant: 'danger',
        onclick: async () => {
          closeSheet();
          if (!(await confirmSheet('Delete sale', 'Remove this entry from the ledger?'))) return;
          deleteSale(sale.id);
          toast('Sale deleted.');
          redraw();
        },
      }),
    );
  }

  sheet(isNew ? 'Log a sale' : 'Edit sale', body, { actions });
}

function pickSaleItems(items, onChange) {
  const all = products();
  const search = input({ type: 'search', placeholder: 'Search products', autocapitalize: 'off' });
  const results = el('div', { class: 'list' });

  const draw = () => {
    const term = search.value.trim().toLowerCase();
    const matches = all.filter((p) => !term || `${displayName(p)} ${p.code || ''}`.toLowerCase().includes(term));
    results.replaceChildren();
    matches.slice(0, 40).forEach((p) => {
      results.appendChild(
        el(
          'button',
          {
            class: 'row',
            type: 'button',
            onclick: () => {
              const existing = items.find((i) => i.productId === p.id);
              if (existing) existing.qty += 1;
              else items.push({ productId: p.id, name: displayName(p), qty: 1, unitGross: p.rrp ?? 0, unitCost: p.cost ?? 0 });
              onChange();
              draw();
            },
          },
          el(
            'div',
            { class: 'row-main' },
            el('div', { class: 'row-title' }, displayName(p)),
            el('div', { class: 'row-sub' }, `${p.rrp ? currency(p.rrp) : 'no RRP'} · ${p.cost !== null ? currency(p.cost) : 'no'} cost`),
          ),
          el('div', { class: 'row-value-sub' }, items.find((i) => i.productId === p.id) ? `×${items.find((i) => i.productId === p.id).qty}` : '+'),
        ),
      );
    });
  };

  search.addEventListener('input', draw);
  draw();

  // The picker sits on top of the sale sheet, so closing it has to restore that one.
  sheet('Add products', el('div', {}, field('Search', search), results), {
    actions: [button('Done', { variant: 'primary', onclick: () => closeSheet() })],
  });
}

const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
