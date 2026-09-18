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

export const CLAUDE_MODELS = [
  { value: 'claude-sonnet-5', label: 'Sonnet — fast, cheap, plenty for this' },
  { value: 'claude-opus-5', label: 'Opus — slower, for the awkward ones' },
];

export const DEFAULT_MODEL = 'claude-sonnet-5';

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
  },
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

/**
 * Ask for an estimate. Resolves with the tool input; throws with a message
 * written for someone holding a phone, not reading a stack trace.
 */
export async function estimateLanded(job, { apiKey, model = DEFAULT_MODEL, signal } = {}) {
  if (!apiKey) throw new Error('No API key set. Settings → Claude assist.');

  let res;
  try {
    res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': API_VERSION,
        // Without this the browser call is refused outright. It is an
        // acknowledgement that the key is sitting on this device.
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      signal,
      body: JSON.stringify({
        model,
        max_tokens: 2000,
        system: SYSTEM,
        tools: [ESTIMATE_TOOL],
        tool_choice: { type: 'tool', name: ESTIMATE_TOOL.name },
        messages: [{ role: 'user', content: brief(job) }],
      }),
    });
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
  const block = (body.content || []).find((c) => c.type === 'tool_use' && c.name === ESTIMATE_TOOL.name);
  if (!block) throw new Error('Claude did not return an estimate. Try again.');

  return { ...block.input, model, at: new Date().toISOString(), usage: body.usage || null };
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
