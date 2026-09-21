/*
 * Asking Claude what a shipment will actually cost to land.
 *
 * The rules table in landed.js is good for the lanes this business already runs
 * — Spain or China into the UK and the EU. It is honestly useless for a club in
 * Denver asking for eighty bibs, because US apparel duty depends on knit versus
 * woven, the fibre split, and whether the garment has a chamois. That is a
 * research question, not a lookup, so it goes to a model.
 *
 * Three things this deliberately does NOT do:
 *   - stand between you and the number. Everything it returns lands in editable
 *     fields with its reasoning attached, so you can overrule any of it.
 *   - pretend to be authoritative. A customs broker signs off entries; this
 *     produces a defensible starting figure and says how sure it is.
 *   - work without you. No key, no calls, and the rest of the app is unaffected.
 *
 * The key lives in this phone's storage next to the cost data, and goes straight
 * to Anthropic from the browser — there is no server in this app to hide it
 * behind. Use a key with a spend limit that you can revoke.
 */

const ENDPOINT = 'https://api.anthropic.com/v1/messages';
const API_VERSION = '2023-06-01';
/* Routes a policy decline onto another model inside the same call. */
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

export const CLAUDE_MODELS = [
  { value: 'claude-opus-5', label: 'Opus — the best answer' },
  { value: 'claude-sonnet-5', label: 'Sonnet — cheaper, quicker' },
];

export const DEFAULT_MODEL = 'claude-opus-5';

/* The shape we want back. Declared as a tool so the model fills fields rather
   than writing prose we then have to pick apart. */
const ESTIMATE_TOOL = {
  name: 'record_landed_estimate',
  description: 'Record the per-unit import costs for this shipment of cycling apparel.',
  input_schema: {
    type: 'object',
    properties: {
      hsCode: { type: 'string', description: 'Most likely HS/commodity code, 6 or 8 digits, e.g. "6112.20".' },
      hsReason: { type: 'string', description: 'One sentence on why that code and not a neighbouring one.' },
      dutyRate: {
        type: 'number',
        description: 'Ad valorem duty as a decimal fraction (0.12 for 12%). Use 0 where a trade agreement or the destination genuinely charges nothing.',
      },
      dutyBasis: { type: 'string', enum: ['cif', 'fob'], description: 'What the destination levies duty on.' },
      importVatRate: {
        type: 'number',
        description: 'Import VAT/GST as a decimal fraction, charged on customs value plus duty. 0 where none is charged at import.',
      },
      insuranceRate: { type: 'number', description: 'Cargo insurance as a decimal fraction of goods value. Typically 0.002–0.01.' },
      freightIn: { type: 'number', description: 'Per-unit freight from the factory to the destination country, in the quote currency.' },
      freightOut: { type: 'number', description: 'Per-unit onward delivery inside the destination country, in the quote currency. 0 if the incoterm stops at the port.' },
      brokerage: { type: 'number', description: 'Per-unit customs clearance and handling, in the quote currency. 0 if none applies.' },
      confidence: { type: 'string', enum: ['high', 'medium', 'low'], description: 'How sure you are. Low is a fine answer.' },
      reasoning: { type: 'string', description: 'Two or three sentences a freight agent would recognise: the classification, the trade treatment, and how the freight was sized.' },
      caveats: {
        type: 'array',
        items: { type: 'string' },
        description: 'Things that would change the answer — rules of origin evidence, de minimis thresholds, weight-based tariffs, anything worth checking before quoting.',
      },
    },
    required: ['dutyRate', 'importVatRate', 'freightIn', 'confidence', 'reasoning'],
    additionalProperties: false,
  },
  strict: true,
};

