# La Fuga — Business

A phone-sized web app for running **La Fuga Cycling Society**: build branded
quotations, keep an eye on unit economics, log sales, and stay ahead of the
statutory filing dates.

It is a static site with no build step, no server and no account. Add it to the
iPhone home screen and it behaves like an app, offline included.

> **Your numbers are not in this repository.** The catalogue here carries product
> names only. Costs, RRPs, quotations and sales are imported once and live in the
> phone's own storage. See [`docs/DATA.md`](docs/DATA.md).

## Getting it on the phone

1. Serve the folder over HTTPS — GitHub Pages from this branch works, as does any
   static host.
2. Open it in Safari on the iPhone.
3. **Share → Add to Home Screen.**
4. Open the app → **Settings → Import** and pick the figures file you were sent.

That import is a one-off. After it, everything works with no signal.

To run it locally: `npx http-server -p 8099 .` then visit
`http://localhost:8099`. Opening `index.html` straight off disk works too, minus
the offline cache (service workers need `http(s)`).

## What it does

### Quotations
Every line is quoted at its retail price — *precio normal*, VAT included, exactly
as the catalogue reads. A £116 jersey is quoted at £116. There is nothing to
choose or configure first; you add products and discount down from there, on the
whole quote or one line at a time.

The landed cost behind each product turns that into a straight answer:

> **You can do this.** 39.4% margin, clear of your 30% floor. £67.69 on the order.

Push further and it says so — *Tight, but not a loss* under your margin floor,
*Do not send this* once the order is underwater — naming the lines that caused it.
Each row reads £116.00 → £87.00 · 25% off · 46% margin with a **thin** or **below
cost** tag. Open a line and it gives you the number to negotiate with: *most you
can give at your 30% floor is 43%, break-even at 60%.*

### Selling across a border
The client's **country** is not decoration — it decides whether UK VAT belongs on
the quotation at all. Set it, say where the goods physically leave from, and pick
the incoterm, and **Shipping & VAT** works out the treatment and offers to apply
it in one tap:

> **Outside UK VAT — Spain to Ireland.** No UK VAT applies, but this quotation is
> set to 20%.
>
> · These goods travel Spain to Ireland without entering the UK, so this is not a
> UK export. The supply falls under Spain/Ireland rules and may need a VAT
> registration there.
> · Quoting DDP makes you importer of record in Ireland. That can oblige you to
> register for VAT there.
> · For a business customer in Ireland, their VAT number belongs on the document.

It also catches what quietly costs money: goods made abroad, cleared into the UK
and then sent straight back out pay duty on **both** sides of the same journey,
which shipping direct or customs warehousing avoids. And import VAT counted as a
cost of goods by a VAT-registered business understates every margin in the app —
it says so, and points at the switch. The PDF then carries what a cross-border
document needs — delivery terms in Incoterms 2020 form, the customer's VAT
number, the destination country in the address, and the EORI in the footer.

It is a prompt, not advice. Exports turn on holding proof the goods left the UK,
DDP can create obligations abroad, and Northern Ireland has its own regime —
anything unusual is worth an accountant's eye first.

**VAT is yours to set per quotation.** Tap *None*, *UK 20%* or *ES 21%* (or type a
rate), choose how the quotation reads — both bases, excluding VAT, or including —
and write the note that prints under the totals. Leave the note empty and one is
suggested from the rate: a reverse-charge line at 0%, the rate and your VAT number
otherwise.

The totals column always runs straight down in whichever basis the table is
written in — retail value, discount, net of VAT, VAT, total — so the figures tie
without arithmetic. In *both* mode each line carries the VAT-inclusive price
quietly beneath the excluding one. At 0% the VAT rows disappear entirely.
Quotations written before this existed reprint exactly as they were sent.

### Keeping figures current
Import a CSV (the Files app reaches Google Drive directly), or point the app at a
Google Sheet published as CSV and let it pull changes in on its own. The sheet has
to be *published to web* for a browser to read it at all, which makes it public to
anyone with the link — so publish a small sheet of just the cost columns, not your
whole model. Settings writes that template for you. See
[`docs/DATA.md`](docs/DATA.md).

### Custom products
**Customise a product** takes an existing one, inherits its whole cost structure,
and lets you add what this job needs on top — sublimation artwork, a pad upgrade,
a woven label, artwork setup — as one-tap presets or your own lines.

