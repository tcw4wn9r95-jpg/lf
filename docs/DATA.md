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
