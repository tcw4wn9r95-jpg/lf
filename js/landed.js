/*
 * Where a custom order actually lands, and who pays for what on the way.
 *
 * A catalogue product has one answer baked into its breakdown: made in Spain or
 * China, imported to the UK, DDP, all costs ours. A made-to-order job does not.
 * The club might be in Ireland, the goods might ship straight from the factory,
 * and the incoterm decides whether duty is our problem or theirs.
 *
 * So this module holds two things the cost stack cannot work out on its own:
 * which cost lines an incoterm makes us bear, and what a destination charges on
 * cycling apparel. Everything here is a starting point a freight agent would
 * recognise — not a customs ruling. The figures it produces stay editable, and
 * the ones it is unsure about say so.
 */

/* --------------------------------------------------------------- incoterms */

/*
 * Incoterms 2020, in the order a quote escalates through them. `bears` lists the
 * cost lines the seller carries — everything else falls to the buyer, and simply
 * does not belong in our unit cost.
 *
 * FOB is the default for custom work: goods leave the factory, the club's own
 * forwarder takes them from there, and we are not fronting duty on a one-off run.
 */
export const INCOTERMS = [
  {
    code: 'EXW',
    name: 'Ex Works',
    bears: ['manufacture', 'packaging'],
    summary: 'Buyer collects at the factory. We bear only what it costs to make.',
  },
  {
    code: 'FOB',
    name: 'Free On Board',
    bears: ['manufacture', 'packaging'],
    summary: 'Ours to the port of departure. Freight, duty and import VAT are the buyer’s.',
  },
  {
    code: 'CIF',
    name: 'Cost, Insurance & Freight',
    bears: ['manufacture', 'packaging', 'freightIn', 'insurance'],
    summary: 'We pay the freight and cover the goods. The buyer clears customs and pays duty.',
  },
  {
    code: 'DAP',
    name: 'Delivered At Place',
    bears: ['manufacture', 'packaging', 'freightIn', 'insurance', 'freightOut'],
    summary: 'Delivered to their door, duty unpaid. The buyer is importer of record.',
  },
  {
    code: 'DDP',
    name: 'Delivered Duty Paid',
    bears: ['manufacture', 'packaging', 'freightIn', 'insurance', 'freightOut', 'brokerage', 'duty', 'importVat'],
    summary: 'Everything ours, to their door, cleared. Simplest for them, dearest for us.',
  },
];

export const DEFAULT_INCOTERM = 'FOB';

export function incoterm(code) {
  return INCOTERMS.find((i) => i.code === String(code || '').toUpperCase()) || INCOTERMS.find((i) => i.code === DEFAULT_INCOTERM);
}

/** Does this incoterm put the given cost line on us? */
export function bears(code, key) {
  return incoterm(code).bears.includes(key);
}

/* --------------------------------------------------------------- countries */

/*
 * The destinations a British cycling club or distributor actually orders from,
 * with what they charge on garments landing there.
 *
 * `duty` is the MFN ad-valorem rate on cycling apparel (HS 61/62) as a fraction,
 * `vat` the standard rate charged at import. `sure: false` marks the ones where a
 * single number genuinely cannot be right — the United States prices apparel by
 * fibre and construction across a 0–32% spread, Switzerland charges by the
 * kilogram rather than by value — and the app says so rather than inventing
 * confidence. Those are the cases worth asking Claude or a broker about.
 */
export const COUNTRIES = [
  { code: 'GB', name: 'United Kingdom', vat: 0.2, duty: 0.12, bloc: 'UK', sure: true },
  { code: 'IE', name: 'Ireland', vat: 0.23, duty: 0.12, bloc: 'EU', sure: true },
  { code: 'ES', name: 'Spain', vat: 0.21, duty: 0.12, bloc: 'EU', sure: true },
  { code: 'FR', name: 'France', vat: 0.2, duty: 0.12, bloc: 'EU', sure: true },
  { code: 'DE', name: 'Germany', vat: 0.19, duty: 0.12, bloc: 'EU', sure: true },
  { code: 'IT', name: 'Italy', vat: 0.22, duty: 0.12, bloc: 'EU', sure: true },
  { code: 'NL', name: 'Netherlands', vat: 0.21, duty: 0.12, bloc: 'EU', sure: true },
  { code: 'BE', name: 'Belgium', vat: 0.21, duty: 0.12, bloc: 'EU', sure: true },
  { code: 'LU', name: 'Luxembourg', vat: 0.17, duty: 0.12, bloc: 'EU', sure: true },
  { code: 'PT', name: 'Portugal', vat: 0.23, duty: 0.12, bloc: 'EU', sure: true },
  { code: 'AT', name: 'Austria', vat: 0.2, duty: 0.12, bloc: 'EU', sure: true },
  { code: 'DK', name: 'Denmark', vat: 0.25, duty: 0.12, bloc: 'EU', sure: true },
  { code: 'SE', name: 'Sweden', vat: 0.25, duty: 0.12, bloc: 'EU', sure: true },
  { code: 'FI', name: 'Finland', vat: 0.255, duty: 0.12, bloc: 'EU', sure: true },
  { code: 'PL', name: 'Poland', vat: 0.23, duty: 0.12, bloc: 'EU', sure: true },
  { code: 'CZ', name: 'Czechia', vat: 0.21, duty: 0.12, bloc: 'EU', sure: true },
  { code: 'GR', name: 'Greece', vat: 0.24, duty: 0.12, bloc: 'EU', sure: true },
  { code: 'CH', name: 'Switzerland', vat: 0.081, duty: null, bloc: 'EFTA', sure: false,
    note: 'Swiss duty is charged by weight, not value — a garment rate needs the shipment’s kilos.' },
  { code: 'NO', name: 'Norway', vat: 0.25, duty: 0.107, bloc: 'EFTA', sure: false,
    note: 'EEA-origin garments enter free; Chinese-made ones do not.' },
  { code: 'US', name: 'United States', vat: 0, duty: null, bloc: 'US', sure: false,
    note: 'US apparel duty runs 0–32% on fibre and construction. Sales tax is the buyer’s, not an import charge.' },
  { code: 'CA', name: 'Canada', vat: 0.05, duty: 0.18, bloc: 'CA', sure: false,
    note: 'GST only; provincial tax is charged on top and varies.' },
  { code: 'AU', name: 'Australia', vat: 0.1, duty: 0.05, bloc: 'AU', sure: true },
  { code: 'NZ', name: 'New Zealand', vat: 0.15, duty: 0, bloc: 'NZ', sure: false },
  { code: 'JP', name: 'Japan', vat: 0.1, duty: 0.09, bloc: 'JP', sure: false },
  { code: 'AE', name: 'United Arab Emirates', vat: 0.05, duty: 0.05, bloc: 'GCC', sure: true },
  { code: 'SG', name: 'Singapore', vat: 0.09, duty: 0, bloc: 'SG', sure: true },
  { code: 'CN', name: 'China', vat: 0.13, duty: null, bloc: 'CN', sure: false },
];