It starts from either end. On **Products** it builds a product and files it under
**Custom**, its own category rather than scattered through the catalogue it was
based on. Inside a quotation, **Add items → Customise a product** runs the same
workflow on top of the sheet and puts the finished garment straight on the
quotation the moment you save — no trip to Products and back to find what you
just made. Either way it is one product, in one place, priced the same way.

Those extras are **made at the factory**, so they are part of what leaves its
door. A product is priced **ex works** — manufacture, packaging, and whatever
this job adds — and nothing else:

```
Manufacture                              £32.83
Packaging                                 £0.15
Full sublimation artwork                  £4.50
Elastic Interface pad upgrade             £6.00
Unit cost — ex works                     £43.48
Markup at 150%                           £65.52
Sale price excl. VAT                    £109.00
VAT at 20%                               £21.80
Sale price incl. VAT                    £130.80
```

**Where it is going is not a property of the product.** A jersey does not know
whether it is bound for Dublin or Denver, and you cannot weigh an order until
you know what is in it. So the incoterm, the destination, the freight and the
duty all belong to the quotation — see below — and the product screen keeps the
full landed stack as what it has always been: the reference for what it costs to
bring one into the UK the way this business normally does.

### Shipping and customs on a quotation
Once the products are on a quote, **Shipping & customs** works out what the order
costs to move and to clear. Two separate questions, asked of two separate
estimators, because they fail differently — a carrier rate is a lane and a
weight, a customs entry is a classification and a trade treatment. Answering
them together lets a confident freight number carry a shaky duty number along
with it.

Pick the carrier (FedEx, DHL, UPS, TNT, DPD, GLS, Parcelforce, Evri, or a
forwarder by mode), give the two postcodes, and the weight and carton count come
prefilled from the garments themselves — a jersey is about 180g packed, bib
shorts 220g — editable the moment you have actually weighed it. Then:

> **FedEx International Priority · £412.50**
> Volumetric weight wins on folded apparel: 3 cartons at 60x40x40cm give 34.6 kg
> chargeable against 13.9 kg actual. Transit 2-3 working days.
> · A negotiated FedEx account usually takes 35-45% off this.

**Calculate import costs** then classifies what is actually on the quote and
prices the entry — duty, import VAT, other taxes and clearance, with the
commodity codes and the customs value it worked from. It reads the origin off
the products, so a Chinese-made jersey shipped out of an EU warehouse gets no
EU preference, which is the trap worth catching.

**Onward delivery is not in the unit cost.** The financial model folds a pound
of UK delivery into every garment; a quotation that also prices its own shipping
would pay for that leg twice. The product screen says so where it used to sit.

**Which cost the lines carry follows where the goods leave from.** Out of your
own stock they have already been brought in and cleared, so the line carries the
landed cost and the order only pays for the leg out. Straight from the factory
nothing has been spent on them yet, so the line is ex works and the whole journey
is priced once, here, on the real weight. Quoting a landed cost *and* adding
order freight would charge the same freight twice; quoting ex works out of stock
would forget it. On a 60-jersey club order that is the difference between 53.3%
and 58.1% margin, and the app says which basis it is using.

**Every estimate is checked against itself.** The model writes a rate, a value
and an amount into separate fields, so those three get multiplied back together.
A duty of £449.86 sitting next to a rate of 37.6% on a £2,976 value is not a
judgement call about tariffs — it is arithmetic, and one of the two numbers is
wrong. The app says which, by how much, and offers the corrected figure in one
tap. A shipping amount that works out at an impossible rate per kilo gets the
same treatment.

Low confidence is surfaced where it matters too: when a shaky figure is a large
share of what the order would otherwise earn, the panel says so before you quote
a fixed price on it.

Both estimates land as **editable figures** and drop straight into the
profitability you already had: £856.70 of shipping and duty takes a 49.2% order to 32.8%. Tick
**Charge it to the customer** and it becomes one line on the PDF — *Delivery,
duties and clearance* — with the margin recomputed against the larger total.
The customer sees that line and its price. None of the rates, codes, carriers or
customs values reach them.

### Asking Claude for the awkward ones
Put an Anthropic API key in **Settings → Made-to-order** and the builder can ask
Claude what a lane actually costs: it sends the garment, the route, the incoterm
and the FOB value, and gets back a commodity code, a duty rate and basis, import
VAT, per-unit freight and clearance, with its reasoning and what would change the
answer. Everything lands in editable fields, marked with how sure it was.

