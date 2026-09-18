/* Dates — statutory deadlines, generated from the company's own filing profile. */

import {
  occurrences, toggleComplete, addCustom, removeCustom, CATEGORY, fmtDate, relativeLabel,
} from '../deadlines.js';
import {
  el, sectionTitle, empty, button, input, select, field, sheet, closeSheet, toast, pill, confirmSheet, todayIso,
} from '../ui.js';

export default function datesView({ navigate }) {
  const all = occurrences();
  const wrap = el('div');

  const overdue = all.filter((o) => o.status === 'overdue');
  const soon = all.filter((o) => o.status === 'due');
  const later = all.filter((o) => o.status === 'upcoming');
  const done = all.filter((o) => o.done).slice(-8).reverse();

  wrap.appendChild(el('h1', { class: 'page-title' }, 'Dates'));
  wrap.appendChild(
    el(
      'p',
      { class: 'page-sub' },
      overdue.length
        ? `${overdue.length} overdue`
        : soon.length
          ? `${soon.length} due in the next fortnight`
          : 'Nothing pressing',
    ),
  );

  wrap.appendChild(el('div', { class: 'btn-row' }, button('Add a date', { onclick: () => addSheet() })));

  if (overdue.length) {
    wrap.appendChild(sectionTitle('Overdue'));
    wrap.appendChild(group(overdue));
  }
  if (soon.length) {
    wrap.appendChild(sectionTitle('Next 14 days'));
    wrap.appendChild(group(soon));
  }
  if (later.length) {
    wrap.appendChild(sectionTitle('Ahead'));
    wrap.appendChild(group(later));
  }
  if (!all.filter((o) => !o.done).length) {
    wrap.appendChild(empty('Everything in the window is ticked off.'));
  }
  if (done.length) {
    wrap.appendChild(sectionTitle('Recently done'));
    wrap.appendChild(group(done));
  }

  wrap.appendChild(
    el(
      'p',
      { class: 'inline-note' },
      'VAT quarters, accounts, Corporation Tax and the confirmation statement are worked out from the filing dates in Settings. Check anything unusual against HMRC and Companies House.',
    ),
  );

  return wrap;
}

function group(items) {
  const list = el('div', { class: 'list' });
  items.forEach((o) => list.appendChild(row(o)));
  return list;
}

function row(o) {
  const tone = o.done ? 'done' : o.status === 'overdue' ? 'alert' : o.status === 'due' ? 'due' : '';
  return el(
    'button',
    { class: 'row', type: 'button', onclick: () => detail(o) },
    el(
      'div',
      { class: 'row-main' },
      el('div', { class: 'row-title', style: o.done ? { textDecoration: 'line-through', opacity: '0.55' } : {} }, o.title),
      el('div', { class: 'row-sub' }, `${fmtDate(o.due)} · ${CATEGORY[o.category]?.label || 'Other'}`),
    ),
    el('div', { class: 'row-end' }, pill(o.done ? 'Done' : relativeLabel(o.days), tone)),
  );
}

function detail(o) {
  const body = el(
    'div',
    {},
    el('p', { class: 'prose' }, o.detail || 'No further detail.'),
    el('p', { class: 'inline-note' }, `Due ${fmtDate(o.due)} · ${o.done ? `marked done ${o.completedAt?.slice(0, 10)}` : relativeLabel(o.days)}`),
  );

  const actions = [
    button(o.done ? 'Mark not done' : 'Mark done', {
      variant: o.done ? 'ghost' : 'primary',
      onclick: () => {
        toggleComplete(o.id, !o.done);
        closeSheet();
        toast(o.done ? 'Reopened.' : 'Ticked off.');
      },
    }),
  ];

  if (o.custom) {
    actions.unshift(
      button('Delete', {
        variant: 'danger',
        onclick: async () => {
          closeSheet();
          if (!(await confirmSheet('Delete date', `Remove "${o.title}"?`))) return;
          removeCustom(o.id);
          toast('Date removed.');
        },
      }),
    );
  }

  sheet(o.title, body, { actions });
}

function addSheet() {
  const title = input({ placeholder: 'What is due' });
  const due = input({ type: 'date', value: todayIso() });
  const category = select(
    Object.entries(CATEGORY).map(([value, c]) => ({ value, label: c.label })),
    { value: 'other' },
  );
  const detailInput = el('textarea', { class: 'input', placeholder: 'Anything you need to remember' });

  sheet(
    'Add a date',
    el('div', {}, field('Title', title), el('div', { class: 'field-grid' }, field('Due', due), field('Category', category)), field('Detail', detailInput)),
    {
      actions: [
        button('Add', {
          variant: 'primary',
          onclick: () => {
            if (!title.value.trim()) return toast('Give it a title.', 'alert');
            addCustom({
              title: title.value.trim(),
              due: due.value || todayIso(),
              detail: detailInput.value.trim(),
              category: category.value,
            });
            closeSheet();
            toast('Date added.');
          },
        }),
      ],
    },
  );
}
