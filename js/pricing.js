/*
 * Unit economics for La Fuga quotations.
 *
 * Everything here works in the quote's currency and keeps two separate ideas apart:
 *   - the price the customer sees, built up from cost, margin and discounts;
 *   - the margin La Fuga actually keeps once those discounts land.
 *
 * Prices are held excluding VAT internally. VAT is added once, at the end, on the
 * discounted subtotal — which is how a UK VAT invoice has to read.
 */

export const PRICING_MODES = {
  margin: 'Target net margin',
  markup: 'Markup on cost',
  rrp: 'RRP',
  fixed: 'Fixed price',
};

export const ROUNDING = [
  { value: 0, label: 'Exact (0.01)' },
  { value: 0.5, label: 'Nearest 0.50' },
  { value: 1, label: 'Nearest 1' },
  { value: 5, label: 'Nearest 5' },
];

const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

export function roundTo(value, step) {
  if (!step) return round2(value);
  return round2(Math.round(value / step) * step);
}

/**
 * Price a single unit, excluding VAT, before any discount.
 * `margin` and `markup` are fractions (0.45 = 45%). `rrp` is inclusive of VAT.
 */
export function baseUnitPrice({ mode, cost = 0, margin = 0, markup = 0, rrp = 0, fixed = 0, vatRate = 0 }) {
  switch (mode) {
    case 'markup':
      return cost * (1 + markup);
    case 'rrp':
      return rrp / (1 + vatRate);
    case 'fixed':
      return fixed;
    case 'margin':
    default:
      // Margin is measured on the sale price, so it has to be inverted, not added.
      // A margin at or above 100% has no finite price; clamp so the UI degrades
      // to "cost" rather than Infinity.
      if (margin >= 0.999) return cost * 1000;
      return cost / (1 - margin);
  }
}

/**
 * Cost a whole quote.
 *
 * quote = {
 *   vatRate, targetMargin, markup, discount (quote-wide), rounding, commissionRate,
 *   lines: [{ productId, name, code, qty, mode, cost, rrp, fixed, margin, markup, discount }]
 * }
 * Any per-line `margin`/`markup`/`mode` left undefined falls back to the quote default.
 */
export function priceQuote(quote) {
  const vatRate = num(quote.vatRate);
  const quoteDiscount = clampFraction(quote.discount);
  const commissionRate = num(quote.commissionRate);
  const step = num(quote.rounding);

  const lines = (quote.lines || []).map((line) => {
    const qty = Math.max(0, num(line.qty));
    const cost = num(line.cost);
    const mode = line.mode || quote.mode || 'margin';
    const margin = clampFraction(line.margin ?? quote.targetMargin);
    const markup = num(line.markup ?? quote.markup);

    const listUnit = roundTo(
      baseUnitPrice({ mode, cost, margin, markup, rrp: num(line.rrp), fixed: num(line.fixed), vatRate }),
      step,
    );

    const lineDiscount = clampFraction(line.discount);
    // Line and quote discounts compound rather than add: 10% then 5% is 14.5% off.
    const netUnit = round2(listUnit * (1 - lineDiscount) * (1 - quoteDiscount));

    const netTotal = round2(netUnit * qty);
    const costTotal = round2(cost * qty);
    const commission = round2(netTotal * commissionRate);
    const profit = round2(netTotal - costTotal - commission);

    return {
      ...line,
      qty,
      cost,
      mode,
      listUnit,
      discountApplied: 1 - (1 - lineDiscount) * (1 - quoteDiscount),
      netUnit,
      netTotal,
      costTotal,
      commission,
      profit,
      margin: netTotal ? profit / netTotal : 0,
      vatTotal: round2(netTotal * vatRate),
      grossTotal: round2(netTotal * (1 + vatRate)),
    };
  });

  const sum = (key) => round2(lines.reduce((t, l) => t + l[key], 0));

  // Gross subtotal is what the lines would have come to at list, so the quote can
  // show the customer the discount as a cash figure.
  const listSubtotal = round2(lines.reduce((t, l) => t + l.listUnit * l.qty, 0));
  const subtotal = sum('netTotal');
  const costTotal = sum('costTotal');
  const commission = sum('commission');
  const profit = round2(subtotal - costTotal - commission);
  const vat = round2(subtotal * vatRate);

  return {
    lines,
    units: lines.reduce((t, l) => t + l.qty, 0),
    listSubtotal,
    discountValue: round2(listSubtotal - subtotal),
    subtotal,
    vat,
    vatRate,
    total: round2(subtotal + vat),
    costTotal,
    commission,
    profit,
    margin: subtotal ? profit / subtotal : 0,
    markupOnCost: costTotal ? profit / costTotal : 0,
  };
}

/** The discount that takes a line to exactly zero profit — the floor to quote against. */
export function breakEvenDiscount(listUnit, cost, commissionRate = 0) {
  if (!listUnit) return 0;
  const keptShare = 1 - clampFraction(commissionRate);
  const floor = keptShare > 0 ? cost / keptShare : cost;
  return Math.max(0, 1 - floor / listUnit);
}

function num(v) {
  const n = typeof v === 'string' ? parseFloat(v) : v;
  return Number.isFinite(n) ? n : 0;
}

function clampFraction(v) {
  const n = num(v);
  return Math.min(Math.max(n, 0), 0.999);
}

export { num as toNumber, round2 };
