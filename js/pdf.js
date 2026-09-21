/*
 * Branded quotation PDF.
 *
 * The brand is monochrome and editorial: the Didone lockup does the talking,
 * everything else is Gotham, hairline rules, and a lot of white space. No fills,
 * no colour, no boxes — the restraint is the identity.
 *
 * The logo is embedded as data and the typeface is embedded as bytes, so a quote
 * renders identically on a phone with no network and never depends on a font
 * being installed wherever the client opens it.
 */

import { LOCKUP_PNG, LOCKUP_ASPECT } from '../assets/brand-marks.js';
import { registerPdfFonts } from './fonts.js';
import { priceQuote, suggestedVatNote } from './pricing.js';
import { INCOTERMS, country, SELLER_COUNTRY } from './landed.js';
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
  FAMILY = registerPdfFonts(doc).family;
  const totals = priceQuote(quote);
  const cur = quote.currency || settings.currency || 'GBP';

  let y = masthead(doc, quote, company);
  y = parties(doc, y, quote, company);
  y = lineTable(doc, y, totals, cur, quote);
  const totalsGeom = totalsBlock(doc, y, totals, cur, quote, company);
  // Terms tuck into the empty column beside the totals when they fit there.
  const afterTerms = terms(doc, totalsGeom, quote, settings);
  remarks(doc, afterTerms, quote);
  footers(doc, company, quote);

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
  // The lockup carries "cycling society" itself — never set it as type alongside.
  const logoW = 128;
  const logoH = logoW / LOCKUP_ASPECT;
  doc.addImage(LOCKUP_PNG, 'PNG', M.left, M.top, logoW, logoH);

  // Right-hand meta column, right-aligned against the margin.
  const x = PAGE.w - M.right;
  setType(doc, 9, 'bold', INK);
  doc.text('QUOTATION', x, M.top + 9, { align: 'right' });

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

  const y = Math.max(M.top + logoH + 20, ry + 4);
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
  [
    client.contact,
    client.email,
    client.phone,
    ...splitLines(client.address),
    // The destination country belongs in the address once goods cross a border.
    client.country && client.country !== SELLER_COUNTRY ? country(client.country)?.name : null,
    // A zero-rated supply to a business abroad has to name their VAT number.
    client.vatNumber ? `VAT ${client.vatNumber}` : null,
  ]
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

  y = tableHead(doc, y, c, quote);

  totals.lines.forEach((line) => {
    const nameLines = doc.splitTextToSize(line.name || 'Item', c.itemW);
    const metaBits = [line.code, line.spec].filter(Boolean).join('  ·  ');
    // The second VAT basis needs a line of its own on the right, so the row has to
    // clear both that and whatever the item name takes on the left.
    const rowH =
      Math.max(nameLines.length * 11.5 + (metaBits ? 9.5 : 0), 11.5 + (showsBoth(quote) ? 9.5 : 0)) + 11;

    if (y + rowH > PAGE.h - M.bottom - 30) {
      doc.addPage();
      y = tableHead(doc, continuationHead(doc, quote), c, quote);
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
    doc.text(money(primary(line, 'unit', quote), cur), c.unit, baseline, { align: 'right' });
    if (c.showDiscount) {
      setType(doc, 9.5, 'normal', line.discountApplied > 0.0001 ? INK : MUTED);
      doc.text(line.discountApplied > 0.0001 ? pct(line.discountApplied, 0) : '—', c.disc, baseline, {
        align: 'right',
      });
    }
    setType(doc, 9.5, 'normal', INK);
    doc.text(money(primary(line, 'total', quote), cur), c.amount, baseline, { align: 'right' });

    // In "both" mode the second basis rides under the figures, quietly.
    if (showsBoth(quote)) {
      setType(doc, 7.5, 'normal', MUTED);
      const sub = baseline + 9.5;
      doc.text(money(line.unitGross, cur), c.unit, sub, { align: 'right' });
      doc.text(money(line.grossTotal, cur), c.amount, sub, { align: 'right' });
    }

    y += rowH;
    rule(doc, y - 6, RULE, 0.4);
  });

  // Delivery passed on is a line the customer is paying for, so it belongs in
  // the table with everything else rather than appearing inside the total.
  if (totals.logisticsCharge > 0.004) {
    const net = totals.logisticsCharge;
    const gross = totals.logisticsChargeGross;
    const inclusive = !quote.vatRate || (quote.priceDisplay || 'both') === 'incl';
    const rowH = 11.5 + (showsBoth(quote) ? 9.5 : 0) + 11;
    if (y + rowH > PAGE.h - M.bottom - 30) {
      doc.addPage();
      y = tableHead(doc, continuationHead(doc, quote), c, quote);
    }
    const baseline = y + 10;
    setType(doc, 9.5, 'normal', INK);
    doc.text(deliveryLabel(quote), c.item, baseline);
    doc.text(money(inclusive ? gross : net, cur), c.amount, baseline, { align: 'right' });
    if (showsBoth(quote)) {
      setType(doc, 7.5, 'normal', MUTED);
      doc.text(money(gross, cur), c.amount, baseline + 9.5, { align: 'right' });
    }
    y += rowH;
    rule(doc, y - 6, RULE, 0.4);
  }

  return y + 12;
}

