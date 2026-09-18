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
 * Price one line of a quotation.
 *
 * Everything the user sees is VAT-INCLUSIVE, because that is how the catalogue is
 * priced — "Precio Normal (con IVA)". A jersey listed at £116 is quoted at £116,
 * not at £96.67. VAT is pulled back out only to work out what the sale actually
 * earns, since VAT is money collected for HMRC and never revenue.
 *
 * A product with no RRP on file falls back to a price that clears the margin
 * floor, and says so, rather than being quoted at nothing.
 */
export function lineListPrice(line, quote) {
  const fixed = num(line.fixed);
  if (fixed > 0) return { gross: fixed, fallback: false };

  const rrp = num(line.rrp);
  if (rrp > 0) return { gross: rrp, fallback: false };

  const cost = num(line.cost);
  const floor = clampFraction(quote.minMargin ?? 0.3);
  const commission = clampFraction(quote.commissionRate);
  const denominator = 1 - commission - floor;
  const net = denominator > 0 ? cost / denominator : cost;
  return { gross: roundTo(net * (1 + num(quote.vatRate)), 1), fallback: true };
}

/**
 * Cost a whole quote, in VAT-inclusive money.
 *
 * quote = {
 *   vatRate, discount (quote-wide), commissionRate, minMargin,
 *   lines: [{ productId, name, code, qty, cost, rrp, fixed, discount }]
 * }
 */
export function priceQuote(quote) {
  const vatRate = num(quote.vatRate);
  const quoteDiscount = clampFraction(quote.discount);
  const commissionRate = num(quote.commissionRate);

  const lines = (quote.lines || []).map((line) => {
    const qty = Math.max(0, num(line.qty));
    const cost = num(line.cost);
    const { gross: listGross, fallback } = lineListPrice(line, quote);

    const lineDiscount = clampFraction(line.discount);
    // Line and quote discounts compound rather than add: 10% then 5% is 14.5% off.
    const discountApplied = 1 - (1 - lineDiscount) * (1 - quoteDiscount);
    const unitGross = round2(listGross * (1 - lineDiscount) * (1 - quoteDiscount));

    const grossTotal = round2(unitGross * qty);
    const netTotal = round2(grossTotal / (1 + vatRate));
    const vatTotal = round2(grossTotal - netTotal);
    const costTotal = round2(cost * qty);
    const commission = round2(netTotal * commissionRate);
    const profit = round2(netTotal - costTotal - commission);

    return {
      ...line,
      qty,
      cost,
      listGross,
      usesFallbackPrice: fallback,
      discountApplied,
      unitGross,
      unitNet: round2(unitGross / (1 + vatRate)),
      grossTotal,
      netTotal,
      vatTotal,
      costTotal,
      commission,
      profit,
      margin: netTotal ? profit / netTotal : 0,
    };
  });

  const sum = (key) => round2(lines.reduce((t, l) => t + l[key], 0));

  const listGrossSubtotal = round2(lines.reduce((t, l) => t + l.listGross * l.qty, 0));
  const grossTotal = sum('grossTotal');
  const netTotal = sum('netTotal');
  const vat = round2(grossTotal - netTotal);
  const costTotal = sum('costTotal');
  const commission = sum('commission');
  const profit = round2(netTotal - costTotal - commission);

  return {
    lines,
    units: lines.reduce((t, l) => t + l.qty, 0),
    listGrossSubtotal,
    discountValue: round2(listGrossSubtotal - grossTotal),
    grossTotal,
    subtotal: netTotal,
    vat,
    vatRate,
    total: grossTotal,
    costTotal,
    commission,
    profit,
    margin: netTotal ? profit / netTotal : 0,
    markupOnCost: costTotal ? profit / costTotal : 0,
  };
}

/**
 * The largest discount off a VAT-inclusive list price that still leaves
 * `targetMargin`. With targetMargin 0 this is the break-even point: one penny
 * more and the line is sold below what it cost to land.
 */
