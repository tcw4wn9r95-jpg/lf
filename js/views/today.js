/* Today — the one screen worth opening without a reason. */

import { load, hasFinancials } from '../store.js';
import { nextUp, fmtDate, relativeLabel, occurrences } from '../deadlines.js';
import { priceQuote } from '../pricing.js';
import { totalsFor, periodStart } from './sales.js';
import { el, sectionTitle, button, stat, pill, currency, percent, empty } from '../ui.js';

export default function todayView({ navigate }) {
  const data = load();
  const wrap = el('div');

  const now = new Date();
  wrap.appendChild(el('h1', { class: 'page-title' }, monthName(now)));
  wrap.appendChild(
    el('p', { class: 'page-sub' }, now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })),
  );

  if (!hasFinancials()) {
    wrap.appendChild(
      el(
        'div',
        { class: 'hint-block' },
        el('strong', {}, 'One-time setup. '),
        'Import your unit economics so quotations can price themselves. They are stored on this phone only.',
        el('div', { class: 'btn-row' }, button('Open settings', { variant: 'primary', onclick: () => navigate('#/settings') })),
      ),
    );
  }

  /* This month */
  const monthSales = data.sales.filter((s) => new Date(`${s.date}T00:00:00Z`) >= periodStart('month', now));
  const t = totalsFor(monthSales);
  const profit = t.net - t.cost;
  const overheads = data.settings.monthlyOverheads || 0;
  const afterOverheads = profit - overheads;

  wrap.appendChild(
    el(
      'div',
      { class: 'stat-grid' },
      stat('Net sales', currency(t.net), `${t.units} units`),
      stat('Gross profit', currency(profit), t.net ? `${percent(profit / t.net)} margin` : 'No sales yet'),
      stat(
        'After overheads',
        el('span', { class: afterOverheads < 0 ? 'is-alert' : 'is-good' }, currency(afterOverheads)),
        `${currency(overheads)} fixed`,
      ),
      stat('VAT collected', currency(t.vat), 'Set aside'),
    ),
  );

  wrap.appendChild(
    el(
      'div',
      { class: 'btn-row' },
      button('New quotation', { variant: 'primary', onclick: () => navigate('#/quotes/new') }),
      button('Log a sale', { onclick: () => navigate('#/sales') }),
    ),
  );

  /* Deadlines */
  const upcoming = nextUp(3, now);
  const overdue = occurrences({ today: now }).filter((o) => o.status === 'overdue');
  wrap.appendChild(sectionTitle('Coming up', button('All dates', { variant: 'quiet', onclick: () => navigate('#/dates') })));

  if (!upcoming.length) {
    wrap.appendChild(empty('Nothing due in the window.'));
  } else {
    const list = el('div', { class: 'list' });
    upcoming.forEach((o) => {
      list.appendChild(
        el(
          'button',
          { class: 'row', type: 'button', onclick: () => navigate('#/dates') },
          el(
            'div',
            { class: 'row-main' },
            el('div', { class: 'row-title' }, o.title),
            el('div', { class: 'row-sub' }, fmtDate(o.due)),
          ),
          el('div', { class: 'row-end' }, pill(relativeLabel(o.days), o.status === 'overdue' ? 'alert' : o.status === 'due' ? 'due' : '')),
        ),
      );
    });
    wrap.appendChild(list);
  }

  if (overdue.length) {
    wrap.appendChild(el('p', { class: 'inline-note text-alert' }, `${overdue.length} deadline${overdue.length === 1 ? '' : 's'} already past.`));
  }

  /* Recent quotes */
  if (data.quotes.length) {
    wrap.appendChild(sectionTitle('Latest quotations', button('All', { variant: 'quiet', onclick: () => navigate('#/quotes') })));
    const list = el('div', { class: 'list' });
    data.quotes.slice(0, 3).forEach((q) => {
      const totals = priceQuote(q);
      list.appendChild(
        el(
          'button',
          { class: 'row', type: 'button', onclick: () => navigate(`#/quotes/${q.id}`) },
          el(
            'div',
            { class: 'row-main' },
            el('div', { class: 'row-title' }, q.client?.name || 'Untitled'),
            el('div', { class: 'row-sub' }, `${q.ref} · ${q.status || 'draft'}`),
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
    wrap.appendChild(list);
  }

  const backup = data.settings.lastBackupAt;
  if (data.sales.length + data.quotes.length > 0) {
    const stale = !backup || Date.now() - new Date(backup).getTime() > 30 * 86400000;
    wrap.appendChild(
      el(
        'p',
        { class: `inline-note ${stale ? 'text-alert' : ''}` },
        stale
          ? 'Everything lives on this phone. Export a backup from Settings — clearing Safari data would wipe it.'
          : `Last backup ${fmtDate(backup.slice(0, 10))}.`,
      ),
    );
  }

  return wrap;
}

function monthName(d) {
  return d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
}