/** What the passed-on logistics charge is called in front of the customer. */
function deliveryLabel(quote) {
  const code = quote.incoterm;
  if (code === 'DDP') return 'Delivery, duties and clearance';
  if (code === 'DAP' || code === 'CIF') return 'Delivery';
  return 'Delivery and handling';
}

/** Masthead for pages after the first: the mark, quietly, plus the reference. */
function continuationHead(doc, quote) {
  const logoW = 70;
  const logoH = logoW / LOCKUP_ASPECT;
  doc.addImage(LOCKUP_PNG, 'PNG', M.left, M.top, logoW, logoH);
  setType(doc, 7, 'normal', MUTED);
  doc.text(`Quotation ${quote.ref} \u00B7 continued`, M.left + CONTENT_W, M.top + logoH - 2, { align: 'right' });
  const y = M.top + logoH + 12;
  rule(doc, y, RULE, 0.4);
  return y + 24;
}

function tableHead(doc, y, c, quote) {
  setType(doc, 7, 'bold', MUTED);
  doc.text('ITEM', c.item, y);
  doc.text('QTY', c.qty, y, { align: 'right' });
  const basis = quote && quote.vatRate && quote.priceDisplay !== 'incl' ? ' EXCL. VAT' : '';
  doc.text(`UNIT${basis}`, c.unit, y, { align: 'right' });
  if (c.showDiscount) doc.text('DISC', c.disc, y, { align: 'right' });
  doc.text(`AMOUNT${basis}`, c.amount, y, { align: 'right' });
  rule(doc, y + 8, RULE_STRONG, 0.8);
  return y + 16;
}

function totalsBlock(doc, y, totals, cur, quote, company) {
  const blockW = 232;
  const x = M.left + CONTENT_W;
  const labelX = x - blockW;

  // Reserve exactly what this block needs, so a quote only spills onto a second
  // page when it genuinely has to.
  const rowCount = (totals.discountValue > 0.004 ? 2 : 0) + (totals.vatRate ? 2 : 0);
  // The VAT note is measured, not guessed: a three-line note must not be what
  // pushes the totals onto a page of their own.
  const note = quote.vatNote || suggestedVatNote(totals.vatRate, company);
  setType(doc, 7, 'normal', MUTED);
  const noteLines = note ? doc.splitTextToSize(String(note), blockW) : [];
  const blockH = rowCount * 15 + 62 + (noteLines.length ? 14 + noteLines.length * 9 : 0);
  if (y + blockH > PAGE.h - M.bottom - 10) {
    doc.addPage();
    y = continuationHead(doc, quote);
  }

  const startY = y;
  // Prices are shown inclusive of VAT, as the catalogue is priced, with the VAT
  // called out inside the total so the quote still reads as a VAT document.
  const rows = [];
  if (totals.discountValue > 0.004) {
    // The retail line follows the basis the table is written in, so the column
    // reads straight down: retail less discount is the net, plus VAT is the total.
    const exVat = Boolean(totals.vatRate) && (quote.priceDisplay || 'both') !== 'incl';
    const listNet = Math.round((totals.listGrossSubtotal / (1 + totals.vatRate)) * 100) / 100;
    const list = exVat ? listNet : totals.listGrossSubtotal;
    const off = exVat ? Math.round((listNet - totals.subtotal) * 100) / 100 : totals.discountValue;
    rows.push([exVat ? 'Retail value excl. VAT' : 'Retail value', money(list, cur)]);
    rows.push(['Discount', `-${money(off, cur)}`]);
  }
  if (totals.vatRate) {
    rows.push(['Net of VAT', money(totals.subtotal, cur)]);
    rows.push([`VAT at ${pct(totals.vatRate, 0)}`, money(totals.vat, cur)]);
  }

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
  doc.text('TOTAL', labelX, y);
  setType(doc, 15, 'bold', INK);
  doc.text(money(totals.total, cur), x, y + 1, { align: 'right' });

  y += 12;
  setType(doc, 7.5, 'normal', MUTED);
  doc.text(`${totals.units} unit${totals.units === 1 ? '' : 's'}  ·  ${basisCaption(quote, totals)}`, x, y, {
    align: 'right',
  });

  // The note sits under the block, ranged with it, in the quote's own words when
  // one is written and a sensible default when it is not.
  if (noteLines.length) {
    setType(doc, 7, 'normal', MUTED);
    noteLines.forEach((line, i) => doc.text(line, x, y + 14 + i * 9, { align: 'right' }));
    y += 14 + (noteLines.length - 1) * 9;
  }

  return { startY, endY: y + 26, asideW: CONTENT_W - blockW - 30 };
}

