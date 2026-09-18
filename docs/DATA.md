# Where the money lives

The app is public. Your numbers are not.

## The split

| Stays in this repo | Lives only on your phone |
| --- | --- |
| Product names, model numbers, categories, manufacturer | Landed unit costs and the cost stack behind them |
| App code, brand assets, statutory deadline rules | RRPs and distributor discounts |
| Company registration details already on public record | Quotations, clients, sales, backups |

`js/catalog.js` holds the catalogue with no money in it at all. Everything with a
price attached arrives by import and is written to this browser's `localStorage`
under the key `lafuga.v1`. Nothing is uploaded, synced or logged anywhere.

## Loading your figures

You were sent `la-fuga-figures.json` separately. On the phone:

1. Save it to Files (long-press the attachment → Save to Files).
2. Open the app → **Settings** → **Import** → pick the file.

Or use **Paste figures instead** and paste the JSON straight in.

Importing merges. Running it again with a newer file updates the costs it
mentions and leaves your quotations and sales alone.

## The file format

See `data/figures.example.json` for the shape. Zeroes below stand in for real
figures on purpose — none belong in this file either. In short:

```json
{
  "kind": "lafuga-financials",
  "financials": {
    "<product id from js/catalog.js>": {
      "cost": 0.00,         // landed unit cost, DDP, excluding VAT
      "rrp": 0.00,          // retail price including VAT
      "distributorDiscount": 0.25,
      "breakdown": { "manufacture": 0.00, "freight": 0.00, "...": 0 }
    }
  }
}
```

A file with `"kind": "lafuga-backup"` is a full export — figures plus quotations,
sales, settings and ticked-off deadlines.

## Keeping figures up to date

Three routes, in order of how private they are.

### 1. Import a file (nothing leaves your control)

Settings -> **Import** takes a `.csv` as well as a JSON backup. On the iPhone the
Files app can open Google Drive directly, so: export your sheet as CSV into Drive,
then Import -> Browse -> Google Drive -> pick it. Four taps, nothing published.

### 2. Sync from a published sheet (a price change reaches the phone on its own)

Settings -> **Sync from a sheet** takes a link and pulls the figures in, with an
optional hourly check when you open the app.

**The catch:** a browser can only read a Google Sheet that has been published with
**File -> Share -> Publish to web**, as CSV. A normal "anyone with the link" share
redirects to a sign-in page, and Drive's direct-download URL sends no CORS headers
at all — both are refused before the app sees them. Publishing means anyone
holding that long URL can read the sheet.

So publish a **separate sheet carrying only the columns below** — never your whole
financial model with its margins, suppliers and overheads. Settings ->
**Copy template** writes that sheet out for you, pre-filled with what the app
already knows.

The link itself is stored on the phone, not in this repository, so it is not
exposed by the app being public.

### 3. Paste JSON

Settings -> **Paste figures instead**, for when you have the JSON to hand.

## The sheet format

One row per product. Column order does not matter and unknown columns are ignored.

| Column | Meaning |
| --- | --- |
| `id` | Join key, from `js/catalog.js`. An unknown id creates a new product. |
| `name` | Shown in the app. Used to derive an id if `id` is blank. |
| `cost` | Landed unit cost, DDP. **Required** — a row without one is skipped. |
| `rrp` | Retail price including VAT. |
| `distributor_discount` | `25%` or `0.25`, both read the same. |
| `code`, `category`, `maker` | Only used when the row creates a new product. |
| `notes` | Free text. |

`£1,234.56`, `€1.234,56` and `(12.50)` for a negative all parse. Spanish headers
(`Descripcion`, `Precio DDP`, `PVP`) are recognised too.

Syncing **merges**: it updates the products the sheet mentions and leaves
everything else — your quotations, sales, and any cost you typed by hand — alone.

A CSV carries only the landed total. The full cost stack (manufacture, packaging,
freight in and out, insurance, duty, import VAT) comes from the JSON file, under
`breakdown`, and is what the product screen draws its table from.

## Where the app and the spreadsheet disagree

The app computes the stack itself rather than copying the model's answers, so on
three points the numbers differ. All three make products look **more** profitable
than the sheet does.

1. **VAT.** The model takes VAT as 21% *of* the VAT-inclusive price. VAT inside a
   gross price is `gross x rate / (1 + rate)` — so on a £116 jersey it is £20.13,
   not £24.36. The sheet overstates VAT, and understates profit by the difference.
2. **Commission.** The model charges the 2% platform fee against the *collab*
   price rather than the price actually being sold at, which looks like a cell
   reference pointing one column across.
3. **Import VAT.** It sits inside landed cost. For a VAT-registered company it is
   input tax and comes back, so it inflates the cost of every Sobike-made product
   by about 14%. Settings has a switch — off by default, so the stack matches the
   sheet until you decide otherwise.

The product screen states the first two on the product itself, with both figures,
so nothing is silently different. Landed cost can also land a penny off the
model's DDP, because the app sums the components rather than carrying the sheet's
rounded total.

## Backups

**This is the only copy.** Clearing Safari's website data deletes it, and so does
deleting the home-screen app if you also clear its data.

Settings → **Export backup** writes a dated JSON file you can drop in Drive or
iCloud. Today's screen nags you when the last backup is over a month old. Do it
after any run of quoting.

## Changing a product id

Ids in `js/catalog.js` are the join key for your figures. Rename a product freely;
change its `id` and its costs come unstuck. If you must, re-export a backup first,
edit the key, and re-import.
