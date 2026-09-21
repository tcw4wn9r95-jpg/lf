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

Those extras are **made at the factory**, so they go inside the FOB value the
customs declaration is based on, and insurance, duty and import VAT all rise with
them. £10.50 of customisation on a Chinese-made bib adds £14.38 landed, not
£10.50. The builder says so in as many words.

**A made-to-order run does not inherit the catalogue's import costs.** Pick the
incoterm you are quoting on and where the customer is, and the app works out what
is actually yours to pay. It defaults to FOB — goods leave the factory and the
club's forwarder takes them from there — so nothing lands in your cost until you
say it should. Lines the buyer carries are still shown, struck through, because
knowing what you handed over is half of knowing whether the incoterm was right.

```
Manufacture                              £32.83
Packaging                                 £0.15
Full sublimation artwork                  £4.50
Elastic Interface pad upgrade             £6.00
FOB — declared value                     £43.48
Transport Spain → Ireland                 £2.08
Delivery within Ireland                   £1.00
Insurance                                 £2.19
Duty                                      £0.00
Import VAT                                £0.00
Import costs                              £5.27
Unit cost — DDP Ireland                  £49.05
Markup at 150%                           £73.95
Sale price excl. VAT                    £123.00
VAT at 20%                               £24.60
Sale price incl. VAT                    £147.60
```

The rules it knows are the ones worth knowing: goods inside the EU cross no
border, the UK–EU agreement zero-rates the duty *only* on proof the garment
originates where it ships from, and everything else pays the destination's rate.
Where a single number cannot be right — US apparel runs 0–32% on fibre and
construction, Switzerland charges by the kilo — it says the rate is unknown and
refuses to count it rather than quietly borrowing one.

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

Saved, a custom product lands under **Custom** and quotes like anything else,
with the terms it was costed under stored alongside, so reopening it in six
months still adds up the same way. **The quotation shows only the price** — name,
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
  landed.js             incoterms, destinations and what duty they charge
  claude.js             optional landed-cost estimates, key stays on the phone
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
