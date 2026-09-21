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

import { bears as bearsLine, country } from './landed.js';

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
  const basis = costBasis(quote);

  const lines = (quote.lines || []).map((line) => {
    const qty = Math.max(0, num(line.qty));
    const cost = lineCost(line, basis);
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
      costBasis: basis,
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
  const goodsGross = sum('grossTotal');
  const goodsNet = sum('netTotal');

  // Getting the order to the customer and through customs is a cost of the
  // order, not of any one garment, so it lands here rather than in a line.
  // The reclaim setting is copied onto the quote the way the VAT rate and the
  // margin floor are, so a saved quotation still adds up the way it was quoted.
  const log = logisticsOf(quote, { reclaimImportVat: Boolean(quote.reclaimImportVat) });
  // Charged on, it is revenue like anything else and carries VAT at the same
  // rate; absorbed, it only ever comes off the profit.
  const chargeNet = log.chargeToCustomer ? round2(log.charge) : 0;
  const chargeGross = round2(chargeNet * (1 + vatRate));

  const grossTotal = round2(goodsGross + chargeGross);
  const netTotal = round2(goodsNet + chargeNet);
  const vat = round2(grossTotal - netTotal);
  const costTotal = sum('costTotal');
  const commission = sum('commission');
  const profit = round2(netTotal - costTotal - commission - log.cost);

  return {
    lines,
    units: lines.reduce((t, l) => t + l.qty, 0),
    listGrossSubtotal,
    discountValue: round2(listGrossSubtotal - goodsGross),
    goodsGross,
    grossTotal,
    subtotal: netTotal,
    vat,
    vatRate,
    total: grossTotal,
    costTotal,
    commission,
    costBasis: basis,
    logistics: log,
    logisticsCost: log.cost,
    logisticsCharge: chargeNet,
    logisticsChargeGross: chargeGross,
    profit,
    margin: netTotal ? profit / netTotal : 0,
    markupOnCost: costTotal ? profit / costTotal : 0,
  };
}

/**
 * Which cost a quotation should be charging its lines at.
 *
 * Goods leaving our own stock have already been brought in and cleared, so the
 * freight and duty on that inbound leg are sunk into them and belong in the
 * line. Goods going straight from the factory to the customer have had none of
 * that spent on them yet — their cost is what the factory charges at its door,
 * and the whole journey is priced once, on the order, where the real weight is.
 *
 * Quoting the landed cost AND adding order shipping would charge the freight
 * twice; quoting EXW out of stock would forget it entirely.
 */
export function costBasis(quote) {
  return (quote?.shipsFrom || 'GB') === 'GB' ? 'landed' : 'exw';
}

export const COST_BASIS_LABEL = {
  landed: 'Landed into the UK — the inbound freight and duty are already in it',
  exw: 'Ex works — the factory door, with the journey priced on the order',
};

/** One line's cost on the given basis, falling back for quotes saved before it existed. */
export function lineCost(line, basis = 'landed') {
  const exw = num(line?.exw);
  const landed = num(line?.landed);
  if (basis === 'exw' && exw > 0) return exw;
  if (landed > 0) return landed;
  return num(line?.cost);
}

/**
 * The shipping and customs sitting on a quotation, reduced to the two numbers
 * the maths needs: what it costs us, and what we pass on.
 *
 * Import VAT is input tax the same way it is on a product — reclaimable when
 * VAT-registered — so it is separated out rather than buried in the total.
 */
export function logisticsOf(quote, { reclaimImportVat = false } = {}) {
  const l = quote?.logistics || null;
  const shipping = round2(num(l?.shipping?.amount));
  const duty = round2(num(l?.customs?.duty));
  const importVat = round2(num(l?.customs?.importVat));
  const otherTaxes = round2(num(l?.customs?.otherTaxes));
  const brokerage = round2(num(l?.customs?.brokerage));

  const customs = round2(duty + otherTaxes + brokerage + (reclaimImportVat ? 0 : importVat));
  const cost = round2(shipping + customs);
  // An unset charge means "pass it on at cost"; num() would read that as zero,
  // which is the one answer that is never meant.
  const asked = l?.chargeAmount;
  const unset = asked === null || asked === undefined || asked === '';
  const charge = l?.chargeToCustomer ? round2(unset ? cost : num(asked)) : 0;

  return {
    shipping,
    duty,
    importVat,
    otherTaxes,
    brokerage,
    customs,
    cost,
    charge,
    chargeToCustomer: Boolean(l?.chargeToCustomer),
    hasEstimate: Boolean(l?.shipping?.amount || l?.customs?.duty || l?.customs?.brokerage),
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

/* Rates worth one tap: zero-rated exports, the UK standard rate, the Spanish one. */
export const VAT_PRESETS = [
  { value: 0, label: 'None' },
  { value: 0.2, label: 'UK 20%' },
  { value: 0.21, label: 'ES 21%' },
];

export const PRICE_DISPLAY = {
  both: 'Both, excl. and incl. VAT',
  excl: 'Excluding VAT',
  incl: 'Including VAT',
};

/** Wording suggested for a rate, editable and only used when the note is empty. */
export function suggestedVatNote(vatRate, company) {
  if (!vatRate) {
    // "Reverse charge" is the wording for services, not for goods leaving the
    // country — the Shipping & VAT panel writes the precise line for the route.
    return 'No UK VAT is charged on this supply. Any import duty and local VAT on arrival are the importer’s.';
  }
  const number = company?.vatNumber ? ` VAT ${company.vatNumber}.` : '';
  return `Prices are shown excluding and including VAT at ${(vatRate * 100).toFixed(0)}%.${number}`;
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
  { key: 'freightIn', label: 'Inbound freight', group: 'logistics' },
  { key: 'freightOut', label: 'Onward delivery', group: 'logistics' },
  { key: 'insurance', label: 'Insurance', group: 'logistics' },
  { key: 'brokerage', label: 'Customs clearance', group: 'logistics' },
  { key: 'duty', label: 'Duty', group: 'logistics' },
  { key: 'importVat', label: 'Import VAT', group: 'logistics' },
];

/* Where each manufacturer ships from. Goods land in the UK either way. */
export const ORIGINS = {
  engobe: 'Spain',
  sobike: 'China',
};

export const DESTINATION = 'UK';

/** The country a product is made in, from its manufacturer. Null when unknown. */
export function productOrigin(product) {
  return ORIGINS[String(product?.maker || '').trim().toLowerCase()] || null;
}

/**
 * Label a cost line for a specific product, so the freight legs name the route
 * actually taken rather than one generic to the catalogue.
 */
export function costLineLabel(key, product, terms = null) {
  const meta = COST_LINES.find((c) => c.key === key);
  if (!meta) return key;

  // A custom job can be going anywhere, so the leg is named from its own terms
  // when it has them and from the catalogue's UK route when it does not.
  const to = terms?.destination ? country(terms.destination)?.name || DESTINATION : DESTINATION;

  if (key === 'freightIn') {
    const origin = productOrigin(product);
    return origin ? `Transport ${origin} → ${to}` : `Transport to ${to}`;
  }
  if (key === 'freightOut') return `Delivery within ${to}`;
  return meta.label;
}

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

/**
 * The rates the imported breakdown was actually built at, recovered from its own
 * numbers rather than assumed.
 *
 * The financial model charges insurance and duty on FOB and import VAT on
 * everything landed before it, at rates that hold to two decimals across all
 * thirty-one products. Reading them back out means a customised unit re-prices
 * the import lines the way the sheet would have, instead of inheriting figures
 * that were only ever right for the plain garment.
 */
export function impliedRates(b) {
  const fob = num(b?.manufacture) + num(b?.packaging);
  const vatBase = fob + num(b?.freightIn) + num(b?.insurance) + num(b?.duty);
  return {
    insurance: fob ? num(b?.insurance) / fob : 0,
    duty: fob ? num(b?.duty) / fob : 0,
    importVat: vatBase ? num(b?.importVat) / vatBase : 0,
    basis: 'fob',
  };
}

/**
 * Add the stack up. Falls back to the flat `cost` when no breakdown was imported.
 *
 * Customisation is part of making the garment, not something that happens to it
 * afterwards: the artwork is sublimated at the factory and the pad is sewn in
 * there, so it is inside the FOB value the customs declaration is based on. That
 * means insurance, duty and import VAT all rise with it — which is the whole
 * reason to show the stack rather than a single inherited number.
 *
 * What it then costs to move and to clear is NOT here. That depends on where the
 * order is going and on whose terms, which are properties of a quotation and not
 * of a product — a jersey does not know whether it is going to Dublin or Denver.
 * The stack below the FOB line is the route this business already runs, kept as
 * the reference it has always been: what it costs to land one in the UK.
 */
export function costStack(product, { reclaimImportVat = false } = {}) {
  const custom = customisationLines(product);
  const customTotal = round2(custom.reduce((t, l) => t + l.amount, 0));
  const b = product?.breakdown;

  if (!b) {
    const flat = round2(num(product?.cost) - customTotal);
    return {
      hasBreakdown: false,
      exw: round2(flat + customTotal),
      fob: round2(flat + customTotal),
      production: round2(flat + customTotal),
      importCosts: 0,
      importVat: 0,
      baseLanded: flat,
      customisations: custom,
      customisationTotal: customTotal,
      customisationLanded: customTotal,
      landed: round2(flat + customTotal),
      lines: {},
    };
  }

  const build = (extras) => {
    const raw = {};
    COST_LINES.forEach(({ key }) => {
      raw[key] = num(b[key]);
    });

    const rates = impliedRates(b);
    const fob = round2(raw.manufacture + raw.packaging + extras);

    // Nothing has changed about this unit, so trust the imported numbers rather
    // than recomputing them from rates read back out and landing a penny away.
    const untouched = !extras;
    const lines = { ...raw };

    if (!untouched) {
      lines.insurance = round2(fob * rates.insurance);
      lines.duty = round2(fob * rates.duty);
      lines.importVat = round2((fob + lines.freightIn + lines.insurance + lines.duty) * rates.importVat);
    }

    // Onward delivery is deliberately NOT here. Getting a garment from our own
    // door to a customer is a cost of the order, priced on the order, where the
    // real weight and destination are — leaving it in the unit cost means the
    // quotation pays for the same leg twice.
    const importCosts = round2(
      lines.freightIn + lines.insurance + lines.brokerage + lines.duty + lines.importVat,
    );
    // Import VAT is input tax: a VAT-registered company reclaims it, so it is a
    // cash timing cost rather than a cost of goods. Off by default to match the sheet.
    const recovered = reclaimImportVat ? lines.importVat : 0;

    const landed = round2(fob + importCosts - recovered);
    return {
      lines,
      fob,
      importCosts,
      importVat: lines.importVat,
      recovered,
      /* What a unit costs sitting on our own shelf, cleared and paid for. */
      landed,
      onwardDelivery: lines.freightOut,
      /* The model's original figure, delivery included, kept for comparison. */
      deliveredUk: round2(landed + lines.freightOut),
    };
  };

  const full = build(customTotal);
  const plain = build(0);

  return {
    hasBreakdown: true,
    ...full,
    /* What the factory charges at its own door — the only cost that travels with
       the garment regardless of where it is going. Everything below this line
       depends on a route, and a route is a property of an order, not a product. */
    exw: full.fob,
    production: full.fob,
    customisations: custom,
    customisationTotal: customTotal,
    baseLanded: plain.landed,
    customisationLanded: round2(full.landed - plain.landed),
    landedWithVat: round2(full.fob + full.importCosts),
  };
}

/**
 * Price a made-to-order product: unit cost, a markup on it, and the resulting
 * sale price with and without VAT.
 *
 * Markup is on cost (cost x 1.8), which is how a quote for custom work is put
 * together. The margin it implies is returned alongside, because that is what the
 * quotation screen judges a discount against.
 *
 * The price is settled EXCLUDING VAT — that is the number being decided, and the
 * one rounded to something tidy. VAT is added to it afterwards, so the net price
 * stays clean rather than being whatever falls out of a rounded gross.
 */
export function priceFromMarkup({ cost = 0, markup = 0, vatRate = 0, rounding = 0, commissionRate = 0 }) {
  const unitCost = num(cost);
  const net = roundTo(unitCost * (1 + num(markup)), num(rounding));
  const gross = round2(net * (1 + num(vatRate)));
  const commission = net * clampFraction(commissionRate);
  const profit = round2(net - unitCost - commission);

  return {
    unitCost: round2(unitCost),
    net: round2(net),
    gross,
    vat: round2(gross - net),
    commission: round2(commission),
    profit,
    margin: net ? profit / net : 0,
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
