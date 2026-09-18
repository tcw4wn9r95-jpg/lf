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

/* ------------------------------------------------------- unit economics */

/*
 * The landed-cost stack, mirroring the Unit Economics tab of the financial model:
 * manufacture and packaging make FOB, the logistics lines make the import cost,
 * and together they make the DDP cost of one unit on the shelf.
 */
export const COST_LINES = [
  { key: 'manufacture', label: 'Manufacture', group: 'production' },
  { key: 'packaging', label: 'Packaging', group: 'production' },
  { key: 'freightIn', label: 'Transport CN → LU', group: 'logistics' },
  { key: 'freightOut', label: 'Transport LU → ES', group: 'logistics' },
  { key: 'insurance', label: 'Insurance', group: 'logistics' },
  { key: 'duty', label: 'Duty', group: 'logistics' },
  { key: 'importVat', label: 'Import VAT', group: 'logistics' },
];

/** Add the stack up. Falls back to the flat `cost` when no breakdown was imported. */
export function costStack(product, { reclaimImportVat = false } = {}) {
  const b = product?.breakdown;
  if (!b) {
    const flat = num(product?.cost);
    return { hasBreakdown: false, fob: flat, importCosts: 0, importVat: 0, landed: flat, lines: {} };
  }

  const lines = {};
  COST_LINES.forEach(({ key }) => {
    lines[key] = num(b[key]);
  });

  const fob = round2(lines.manufacture + lines.packaging);
  const importCosts = round2(lines.freightIn + lines.freightOut + lines.insurance + lines.duty + lines.importVat);
  // Import VAT is input tax: a VAT-registered company reclaims it, so it is a cash
  // timing cost rather than a cost of goods. Off by default to match the sheet.
  const recovered = reclaimImportVat ? lines.importVat : 0;

  return {
    hasBreakdown: true,
    lines,
    fob,
    importCosts,
    importVat: lines.importVat,
    recovered,
    landed: round2(fob + importCosts - recovered),
    landedWithVat: round2(fob + importCosts),
  };
}

/** The price ladder: retail, the standing sale discount, collab, distributor. */
export function priceTiers(product, settings) {
  const rrp = num(product?.rrp);
  const distributor = Number.isFinite(product?.distributorDiscount)
    ? product.distributorDiscount
    : num(settings.distributorDiscount);

  return [
    { id: 'retail', label: 'Retail', discount: 0, gross: rrp },
    { id: 'discount', label: 'Sale', discount: num(settings.saleDiscount), gross: round2(rrp * (1 - num(settings.saleDiscount))) },
    { id: 'collab', label: 'Collab', discount: num(settings.collabDiscount), gross: round2(rrp * (1 - num(settings.collabDiscount))) },
    { id: 'distributor', label: 'Distributor', discount: distributor, gross: round2(rrp * (1 - distributor)) },
  ];
}

/**
 * Everything needed to judge one product: the cost stack, and what each price tier
 * actually leaves once VAT and platform commission come out.
 *
 * VAT is extracted from the gross price (gross x rate / (1 + rate)) — it is money
 * collected for HMRC, never revenue. Commission is charged on the net.
 */
export function unitEconomics(product, settings) {
  const stack = costStack(product, { reclaimImportVat: settings.reclaimImportVat });
  const vatRate = num(settings.vatRate);
  const commissionRate = num(settings.commissionRate);
  const overheads = num(settings.monthlyOverheads);

  const tiers = priceTiers(product, settings).map((tier) => {
    const net = tier.gross / (1 + vatRate);
    const vat = round2(tier.gross - net);
    const commission = round2(net * commissionRate);
    const profit = round2(net - commission - stack.landed);
    return {
      ...tier,
      net: round2(net),
      vat,
      commission,
      cost: stack.landed,
      profit,
      margin: net ? profit / net : 0,
      markup: stack.landed ? profit / stack.landed : 0,
      unitsForOverheads: profit > 0 ? Math.ceil(overheads / profit) : null,
    };
  });

  // The gross price at which this product exactly washes its face.
  const keptShare = (1 - commissionRate) / (1 + vatRate);
  const floorGross = keptShare > 0 ? round2(stack.landed / keptShare) : 0;

  return { stack, tiers, floorGross, vatRate, commissionRate };
}

/**
 * How the model's own figures were reached, for the reconciliation note.
 * The sheet takes VAT as a percentage OF the gross price rather than the VAT
 * fraction of it, and charges commission against the collab price rather than the
 * price being sold at — both understate profit.
 */
export function sheetComparison(product, settings) {
  const gross = num(product?.rrp);
  if (!gross) return null;
  // The note describes the spreadsheet, so it has to use the rate the spreadsheet
  // assumed — not whatever the app is currently set to for the market being sold in.
  const vatRate = num(settings.modelVatRate) || num(settings.vatRate);
  const landed = costStack(product).landedWithVat ?? num(product.cost);
  const collabGross = gross * (1 - num(settings.collabDiscount));

  const sheetVat = round2(gross * vatRate);
  const sheetCommission = round2(collabGross * num(settings.commissionRate));
  const sheetNet = round2(gross - landed - sheetCommission - sheetVat);

  const economics = unitEconomics(product, settings);
  const ours = economics.tiers[0].profit;

  return {
    sheetVat,
    sheetCommission,
    sheetNet,
    ours,
    modelVatRate: vatRate,
    sameVatBasis: Math.abs(vatRate - num(settings.vatRate)) < 0.0001,
    difference: round2(ours - sheetNet),
  };
}
