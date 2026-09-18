/*
 * Statutory deadline engine for La Fuga Limited.
 *
 * Rules generate occurrences on demand rather than being stored, so the calendar
 * rolls forward on its own and never needs a yearly top-up. Only the things you
 * change — a completion tick, a custom deadline — get written to storage.
 *
 * Dates are built in UTC so a phone in Spain and a phone in the UK agree on which
 * day a deadline falls.
 */

import { load, update, uid } from './store.js';

export const CATEGORY = {
  vat: { label: 'VAT', tone: 'vat' },
  accounts: { label: 'Companies House', tone: 'accounts' },
  tax: { label: 'Tax', tone: 'tax' },
  other: { label: 'Other', tone: 'other' },
};

/* Company profile the rules key off. Overridable in Settings if HMRC moves a stagger. */
export const PROFILE_DEFAULTS = {
  /* Accounting reference date — the month/day the financial year ends. */
  yearEndMonth: 8, // August
  yearEndDay: 31,
  /* Anniversary of incorporation drives the confirmation statement. */
  incorporatedMonth: 8,
  incorporatedDay: 5,
  /* VAT quarters end in these months (stagger 3: Jan/Apr/Jul/Oct). */
  vatQuarterEndMonths: [1, 4, 7, 10],
  vatRegistered: true,
  payeRegistered: false,
  selfAssessment: true,
};

export function profile() {
  return { ...PROFILE_DEFAULTS, ...(load().settings.complianceProfile || {}) };
}

/* ------------------------------------------------------------------ date utils */

const utc = (y, m, d) => new Date(Date.UTC(y, m - 1, d));
const lastDayOfMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** Clamp day-of-month so 31 February becomes 28/29 February rather than 3 March. */
function safeDate(y, m, d) {
  const yy = y + Math.floor((m - 1) / 12);
  const mm = ((m - 1) % 12 + 12) % 12 + 1;
  return utc(yy, mm, Math.min(d, lastDayOfMonth(yy, mm)));
}

export const iso = (d) => d.toISOString().slice(0, 10);

export function daysUntil(dateIso, today = new Date()) {
  const a = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const b = new Date(`${dateIso}T00:00:00Z`).getTime();
  return Math.round((b - a) / 86400000);
}

/* ------------------------------------------------------------------- generators */

function vatOccurrences(p, fromYear, toYear) {
  if (!p.vatRegistered) return [];
  const out = [];
  for (let y = fromYear; y <= toYear; y += 1) {
    p.vatQuarterEndMonths.forEach((endMonth) => {
      const periodEnd = safeDate(y, endMonth, lastDayOfMonth(y, endMonth));
      const periodStart = safeDate(y, endMonth - 2, 1);
      // HMRC allows one calendar month plus seven days; with month-end periods that
      // always lands on the 7th of the month two months on.
      const due = safeDate(y, endMonth + 2, 7);
      out.push({
        ruleId: 'vat-return',
        id: `vat-return:${iso(periodEnd)}`,
        title: 'VAT return & payment',
        detail: `Quarter ${fmtRange(periodStart, periodEnd)}. File online and pay HMRC by this date.`,
        category: 'vat',
        due: iso(due),
        periodEnd: iso(periodEnd),
      });
    });
  }
  return out;
}