const SYSTEM = `You are helping a small British cycling apparel company (La Fuga Limited, VAT registered in the UK) cost a made-to-order run of technical cycling kit.

Estimate the per-unit cost of getting the goods from the factory to the customer under the incoterm given. Work like a freight forwarder pricing a job, not like a search engine:

- Classify the garment properly. Cycling kit is mostly knitted man-made fibre: jerseys usually 6110.30 or 6114.30, bib shorts with a chamois 6112.20 or 6114.30, gilets and wind vests 6110.30 or 6113.00 where laminated, caps 6505.00, socks 6115.30. Say which you picked.
- Apply the real trade treatment between origin and destination, including any agreement — and be explicit when a preference depends on rules of origin the seller may not be able to evidence. Goods manufactured in China but shipped from an EU warehouse do NOT get EU preferential origin.
- Size the freight from the actual garment. Cycling kit is light and compressible: a jersey is roughly 150-200g packed, bib shorts 200-250g, a rain jacket 300-400g. Small runs of a few hundred units go air or express, not sea, so per-unit freight is higher than a container rate.
- Where a destination charges duty by weight rather than value, convert it to an equivalent ad valorem rate for the given value and say that is what you have done.
- Put the numbers in the currency you are told to use.

Be accurate rather than reassuring. If the honest answer is a wide range, give the midpoint, set confidence to low, and put the range in the caveats. Never invent a precise rate to look authoritative.`;

/** Everything the model needs about the job, as a compact brief. */
function brief(job) {
  const lines = [
    `Garment: ${job.name}${job.category ? ` (${job.category})` : ''}`,
    job.basedOn ? `Based on our stock product: ${job.basedOn}` : null,
    `Manufactured in: ${job.originName || 'unknown'}${job.maker ? ` (maker: ${job.maker})` : ''}`,
    `Shipping to: ${job.destinationName}`,
    `Incoterm: ${job.incoterm} — ${job.incotermSummary}`,
    `Currency: ${job.currency}`,
    `Quantity: ${job.quantity || 'not yet fixed, assume a club order of 50–150 units'}`,
    '',
    'Per-unit cost so far:',
    `  Manufacture ${job.currency} ${job.manufacture.toFixed(2)}`,
    `  Packaging ${job.currency} ${job.packaging.toFixed(2)}`,
  ];
  (job.customisations || []).forEach((c) => {
    lines.push(`  ${c.label} ${job.currency} ${Number(c.amount).toFixed(2)}  (done at the factory, so inside FOB)`);
  });
  lines.push(`  FOB value per unit: ${job.currency} ${job.fob.toFixed(2)}`);
  if (job.knownFreight) {
    lines.push(
      '',
      `For reference, our existing lane for this product costs ${job.currency} ${job.knownFreight.toFixed(2)} per unit inbound${job.knownRoute ? ` (${job.knownRoute})` : ''}.`,
    );
  }
  lines.push('', 'Give me the per-unit import costs for this job.');
  return lines.filter((l) => l !== null).join('\n');
}

/*
 * One request, made once and shared by every estimator here.
 *
 * Three things are deliberate. Thinking is left alone rather than switched off —
 * classifying a garment and sizing a lane is reasoning work, and the current
 * models think adaptively by default. `max_tokens` is generous because those
 * thinking tokens come out of the same budget and a truncated answer is a wasted
 * call. And the refusal fallback is asked for, but a rejection of that beta is
 * caught and the call retried without it, so an account that does not have it
 * gets an answer instead of an error.
 */
