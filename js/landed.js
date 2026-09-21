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

/* --------------------------------------------------- selling across a border */

/*
 * What VAT a quotation should actually carry.
 *
 * Landed cost is about getting goods to the customer. This is the other half:
 * whether La Fuga charges UK VAT on the sale at all. Three facts decide it — who
 * the customer is, where the goods physically travel, and which incoterm was
 * quoted — and the app gets all three wrong by default if nobody asks.
 *
 * The rules below are the ordinary ones for a UK VAT-registered seller of goods.
 * They are a prompt, not advice: exports turn on holding evidence, DDP can
 * create obligations abroad, and Northern Ireland has its own regime. Anything
 * unusual belongs with an accountant before it goes out.
 */
export const SELLER_COUNTRY = 'GB';

export function supplyTreatment({
  clientCountry,
  goodsFrom = null,
  incoterm: code = null,
  clientVatNumber = '',
  domesticRate = 0.2,
} = {}) {
  const to = country(clientCountry);
  const from = country(goodsFrom);
  const warnings = [];

  if (!to) {
    return {
      rate: domesticRate,
      kind: 'unknown',
      label: 'Domestic supply',
      note: null,
      warnings: ['No country on the client, so this is being quoted as a UK sale at the standard rate.'],
    };
  }

  // Goods that never enter the UK are not a UK export, whatever the invoice says.
  const neverInUk = from && from.code !== SELLER_COUNTRY && to.code !== SELLER_COUNTRY;

  if (to.code === SELLER_COUNTRY) {
    if (from && from.code !== SELLER_COUNTRY) {
      // Imported first, then sold here: ordinary domestic supply once it lands.
      return {
        rate: domesticRate,
        kind: 'domestic',
        label: 'UK supply',
        note: null,
        warnings,
      };
    }
    return { rate: domesticRate, kind: 'domestic', label: 'UK supply', note: null, warnings };
  }

  if (neverInUk) {
    warnings.push(
      `These goods travel ${from.name} to ${to.name} without entering the UK, so this is not a UK export. ` +
        `The supply falls under ${from.code === to.code ? to.name : `${from.name}/${to.name}`} rules and may need a VAT registration there. Check before sending.`,
    );
  }

  if (code === 'DDP') {
    warnings.push(
      `Quoting DDP makes you importer of record in ${to.name}. That can oblige you to register for VAT there and reclaim the import VAT locally — confirm it before committing to the price.`,
    );
  }

  if (to.bloc === 'EU' && !String(clientVatNumber || '').trim()) {
    warnings.push(`For a business customer in ${to.name}, their VAT number belongs on the document.`);
  }

  if (!neverInUk) {
    warnings.push('Zero-rating an export depends on holding proof the goods left the UK — usually within three months of supply.');
  }

  // Plain words, not an arrow: this string is printed by the PDF, whose subsetted
  // typeface has no glyph for one.
  const note = neverInUk
    ? `Supplied from ${from.name} to ${to.name}. No UK VAT is charged. Import duty and ${to.vat ? `${to.name} VAT` : 'local taxes'} on arrival are the importer's.`
    : `Zero-rated export of goods to ${to.name}. No UK VAT is charged. ` +
      `Import duty and ${to.vat ? `${to.name} VAT at ${(to.vat * 100).toFixed(0)}%` : 'local taxes'} on arrival are payable by the importer of record.`;

  return {
    rate: 0,
    kind: neverInUk ? 'outside-scope' : 'export',
    // Goods that never touch the UK are not a UK export, and saying so would
    // paper over exactly the thing worth noticing.
    label: neverInUk ? `Outside UK VAT — ${from.name} to ${to.name}` : `Export to ${to.name}`,
    note,
    warnings,
  };
}

/* ----------------------------------------------------------------- carriers */

/*
 * Who might actually move the boxes. Express integrators first, because a club
 * order of a few hundred garments goes on a pallet or in cartons, not in a
 * container — then the freight options for when it really is a container.
 */
export const CARRIERS = [
  { value: 'fedex', label: 'FedEx' },
  { value: 'dhl', label: 'DHL Express' },
  { value: 'ups', label: 'UPS' },
  { value: 'tnt', label: 'TNT' },
  { value: 'dpd', label: 'DPD' },
  { value: 'gls', label: 'GLS' },
  { value: 'parcelforce', label: 'Parcelforce / Royal Mail' },
  { value: 'evri', label: 'Evri' },
  { value: 'air-freight', label: 'Air freight — forwarder' },
  { value: 'sea-freight', label: 'Sea freight — forwarder' },
  { value: 'road-freight', label: 'Road freight — forwarder' },
  { value: 'other', label: 'Other / not decided' },
];

export function carrierLabel(value) {
  return CARRIERS.find((c) => c.value === value)?.label || 'a carrier';
}

/*
 * Packed weight of one garment, in kilograms, by catalogue category.
 *
 * Cycling kit is light and compressible, and nobody records a weight against a
 * product, so a shipping quote has to start from somewhere. These are folded,
 * poly-bagged weights for a mid-size garment — close enough to size a carton,
 * and every one of them is editable before it goes anywhere near a carrier.
 */
export const PACKED_WEIGHTS = {
  'jersey-m': 0.18,
  'jersey-w': 0.17,
  'bib-m': 0.22,
  'bib-w': 0.21,
  gilet: 0.14,
  baselayer: 0.12,
  jacket: 0.38,
  accessories: 0.08,
};

const FALLBACK_WEIGHT = 0.2;
/* Garments to a carton, and what the empty carton itself weighs. */
const PER_CARTON = 40;
const CARTON_TARE = 0.45;

/** One product's packed weight, following a custom product back to its base. */
export function unitWeight(product, lookup = null) {
  if (!product) return FALLBACK_WEIGHT;
  const direct = PACKED_WEIGHTS[product.category];
  if (direct) return direct;
  // A custom product sits in the Custom category and carries no weight of its
  // own, so it borrows the garment it was built on.
  if (product.basedOn && lookup) {
    const base = lookup(product.basedOn);
    if (base) return PACKED_WEIGHTS[base.category] || FALLBACK_WEIGHT;
  }
  return FALLBACK_WEIGHT;
}

/**
 * What the whole shipment weighs and how many cartons it fills — the two
 * numbers any carrier asks for first.
 */
export function shipmentSize(lines, resolve) {
  let units = 0;
  let goods = 0;
  lines.forEach((line) => {
    const qty = Math.max(0, Number(line.qty) || 0);
    units += qty;
    goods += qty * unitWeight(resolve(line.productId), resolve);
  });
  const cartons = units ? Math.max(1, Math.ceil(units / PER_CARTON)) : 0;
  return {
    units,
    cartons,
    goodsKg: Math.round(goods * 100) / 100,
    grossKg: Math.round((goods + cartons * CARTON_TARE) * 100) / 100,
  };
}