function terms(doc, totalsGeom, quote, settings) {
  const blocks = [
    ['Delivery terms', deliveryTerms(quote)],
    ['Lead time', quote.leadTime || settings.leadTime],
    ['Payment terms', quote.paymentTerms || settings.paymentTerms],
    ['Notes', quote.notes || settings.footerNote],
  ].filter(([, v]) => v);

  if (!blocks.length) return totalsGeom.endY;

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

  // The terms may have sat beside the totals; whatever comes next has to clear both.
  return Math.max(y, totalsGeom.endY);
}

/** The incoterm, written the way a forwarder reads it: code, name, place. */
function deliveryTerms(quote) {
  const term = INCOTERMS.find((i) => i.code === quote.incoterm);
  if (!term) return '';
  const place = country(quote.client?.country)?.name;
  return `${term.code} — ${term.name}${place ? `, ${place}` : ''} (Incoterms 2020).`;
}

/**
 * Anything else the quotation has to say, in full and at full width. Kept out of
 * the narrow column beside the totals because remarks tend to be the part that
 * actually needs reading.
 */
function remarks(doc, y, quote) {
  const body = String(quote.remarks || '').trim();
  if (!body) return y;

  const paragraphs = body.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  setType(doc, 9, 'normal', INK);
  const height = paragraphs.reduce((t, p) => t + doc.splitTextToSize(p, CONTENT_W).length * 12.5 + 6, 14);

  if (y + height > PAGE.h - M.bottom - 2) {
    doc.addPage();
    y = continuationHead(doc, quote);
  } else {
    y += 8;
    rule(doc, y - 10, RULE, 0.4);
  }

  label(doc, 'Remarks', M.left, y);
  y += 14;
  paragraphs.forEach((p) => {
    setType(doc, 9, 'normal', INK);
    y = wrap(doc, p, M.left, y, CONTENT_W, 12.5) + 6;
  });
  return y;
}

function footers(doc, company, quote) {
  const pages = doc.getNumberOfPages();
  // The EORI only matters once goods cross a border, and then it matters a lot —
  // it is the number the customer's forwarder will ask for.
  const crossing = Boolean(quote?.client?.country) && quote.client.country !== SELLER_COUNTRY;
  const legal = [
    company.name,
    company.companyNumber ? `Registered in England & Wales No. ${company.companyNumber}` : null,
    company.vatNumber ? `VAT ${company.vatNumber}` : null,
    crossing && company.eori ? `EORI ${company.eori}` : null,
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

/* Set by buildQuotePdf once the fonts are registered on the document. */
let FAMILY = 'helvetica';

function setType(doc, size, weight, color) {
  doc.setFont(FAMILY, weight);
  doc.setFontSize(size);
  doc.setTextColor(...color);
}

function label(doc, text, x, y) {
  setType(doc, 6.5, 'bold', MUTED);
  doc.text(text.toUpperCase(), x, y);
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

function splitLines(value) {
  if (!value) return [];
  return String(value)
    .split(/\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/* ------------------------------------------------------------ VAT display */

/** True when the quotation is set to print both the net and the gross figure. */
/** What the figures in the table mean, said once under the total. */
function basisCaption(quote, totals) {
  if (!totals.vatRate) return 'no VAT charged';
  const mode = quote.priceDisplay || 'both';
  if (mode === 'incl') return 'all prices include VAT';
  if (mode === 'excl') return 'prices exclude VAT, total includes it';
  return 'unit and amount excl. VAT, incl. beneath';
}

function showsBoth(quote) {
  return Boolean(quote.vatRate) && (quote.priceDisplay || 'both') === 'both';
}

/**
 * The figure that leads each column.
 *
 * Net leads unless the quotation is set to show VAT-inclusive prices only — a
 * quote is a commercial document, and the net price is the one being negotiated.
 * With no VAT to add, the two are the same number and only one is printed.
 */
function primary(line, which, quote) {
  const inclusive = !quote.vatRate || (quote.priceDisplay || 'both') === 'incl';
  if (which === 'unit') return inclusive ? line.unitGross : line.unitNet;
  return inclusive ? line.grossTotal : line.netTotal;
}