It is a starting figure, not a customs ruling — a broker signs off entries. The
key lives in this phone's storage, goes straight to Anthropic (there is no server
here to hide it behind), and is deliberately **left out of backups**. Use one with
a spend limit you can revoke.

Saved, a custom product lands under **Custom** and quotes like anything else. **The quotation shows only the price** — name,
reference, quantity, unit, amount. None of the breakdown, and not the factory's
name, reaches the customer.

### Products
Every product carries the whole Unit Economics table from the financial model.
Tap one and you get the landed cost built up line by line — manufacture,
packaging, FOB, inbound freight, UK delivery, insurance, duty, import VAT — with a
bar showing what share of the cost is making, shipping and tax. Below that, the
price ladder: retail, sale, collab and distributor, each with the VAT that comes
out, the commission, the profit and the margin left, plus the break-even price
and how many units a month cover fixed costs.

Every line is editable, so a freight rise or a new quote from Sobike can be tried
on and the margins move with it.

### Sales
Log a sale by hand or build it from products; the app derives net, VAT, cost and
margin. Totals by month, quarter, year, or all time.

### Dates
VAT quarters, annual accounts, Corporation Tax, the CT600 and the confirmation
statement, worked out from the company's own filing dates rather than a list that
goes stale. Tick things off, add your own, and change the year end or VAT stagger
in Settings. Optional PAYE and Self Assessment rules.

> The dates are a prompt, not advice, and the rules assume ordinary accounting
> periods. A company's *first* accounts are due 21 months after incorporation
> rather than 9 months after the year end — check anything unusual against
> Companies House and HMRC.

## Layout

```
index.html              app shell, tab bar
manifest.webmanifest    home-screen install
sw.js                   offline precache
css/app.css             the visual system
js/
  app.js                hash router
  ui.js                 DOM helpers, sheets, toasts, formatting
  store.js              localStorage schema, import/export
  catalog.js            products — names only, no money
  pricing.js            margin/markup/discount/VAT maths
  sync.js               CSV parsing and the pull-from-a-sheet route
  landed.js             incoterms, destinations, duty and the VAT on a supply
  claude.js             optional landed, freight and customs estimates
  pdf.js                the branded quotation
  fonts.js              resolves Gotham/Hakira, falls back to the stand-in
  deadlines.js          UK filing rules engine
  views/                one module per screen
assets/                 logo lockup, monogram, app icons
assets/fonts/           bundled stand-in; your licensed faces go here
vendor/jspdf.umd.min.js PDF generation (MIT), vendored so it works offline
data/figures.example.json  shape of the private figures file
docs/DATA.md            what lives where, and how to back it up
```

## Brand

The logo lockup, off-white paper, hairline rules, and **Gotham** throughout, with
**Hakira** on headline figures. No accent colour: the only two that appear are for
an overdue date and a loss-making line. The PDF uses the same system, with the
logo embedded as data and the typeface embedded as bytes, so a quote looks
identical whether it is opened on a phone, printed, or forwarded.

Gotham and Hakira are licensed and are **not** in this repository. Drop your `.ttf`
files into `assets/fonts/` with a `fonts.json` naming them and the app swaps them
in — interface and PDF both. Until then it uses a subsetted Montserrat (OFL), a
geometric sans cut close enough to Gotham that nothing reads wrong. Details in
[`assets/fonts/README.md`](assets/fonts/README.md).

## Releasing

`scripts/release.sh` bumps the build stamp in `js/version.js` and `sw.js`
together, then commit and push. **Do not skip it.** The service worker keeps a
cache named after that version and drops every other one when it activates; leave
the version alone and phones keep serving the previous deploy. Settings shows the
running version, so "am I on the latest?" is answerable rather than guessable.

App code is served network-first, so with signal you always get what is deployed
and the cache is only the offline fallback. Images and fonts stay cache-first —
large, stable, and not worth a round trip on every launch.

A phone already running an older build picks the new one up on the **second**
open: the first still runs the old code, which has no reload logic, while the new
worker installs behind it. From then on updates land on the next open.

## Backups

The app is the only copy of your data. Settings → **Export backup** writes a dated
JSON file; Today's screen reminds you when the last one is over a month old.
