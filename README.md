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
Pick products, set quantities, and the price builds itself from your landed unit
cost and a target net margin — or a markup on cost, the RRP, or a price you type.
Change VAT, apply a discount to the whole quote or to one line, and the panel
underneath keeps showing what you actually earn. A 10% club discount on a 45%
margin quote shows up immediately as 37%, and any line pushed below cost goes red.

Export produces an A4 PDF: the logo lockup, your company and VAT details, the client,
the line table, totals and terms, in the brand's black-and-white editorial style.
It is generated on the phone, so it works offline and nothing is uploaded.

### Products
The full catalogue with each product's landed cost, its cost stack (manufacture,
freight, insurance, duty, import VAT) and margin at RRP — plus what the margin
becomes at each of your discount tiers. Costs are editable and you can add
products the catalogue doesn't have.

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

## Backups

The app is the only copy of your data. Settings → **Export backup** writes a dated
JSON file; Today's screen reminds you when the last one is over a month old.