function annualOccurrences(p, fromYear, toYear) {
  const out = [];
  for (let y = fromYear; y <= toYear; y += 1) {
    const yearEnd = safeDate(y, p.yearEndMonth, p.yearEndDay);

    // Accounts to Companies House: nine months after the accounting reference date.
    out.push({
      ruleId: 'ch-accounts',
      id: `ch-accounts:${iso(yearEnd)}`,
      title: 'Annual accounts to Companies House',
      detail: `For the year ended ${fmtDate(yearEnd)}. Late filing is an automatic penalty.`,
      category: 'accounts',
      due: iso(safeDate(y, p.yearEndMonth + 9, p.yearEndDay)),
      periodEnd: iso(yearEnd),
    });

    // Corporation Tax is paid before the return is filed — nine months and a day.
    const payDue = new Date(safeDate(y, p.yearEndMonth + 9, p.yearEndDay).getTime() + 86400000);
    out.push({
      ruleId: 'ct-payment',
      id: `ct-payment:${iso(yearEnd)}`,
      title: 'Corporation Tax payment',
      detail: `For the year ended ${fmtDate(yearEnd)}. Due nine months and one day after year end.`,
      category: 'tax',
      due: iso(payDue),
      periodEnd: iso(yearEnd),
    });

    out.push({
      ruleId: 'ct-return',
      id: `ct-return:${iso(yearEnd)}`,
      title: 'Company Tax Return (CT600)',
      detail: `For the year ended ${fmtDate(yearEnd)}. Due twelve months after year end.`,
      category: 'tax',
      due: iso(safeDate(y + 1, p.yearEndMonth, p.yearEndDay)),
      periodEnd: iso(yearEnd),
    });

    // Confirmation statement: review period ends on the incorporation anniversary,
    // then fourteen days to file.
    const review = safeDate(y, p.incorporatedMonth, p.incorporatedDay);
    const csDue = new Date(review.getTime() + 14 * 86400000);
    out.push({
      ruleId: 'confirmation-statement',
      id: `confirmation-statement:${iso(review)}`,
      title: 'Confirmation statement (CS01)',
      detail: `Review period ended ${fmtDate(review)}. Confirm the company record within 14 days.`,
      category: 'accounts',
      due: iso(csDue),
      periodEnd: iso(review),
    });

    if (p.selfAssessment) {
      out.push({
        ruleId: 'self-assessment',
        id: `self-assessment:${y}`,
        title: 'Director Self Assessment',
        detail: `Online return and balancing payment for the tax year ending 5 April ${y}.`,
        category: 'tax',
        due: iso(utc(y + 1, 1, 31)),
        periodEnd: iso(utc(y, 4, 5)),
      });
    }

    if (p.payeRegistered) {
      out.push({
        ruleId: 'p11d',
        id: `p11d:${y}`,
        title: 'P11D & P11D(b)',
        detail: `Expenses and benefits for the tax year ending 5 April ${y}.`,
        category: 'tax',
        due: iso(utc(y, 7, 6)),
        periodEnd: iso(utc(y, 4, 5)),
      });
      out.push({
        ruleId: 'paye-p60',
        id: `paye-p60:${y}`,
        title: 'P60s to employees',
        detail: `For the tax year ending 5 April ${y}.`,
        category: 'tax',
        due: iso(utc(y, 5, 31)),
        periodEnd: iso(utc(y, 4, 5)),
      });
    }
  }
  return out;
}

/**
 * All deadlines in a window, custom ones included, newest-first by due date.
 * `monthsBack` keeps just-missed items visible instead of silently dropping them.
 */
export function occurrences({ monthsBack = 4, monthsAhead = 18, today = new Date() } = {}) {
  const p = profile();
  const data = load();
  const from = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - monthsBack, 1));
  const to = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + monthsAhead, 28));

  const generated = [
    ...vatOccurrences(p, from.getUTCFullYear() - 1, to.getUTCFullYear() + 1),
    ...annualOccurrences(p, from.getUTCFullYear() - 1, to.getUTCFullYear() + 1),
  ];

  const custom = (data.deadlines.custom || []).map((c) => ({
    ruleId: 'custom',
    id: c.id,
    title: c.title,
    detail: c.detail || '',
    category: c.category || 'other',
    due: c.due,
    custom: true,
  }));

  const dismissed = new Set(data.deadlines.dismissed || []);
  const completed = data.deadlines.completed || {};

  return [...generated, ...custom]
    .filter((o) => !dismissed.has(o.id))
    .filter((o) => {
      const t = new Date(`${o.due}T00:00:00Z`).getTime();
      return t >= from.getTime() && t <= to.getTime();
    })
    .map((o) => {
      const days = daysUntil(o.due, today);
      const done = Boolean(completed[o.id]);
      return {
        ...o,
        days,
        done,
        completedAt: completed[o.id] || null,
        status: done ? 'done' : days < 0 ? 'overdue' : days <= 14 ? 'due' : 'upcoming',
      };
    })
    .sort((a, b) => (a.due === b.due ? a.title.localeCompare(b.title) : a.due < b.due ? -1 : 1));
}

export function nextUp(limit = 3, today = new Date()) {
  return occurrences({ monthsBack: 1, today })
    .filter((o) => !o.done)
    .slice(0, limit);
}

/* --------------------------------------------------------------------- actions */

export function toggleComplete(id, done) {
  return update((d) => {
    if (done) d.deadlines.completed[id] = new Date().toISOString();
    else delete d.deadlines.completed[id];
  });
}

export function addCustom({ title, due, detail = '', category = 'other' }) {
  const entry = { id: uid('dl'), title, due, detail, category };
  update((d) => d.deadlines.custom.push(entry));
  return entry;
}

export function removeCustom(id) {
  return update((d) => {
    d.deadlines.custom = d.deadlines.custom.filter((c) => c.id !== id);
    delete d.deadlines.completed[id];
  });
}

export function dismiss(id) {
  return update((d) => {
    if (!d.deadlines.dismissed.includes(id)) d.deadlines.dismissed.push(id);
  });
}

/* ------------------------------------------------------------------- formatting */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function fmtDate(d) {
  const date = d instanceof Date ? d : new Date(`${d}T00:00:00Z`);
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

function fmtRange(a, b) {
  return `${fmtDate(a)} – ${fmtDate(b)}`;
}

export function relativeLabel(days) {
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  if (days === -1) return '1 day overdue';
  if (days < 0) return `${Math.abs(days)} days overdue`;
  if (days < 31) return `in ${days} days`;
  const months = Math.round(days / 30.4);
  return `in ${months} month${months === 1 ? '' : 's'}`;
}
