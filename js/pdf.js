/*
 * Branded quotation PDF.
 *
 * The brand is monochrome and editorial: the Didone wordmark does the talking,
 * everything else is a neutral grotesque, hairline rules, and a lot of white space.
 * No fills, no colour, no boxes — the restraint is the identity.
 *
 * Built with jsPDF's built-in Helvetica so a quote renders identically on a phone
 * with no network, and the wordmark is embedded as data so it can never 404.
 */

import { WORDMARK_PNG, WORDMARK_ASPECT } from '../assets/brand-marks.js';
import { priceQuote } from './pricing.js';
import { fmtDate } from './deadlines.js';

/* A4 in points. */
const PAGE = { w: 595.28, h: 841.89 };
const M = { left: 52, right: 52, top: 52, bottom: 58 };
const CONTENT_W = PAGE.w - M.left - M.right;

const INK = [17, 17, 17];
const MUTED = [125, 125, 125];
const RULE = [205, 205, 205];
const RULE_STRONG = [17, 17, 17];

const CURRENCY = { GBP: '£', EUR: '€', USD: '$' };

export function currencySymbol(code) {
  return CURRENCY[code] || '£';
}

export function money(value, code = 'GBP') {
  const n = Number.isFinite(value) ? value : 0;
  const sign = n < 0 ? '-' : '';
  const body = Math.abs(n)
    .toFixed(2)
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${sign}${currencySymbol(code)}${body}`;
}

export const pct = (v, dp = 0) => `${(v * 100).toFixed(dp)}%`;

/**
 * Render a quote and hand back a jsPDF document.
 * `quote` is the stored shape; `company` and `settings` come from the store.
 */
export function buildQuotePdf({ quote, company, settings }) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'pt', format: 'a4', compress: true });
  const totals = priceQuote(quote);
  const cur = quote.currency || settings.currency || 'GBP';

  let y = masthead(doc, quote, company);
  y = parties(doc, y, quote, company);
  y = lineTable(doc, y, totals, cur, quote);
  const totalsGeom = totalsBlock(doc, y, totals, cur, quote);
  // Terms tuck into the empty column beside the totals when they fit there.
  terms(doc, totalsGeom, quote, settings);
  footers(doc, company);

  return doc;
}

export function quoteFilename(quote, company) {
  const slug = (text, fallback) =>
    (String(text || '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '') || fallback);
  // "La Fuga Cycling Society" -> "LaFuga": enough to identify the sender in Files.
  const brand =
    String(company?.tradingName || company?.name || 'La Fuga')
      .split(/\s+/)
      .slice(0, 2)
      .join('')
      .replace(/[^A-Za-z0-9]/g, '') || 'LaFuga';
  return `${brand}-${quote.ref}-${slug(quote.client?.name, 'quote')}.pdf`;
}

/* ------------------------------------------------------------------- sections */

function masthead(doc, quote, company) {
  const logoW = 116;
  const logoH = logoW / WORDMARK_ASPECT;
  doc.addImage(WORDMARK_PNG, 'PNG', M.left, M.top, logoW, logoH);

  if (company.tradingName) {
    setType(doc, 6.5, 'normal', MUTED);
    doc.text(tracked(company.tradingName.toUpperCase(), 1.6), M.left + 2, M.top + logoH + 12);
  }

  // Right-hand meta column, right-aligned against the margin.
  const x = PAGE.w - M.right;
  setType(doc, 8, 'bold', INK);
  doc.text(tracked('QUOTATION', 2.4), x, M.top + 9, { align: 'right' });

  const rows = [
    ['Reference', quote.ref],
    ['Date', fmtDate(quote.date)],
    quote.validUntil ? ['Valid until', fmtDate(quote.validUntil)] : null,
  ].filter(Boolean);

  // Labels sit in their own left-aligned column so long values stay clear of them.
  const labelX = x - 168;
  let ry = M.top + 26;
  rows.forEach(([label, value]) => {
    setType(doc, 7, 'normal', MUTED);
    doc.text(label.toUpperCase(), labelX, ry);
    setType(doc, 8.5, 'normal', INK);
    doc.text(String(value), x, ry, { align: 'right' });
    ry += 12.5;
  });

  const y = Math.max(M.top + logoH + 24, ry + 4);
  rule(doc, y, RULE_STRONG, 0.8);
  return y + 24;
}

function parties(doc, y, quote, company) {
  const colW = CONTENT_W / 2 - 14;
  const rightX = M.left + CONTENT_W / 2 + 14;

  label(doc, 'Prepared for', M.left, y);
  label(doc, 'From', rightX, y);

  let leftY = y + 16;
  const client = quote.client || {};
  setType(doc, 11, 'bold', INK);
  leftY = wrap(doc, client.name || 'Client', M.left, leftY, colW, 14);

  setType(doc, 9, 'normal', MUTED);
  [client.contact, client.email, client.phone, ...splitLines(client.address)]
    .filter(Boolean)
    .forEach((line) => {
      leftY = wrap(doc, line, M.left, leftY, colW, 11.5);
    });

  let rightY = y + 16;
  setType(doc, 11, 'bold', INK);
  rightY = wrap(doc, company.name, rightX, rightY, colW, 14);

  setType(doc, 9, 'normal', MUTED);
  [...(company.addressLines || []), company.email, company.website]
    .filter(Boolean)
    .forEach((line) => {
      rightY = wrap(doc, line, rightX, rightY, colW, 11.5);
    });

  const bottom = Math.max(leftY, rightY) + 20;
  if (quote.subject) {
    label(doc, 'Subject', M.left, bottom);
    setType(doc, 10, 'normal', INK);
    const end = wrap(doc, quote.subject, M.left, bottom + 15, CONTENT_W, 13);
    return end + 18;
  }
  return bottom;
}

/* Column geometry, right edges for the numeric columns. */
function columns(showDiscount) {
  const right = M.left + CONTENT_W;
  return {
    item: M.left,
    qty: showDiscount ? right - 246 : right - 210,
    unit: showDiscount ? right - 172 : right - 110,
    disc: right - 88,
    amount: right,
    itemW: showDiscount ? CONTENT_W - 262 : CONTENT_W - 226,
    showDiscount,
  };
}

function lineTable(doc, y, totals, cur, quote) {
  const showDiscount = totals.lines.some((l) => l.discountApplied > 0.0001);
  const c = columns(showDiscount);

  y = tableHead(doc, y, c);

  totals.lines.forEach((line) => {
    const nameLines = doc.splitTextToSize(line.name || 'Item', c.itemW);
    const metaBits = [line.code, line.spec].filter(Boolean).join('  ·  ');
    const rowH = nameLines.length * 11.5 + (metaBits ? 9.5 : 0) + 11;

    if (y + rowH > PAGE.h - M.bottom - 30) {
      doc.addPage();
      y = tableHead(doc, continuationHead(doc, quote), c);
    }

    const baseline = y + 10;
    setType(doc, 9.5, 'normal', INK);
    nameLines.forEach((t, i) => doc.text(t, c.item, baseline + i * 11.5));

    if (metaBits) {
      setType(doc, 7.5, 'normal', MUTED);
      doc.text(metaBits, c.item, baseline + nameLines.length * 11.5);
    }

    setType(doc, 9.5, 'normal', INK);
    doc.text(String(line.qty), c.qty, baseline, { align: 'right' });
    doc.text(money(line.netUnit, cur), c.unit, baseline, { align: 'right' });
    if (c.showDiscount) {
      setType(doc, 9.5, 'normal', line.discountApplied > 0.0001 ? INK : MUTED);
      doc.text(line.discountApplied > 0.0001 ? pct(line.discountApplied, 0) : '—', c.disc, baseline, {
        align: 'right',
      });
    }
    setType(doc, 9.5, 'normal', INK);
    doc.text(money(line.netTotal, cur), c.amount, baseline, { align: 'right' });

    y += rowH;
    rule(doc, y - 6, RULE, 0.4);
  });

  return y + 12;
}

/** Masthead for pages after the first: the mark, quietly, plus the reference. */
function continuationHead(doc, quote) {
  const logoW = 62;
  const logoH = logoW / WORDMARK_ASPECT;
  doc.addImage(WORDMARK_PNG, 'PNG', M.left, M.top, logoW, logoH);
  setType(doc, 7, 'normal', MUTED);
  doc.text(`Quotation ${quote.ref} \u00B7 continued`, M.left + CONTENT_W, M.top + logoH - 2, { align: 'right' });
  const y = M.top + logoH + 12;
  rule(doc, y, RULE, 0.4);
  return y + 24;
}

function tableHead(doc, y, c) {
  setType(doc, 7, 'bold', MUTED);
  doc.text(tracked('ITEM', 1.4), c.item, y);
  doc.text(tracked('QTY', 1.4), c.qty, y, { align: 'right' });
  doc.text(tracked('UNIT', 1.4), c.unit, y, { align: 'right' });
  if (c.showDiscount) doc.text(tracked('DISC', 1.4), c.disc, y, { align: 'right' });
  doc.text(tracked('AMOUNT', 1.4), c.amount, y, { align: 'right' });
  rule(doc, y + 8, RULE_STRONG, 0.8);
  return y + 16;
}

function totalsBlock(doc, y, totals, cur, quote) {
  const blockW = 232;
  const x = M.left + CONTENT_W;
  const labelX = x - blockW;

  // Reserve exactly what this block needs, so a quote only spills onto a second
  // page when it genuinely has to.
  const rowCount = totals.discountValue > 0.004 ? 4 : 2;
  const blockH = rowCount * 15 + 62;
  if (y + blockH > PAGE.h - M.bottom - 10) {
    doc.addPage();
    y = continuationHead(doc, quote);
  }

  const startY = y;
  const rows = [];
  if (totals.discountValue > 0.004) {
    rows.push(['Subtotal before discount', money(totals.listSubtotal, cur)]);
    rows.push(['Discount', `-${money(totals.discountValue, cur)}`]);
  }
  rows.push(['Subtotal', money(totals.subtotal, cur)]);
  rows.push([`VAT at ${pct(totals.vatRate, 0)}`, money(totals.vat, cur)]);

  rows.forEach(([label, value]) => {
    setType(doc, 9, 'normal', MUTED);
    doc.text(label, labelX, y, { align: 'left' });
    setType(doc, 9, 'normal', INK);
    doc.text(value, x, y, { align: 'right' });
    y += 15;
  });

  y += 2;
  doc.setDrawColor(...RULE_STRONG);
  doc.setLineWidth(0.8);
  doc.line(labelX, y, x, y);
  y += 17;

  setType(doc, 8, 'bold', INK);
  doc.text(tracked('TOTAL', 2), labelX, y);
  setType(doc, 15, 'bold', INK);
  doc.text(money(totals.total, cur), x, y + 1, { align: 'right' });

  y += 12;
  setType(doc, 7.5, 'normal', MUTED);
  doc.text(`${totals.units} unit${totals.units === 1 ? '' : 's'}  ·  inclusive of VAT`, x, y, { align: 'right' });

  return { startY, endY: y + 26, asideW: CONTENT_W - blockW - 30 };
}

function terms(doc, totalsGeom, quote, settings) {
  const blocks = [
    ['Lead time', quote.leadTime || settings.leadTime],
    ['Payment terms', quote.paymentTerms || settings.paymentTerms],
    ['Notes', quote.notes || settings.footerNote],
  ].filter(([, v]) => v);

  if (!blocks.length) return;

  // Measure first: a padded guess pushes three short lines onto a page of their own.
  setType(doc, 9, 'normal', INK);
  const height = (width) =>
    blocks.reduce((t, [, body]) => t + 14 + doc.splitTextToSize(String(body), width).length * 12.5 + 10, 0);

  // The totals block only claims the right-hand column, so the terms prefer the
  // empty space beside it and fall back to full width underneath.
  const asideFits = totalsGeom.startY + height(totalsGeom.asideW) <= PAGE.h - M.bottom - 2;
  const width = asideFits ? totalsGeom.asideW : CONTENT_W;
  let y = asideFits ? totalsGeom.startY : totalsGeom.endY;

  if (!asideFits && y + height(CONTENT_W) > PAGE.h - M.bottom - 2) {
    doc.addPage();
    y = continuationHead(doc, quote);
  }
  if (!asideFits) rule(doc, y - 12, RULE, 0.4);

  blocks.forEach(([heading, body]) => {
    label(doc, heading, M.left, y);
    setType(doc, 9, 'normal', INK);
    y = wrap(doc, body, M.left, y + 14, width, 12.5) + 10;
  });
}

function footers(doc, company) {
  const pages = doc.getNumberOfPages();
  const legal = [
    company.name,
    company.companyNumber ? `Registered in England & Wales No. ${company.companyNumber}` : null,
    company.vatNumber ? `VAT ${company.vatNumber}` : null,
  ]
    .filter(Boolean)
    .join('  ·  ');

  for (let i = 1; i <= pages; i += 1) {
    doc.setPage(i);
    const y = PAGE.h - M.bottom + 22;
    rule(doc, y - 14, RULE, 0.4);
    setType(doc, 7, 'normal', MUTED);
    doc.text(legal, M.left, y);
    if (pages > 1) {
      doc.text(`${i} / ${pages}`, PAGE.w - M.right, y, { align: 'right' });
    }
  }
}

/* --------------------------------------------------------------------- drawing */

function setType(doc, size, weight, color) {
  doc.setFont('helvetica', weight);
  doc.setFontSize(size);
  doc.setTextColor(...color);
}

function label(doc, text, x, y) {
  setType(doc, 6.5, 'bold', MUTED);
  doc.text(tracked(text.toUpperCase(), 1.6), x, y);
}

function rule(doc, y, color, width) {
  doc.setDrawColor(...color);
  doc.setLineWidth(width);
  doc.line(M.left, y, M.left + CONTENT_W, y);
}

/** Wrap text into a column and return the y below the last line. */
function wrap(doc, text, x, y, width, leading) {
  const lines = doc.splitTextToSize(String(text), width);
  lines.forEach((line, i) => doc.text(line, x, y + i * leading));
  return y + (lines.length - 1) * leading + leading;
}

/**
 * jsPDF has no letter-spacing for built-in fonts, so space the glyphs by hand.
 * Only used on short uppercase labels, where it reads as intent rather than a hack.
 */
function tracked(text, amount) {
  if (!amount) return text;
  const gap = amount > 2 ? '  ' : ' ';
  return text.split('').join(gap);
}

function splitLines(value) {
  if (!value) return [];
  return String(value)
    .split(/\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}