export function maxDiscountForMargin(listGross, cost, targetMargin = 0, commissionRate = 0, vatRate = 0) {
  if (!listGross) return 0;
  const denominator = 1 - clampFraction(commissionRate) - clampFraction(targetMargin);
  if (denominator <= 0) return 0;
  const minimumGross = (cost / denominator) * (1 + num(vatRate));
  return Math.max(0, 1 - minimumGross / listGross);
}

/** The discount that takes a line to exactly zero profit — the floor to quote against. */
export function breakEvenDiscount(listGross, cost, commissionRate = 0, vatRate = 0) {
  return maxDiscountForMargin(listGross, cost, 0, commissionRate, vatRate);
}

/**
 * Turn a margin into a go/no-go call against the floor set in Settings.
 * 'loss' is money out of the door; 'thin' clears cost but misses the floor.
 */
export function marginVerdict(margin, minMargin = 0, profit = 0) {
  if (profit < 0 || margin < 0) return 'loss';
  if (minMargin > 0 && margin < minMargin) return 'thin';
  return 'ok';
}

export const VERDICT_TONE = { ok: 'good', thin: 'due', loss: 'alert' };

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

/** Per-unit costs added on top of a base product: printing, pads, labels, artwork. */
export function customisationLines(product) {
  const lines = Array.isArray(product?.customisations) ? product.customisations : [];
  return lines
    .map((line) => ({ label: String(line?.label || 'Customisation'), amount: num(line?.amount) }))
    .filter((line) => line.amount !== 0 || line.label !== 'Customisation');
}

export function customisationTotal(product) {
  return round2(customisationLines(product).reduce((t, l) => t + l.amount, 0));
}

/** Add the stack up. Falls back to the flat `cost` when no breakdown was imported. */
export function costStack(product, { reclaimImportVat = false } = {}) {
  const custom = customisationLines(product);
  const customTotal = round2(custom.reduce((t, l) => t + l.amount, 0));
  const b = product?.breakdown;

  if (!b) {
    // A product with only a total still gets its customisations broken out, since
    // that is the part being decided rather than inherited.
    const flat = round2(num(product?.cost) - customTotal);
    return {
      hasBreakdown: false,
      fob: flat,
      importCosts: 0,
      importVat: 0,
      baseLanded: flat,
      customisations: custom,
      customisationTotal: customTotal,
      landed: round2(flat + customTotal),
      lines: {},
    };
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

  const baseLanded = round2(fob + importCosts - recovered);

  return {
    hasBreakdown: true,
    lines,
    fob,
    importCosts,
    importVat: lines.importVat,
    recovered,
    baseLanded,
    customisations: custom,
    customisationTotal: customTotal,
    landed: round2(baseLanded + customTotal),
    landedWithVat: round2(fob + importCosts + customTotal),
  };
}

/**
 * Price a made-to-order product: unit cost, a markup on it, and the resulting
 * sale price with and without VAT.
 *
 * Markup is on cost (cost x 1.8), which is how a quote for custom work is put
 * together. The margin it implies is returned alongside, because that is what the
 * quotation screen judges a discount against.
 */
export function priceFromMarkup({ cost = 0, markup = 0, vatRate = 0, rounding = 0, commissionRate = 0 }) {
  const unitCost = num(cost);
  const net = unitCost * (1 + num(markup));
  // Round the VAT-inclusive price, since that is the number the customer sees.
  const gross = roundTo(net * (1 + num(vatRate)), num(rounding));
  const netFromGross = gross / (1 + num(vatRate));
  const commission = netFromGross * clampFraction(commissionRate);
  const profit = round2(netFromGross - unitCost - commission);

  return {
    unitCost: round2(unitCost),
    net: round2(netFromGross),
    gross: round2(gross),
    vat: round2(gross - netFromGross),
    commission: round2(commission),
    profit,
    margin: netFromGross ? profit / netFromGross : 0,
    markupApplied: unitCost ? profit / unitCost : 0,
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