async function ask({ apiKey, model, system, tool, prompt, signal }) {
  if (!apiKey) throw new Error('No API key set. Settings → Claude assist.');

  const send = (withFallback) => {
    const headers = {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': API_VERSION,
      // Without this the browser call is refused outright. It is an
      // acknowledgement that the key is sitting on this device.
      'anthropic-dangerous-direct-browser-access': 'true',
    };
    const body = {
      model,
      max_tokens: 16000,
      system,
      tools: [tool],
      tool_choice: { type: 'tool', name: tool.name },
      messages: [{ role: 'user', content: prompt }],
    };
    if (withFallback) {
      headers['anthropic-beta'] = FALLBACK_BETA;
      body.fallbacks = 'default';
    }
    return fetch(ENDPOINT, { method: 'POST', headers, signal, body: JSON.stringify(body) });
  };

  let res;
  try {
    res = await send(true);
    if (res.status === 400) {
      const text = await res.clone().text();
      // The account may not carry the fallback beta. That is not a reason to
      // fail — ask again plainly.
      if (/beta|fallback/i.test(text)) res = await send(false);
    }
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    throw new Error('Could not reach Anthropic. Check the connection.');
  }

  if (!res.ok) {
    let detail = '';
    try {
      const body = await res.json();
      detail = body?.error?.message || '';
    } catch {
      detail = '';
    }
    if (res.status === 401) throw new Error('That API key was rejected.');
    if (res.status === 429) throw new Error('Rate limited — try again in a moment.');
    if (res.status === 400 && /credit|balance/i.test(detail)) throw new Error('The API account is out of credit.');
    throw new Error(detail || `Anthropic returned ${res.status}.`);
  }

  const body = await res.json();
  if (body.stop_reason === 'refusal') throw new Error('Claude declined this one. Try rewording the job.');
  if (body.stop_reason === 'max_tokens') throw new Error('The answer ran long and was cut off. Try again.');

  const block = (body.content || []).find((c) => c.type === 'tool_use' && c.name === tool.name);
  if (!block) throw new Error('Claude did not return an estimate. Try again.');

  return {
    ...block.input,
    // The fallback may have served this turn, so report what actually answered.
    model: body.model || model,
    at: new Date().toISOString(),
    usage: body.usage || null,
  };
}

/**
 * Ask what it costs to land a unit. Resolves with the tool input; throws with a
 * message written for someone holding a phone, not reading a stack trace.
 */
export async function estimateLanded(job, { apiKey, model = DEFAULT_MODEL, signal } = {}) {
  return ask({ apiKey, model, signal, system: SYSTEM, tool: ESTIMATE_TOOL, prompt: brief(job) });
}

/* --------------------------------------------------------------- shipping */

const SHIPPING_TOOL = {
  name: 'record_shipping_quote',
  description: 'Record what this carrier will charge to move this shipment.',
  input_schema: {
    type: 'object',
    properties: {
      amount: { type: 'number', description: 'Total cost of the shipment in the quote currency, excluding VAT.' },
      service: { type: 'string', description: 'The service level priced, e.g. "International Priority" or "Economy Select".' },
      chargeableKg: { type: 'number', description: 'The chargeable weight the carrier would bill — the greater of actual and volumetric.' },
      transitDays: { type: 'string', description: 'Door-to-door transit, e.g. "2-3 working days".' },
      surcharges: { type: 'string', description: 'Named surcharges folded into the amount — fuel, remote area, residential, peak.' },
      confidence: { type: 'string', enum: ['high', 'medium', 'low'], description: 'How sure you are. Low is a fine answer.' },
      reasoning: { type: 'string', description: 'Two or three sentences: the service, how the chargeable weight was arrived at, and what drives the price on this lane.' },
      caveats: {
        type: 'array',
        items: { type: 'string' },
        description: 'What would move the number — account discounts, dimensions you had to assume, residential delivery, dangerous goods.',
      },
    },
    required: ['amount', 'confidence', 'reasoning'],
    additionalProperties: false,
  },
  strict: true,
};

const SHIPPING_SYSTEM = `You are pricing a shipment for a small British cycling apparel company (La Fuga Limited) sending a made-to-order kit run to a customer.

Quote it the way a freight desk would:

- Price the named carrier's realistic published rate for the lane, at list, then say in the caveats what a negotiated account typically takes off it. Small shippers on an account usually see 30-50% off express list rates, so an unqualified list price flatters the cost.
- Cycling apparel is low density. Work out the volumetric weight as well as the actual weight and bill whichever is greater — express carriers divide by 5000 for cm/kg. Cartons of folded kit typically run 0.10-0.14 kg per litre, so volumetric usually wins on express.
- Fold in the surcharges that actually appear on the invoice: fuel (a percentage that moves), remote area, residential delivery, and peak season where it applies. Name them.
- For a forwarder rather than an integrator, price the mode honestly: air freight has a minimum chargeable weight and airport-to-airport pricing plus handling at both ends; sea freight is LCL by cubic metre with a minimum, and is not worth it below a few cubic metres.
- Transit time is part of the quote. Say it.

Be accurate rather than reassuring. A wide range means the midpoint, confidence low, and the range in the caveats. Never invent a precise figure to look authoritative, and never quote a rate you would not defend to the person paying it.`;