export const DEFAULT_DESTINATION = 'GB';

export function country(code) {
  return COUNTRIES.find((c) => c.code === String(code || '').toUpperCase()) || null;
}

/** The country a manufacturer ships from, as a code. */
export const MAKER_COUNTRY = { engobe: 'ES', sobike: 'CN' };

export function originCode(product) {
  return MAKER_COUNTRY[String(product?.maker || '').trim().toLowerCase()] || null;
}

/* ------------------------------------------------------------- duty rules */

/**
 * What the destination will charge on a garment arriving from this origin.
 *
 * Three things decide it, in this order: goods that never cross a customs border
 * are not imports at all; goods moving inside the EU are not either; and the
 * UK–EU agreement zero-rates the duty only when the garment itself originates in
 * the party it is shipped from. That last one is the trap — a Chinese-made jersey
 * warehoused in Spain is not Spanish for customs, and pays the full rate.
 */
export function dutyTreatment({ origin, destination }) {
  const from = country(origin);
  const to = country(destination);
  if (!to) return { rate: null, vat: null, kind: 'unknown', sure: false, note: 'Unknown destination.' };

  if (from && from.code === to.code) {
    // Nothing is imported, so nothing is charged at the border. The destination's
    // VAT is a matter for the quotation's own rate, not for the cost of the unit.
    return {
      rate: 0,
      vat: 0,
      kind: 'domestic',
      sure: true,
      note:
        `Made and sold in ${to.name}. No border, so no duty and no import VAT. ` +
        `Set the quotation's VAT to ${to.name}'s ${(to.vat * 100).toFixed(0)}% — it is charged on the sale instead.`,
    };
  }

  if (from && from.bloc === 'EU' && to.bloc === 'EU') {
    return {
      rate: 0,
      vat: 0,
      kind: 'intra-eu',
      sure: true,
      note: `${from.name} to ${to.name} stays inside the single market. No customs entry, no duty, no import VAT — a VAT-registered buyer accounts for it under reverse charge.`,
    };
  }

  const tcaPair = from && ((from.bloc === 'EU' && to.bloc === 'UK') || (from.bloc === 'UK' && to.bloc === 'EU'));
  if (tcaPair) {
    return {
      rate: 0,
      vat: to.vat,
      kind: 'tca',
      sure: false,
      preferential: true,
      note:
        `The UK–EU agreement zero-rates the duty, but only on proof the garment originates in ${from.name}. ` +
        'Goods merely shipped from there — Chinese-made stock, say — pay the full 12%. Get a statement on origin from the maker.',
    };
  }

  if (to.duty === null) {
    return { rate: null, vat: to.vat, kind: 'mfn', sure: false, note: to.note || `${to.name} needs a broker’s rate for this garment.` };
  }

  return {
    rate: to.duty,
    vat: to.vat,
    kind: 'mfn',
    sure: to.sure,
    note: to.note || `Standard ${to.name} rate on cycling apparel, no trade preference from ${from ? from.name : 'this origin'}.`,
  };
}

/* ------------------------------------------------------------------ terms */

/**
 * The full set of assumptions a custom product is costed under. Stored alongside
 * its figures so a quote can be reopened months later and still add up the same
 * way, whatever the rules have done in the meantime.
 */
export function defaultTerms({ product, incoterm: code = DEFAULT_INCOTERM, destination = DEFAULT_DESTINATION } = {}) {
  const origin = originCode(product);
  const treatment = dutyTreatment({ origin, destination });
  return {
    incoterm: code,
    destination,
    origin,
    dutyRate: treatment.rate,
    vatRate: treatment.vat,
    /* Freight is carried over from the base product until something better is
       known: it moves with weight and lane, not with value, so a customisation
       does not change it but a new destination certainly does. */
    freightIn: null,
    freightOut: null,
    insuranceRate: null,
    source: 'rules',
    confidence: treatment.sure ? 'high' : 'low',
    note: treatment.note,
    kind: treatment.kind,
    at: null,
  };
}