function shippingBrief(job) {
  const lines = [
    `Carrier: ${job.carrierLabel}`,
    `From: ${job.originPostcode || 'not given'}${job.originCountryName ? `, ${job.originCountryName}` : ''}`,
    `To: ${job.destPostcode || 'not given'}${job.destCountryName ? `, ${job.destCountryName}` : ''}`,
    job.incoterm ? `Incoterm: ${job.incoterm}` : null,
    `Currency: ${job.currency}`,
    '',
    'The shipment:',
    `  ${job.units} garments across ${job.cartons} carton${job.cartons === 1 ? '' : 's'}`,
    `  Goods weight ${job.goodsKg} kg, gross weight with cartons ${job.grossKg} kg`,
    job.dimensions ? `  Carton size given as ${job.dimensions}` : '  Carton size not given — assume a standard apparel carton and say what you assumed.',
    '',
    'What is in it:',
    ...job.items.map((i) => `  ${i.qty} x ${i.name}`),
    '',
    job.declaredValue ? `Declared value of the goods: ${job.currency} ${job.declaredValue.toFixed(2)}.` : null,
    'Price this shipment.',
  ];
  return lines.filter((l) => l !== null).join('\n');
}

/** What a carrier will charge to move the goods on this quotation. */
export async function estimateShipping(job, { apiKey, model = DEFAULT_MODEL, signal } = {}) {
  return ask({ apiKey, model, signal, system: SHIPPING_SYSTEM, tool: SHIPPING_TOOL, prompt: shippingBrief(job) });
}

/* ---------------------------------------------------------------- customs */

const CUSTOMS_TOOL = {
  name: 'record_customs_estimate',
  description: 'Record the duty, import taxes and clearance charges on this shipment.',
  input_schema: {
    type: 'object',
    properties: {
      duty: { type: 'number', description: 'Total customs duty on the whole shipment, in the quote currency.' },
      importVat: { type: 'number', description: 'Total import VAT or GST on the whole shipment. 0 where none is charged at import.' },
      otherTaxes: { type: 'number', description: 'Any other tax on entry — excise, provincial tax, merchandise processing. 0 if none.' },
      brokerage: { type: 'number', description: 'Customs clearance, entry preparation, disbursement and handling fees for the shipment.' },
      dutyRate: { type: 'number', description: 'The effective ad valorem duty rate applied, as a decimal fraction.' },
      importVatRate: { type: 'number', description: 'The import VAT/GST rate applied, as a decimal fraction.' },
      customsValue: { type: 'number', description: 'The value duty was calculated on, in the quote currency.' },
      valuationBasis: { type: 'string', enum: ['cif', 'fob'], description: 'What the destination levies duty on.' },
      hsCodes: {
        type: 'array',
        items: { type: 'string' },
        description: 'The commodity codes used, one per distinct garment type, as "6110.30 — long sleeve jersey".',
      },
      confidence: { type: 'string', enum: ['high', 'medium', 'low'], description: 'How sure you are. Low is a fine answer.' },
      reasoning: { type: 'string', description: 'Two or three sentences: the classification, the trade treatment between origin and destination, and how the customs value was built.' },
      caveats: {
        type: 'array',
        items: { type: 'string' },
        description: 'What would change it — rules of origin evidence, de minimis, fibre composition, whether the buyer can reclaim the import VAT.',
      },
    },
    required: ['duty', 'importVat', 'brokerage', 'confidence', 'reasoning'],
    additionalProperties: false,
  },
  strict: true,
};

const CUSTOMS_SYSTEM = `You are working out what customs will charge on a shipment of technical cycling apparel for a small British company (La Fuga Limited, VAT registered in the UK).

Work it for the whole shipment, not per unit, like a customs broker preparing an entry:

- Classify each distinct garment. Cycling kit is mostly knitted man-made fibre: jerseys usually 6110.30 or 6114.30, bib shorts with a chamois 6112.20 or 6114.30, gilets and wind vests 6110.30 or 6113.00 where laminated, caps 6505.00, socks 6115.30. Say which you used.
- Apply the real trade treatment between the country of origin of the goods and the destination — the country the garments were MADE in, not the country they are shipped from. A Chinese-made jersey sent out of an EU warehouse does not get EU preferential origin, and saying so is part of the job.
- Build the customs value the way the destination does: most of the world levies on CIF, the United States on FOB. State which you used and what went into it.
- Import VAT or GST is charged on the customs value plus the duty. Where the destination charges none at import, return 0 rather than inventing one.
- Include realistic clearance and disbursement fees for the carrier or a broker on that lane.
- Where a destination charges duty by weight rather than value, convert to an equivalent ad valorem rate and say that is what you did.

Be accurate rather than reassuring. A wide range means the midpoint, confidence low, and the range in the caveats. Never invent a precise rate to look authoritative — a broker signs off the entry, not you.`;

function customsBrief(job) {
  const lines = [
    `Goods made in: ${job.originName || 'unknown'}`,
    `Shipping from: ${job.shipsFromName || job.originName || 'unknown'}`,
    `Importing into: ${job.destCountryName}`,
    job.incoterm ? `Incoterm: ${job.incoterm} — ${job.incotermSummary}` : null,
    `Currency: ${job.currency}`,
    '',
    'The shipment:',
    ...job.items.map(
      (i) => `  ${i.qty} x ${i.name}${i.category ? ` (${i.category})` : ''} — ${job.currency} ${i.unitValue.toFixed(2)} each, ${job.currency} ${i.lineValue.toFixed(2)} the line`,
    ),
    '',
    `Declared goods value: ${job.currency} ${job.declaredValue.toFixed(2)}`,
    job.freight ? `Freight on this shipment: ${job.currency} ${job.freight.toFixed(2)}` : null,
    job.insurance ? `Insurance: ${job.currency} ${job.insurance.toFixed(2)}` : null,
    `Gross weight: ${job.grossKg} kg across ${job.cartons} carton${job.cartons === 1 ? '' : 's'}`,
    '',
    'Give me what customs will charge on entry.',
  ];
  return lines.filter((l) => l !== null).join('\n');
}

/** What the border will charge on the goods on this quotation. */
export async function estimateCustoms(job, { apiKey, model = DEFAULT_MODEL, signal } = {}) {
  return ask({ apiKey, model, signal, system: CUSTOMS_SYSTEM, tool: CUSTOMS_TOOL, prompt: customsBrief(job) });
}

/** Fold an estimate into the stored terms, leaving anything it skipped alone. */
export function termsFromEstimate(terms, estimate) {
  const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
  return {
    ...terms,
    dutyRate: n(estimate.dutyRate),
    dutyBasis: estimate.dutyBasis === 'fob' ? 'fob' : 'cif',
    vatRate: n(estimate.importVatRate),
    insuranceRate: n(estimate.insuranceRate),
    freightIn: n(estimate.freightIn),
    freightOut: n(estimate.freightOut),
    brokerage: n(estimate.brokerage),
    hsCode: estimate.hsCode || null,
    source: 'claude',
    model: estimate.model || null,
    confidence: estimate.confidence || 'medium',
    note: estimate.reasoning || '',
    caveats: Array.isArray(estimate.caveats) ? estimate.caveats : [],
    at: estimate.at || new Date().toISOString(),
  };
}
