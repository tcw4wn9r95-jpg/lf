# Fonts

The brand faces are **Gotham** (primary) and **Hakira** (secondary). Both are
licensed, so neither is committed here — publishing them in a public repository
would breach their licences.

## Adding yours

Put the TrueType files in this folder and add a `fonts.json` beside them:

```json
{
  "primary": {
    "normal": "Gotham-Book.ttf",
    "bold": "Gotham-Medium.ttf"
  },
  "secondary": "Hakira-Regular.ttf"
}
```

Name the files whatever you like — the manifest is what the app reads. On the next
load `js/fonts.js` registers them for the interface and embeds them in every
quotation PDF. Without a `fonts.json` the app quietly uses the stand-in below, so
there is nothing to switch on or off.

Notes:

- **TrueType only.** jsPDF cannot embed `.otf` (PostScript-flavoured) fonts. If
  your licence ships OTFs, convert them to TTF first.
- **Both primary weights or neither.** Mixing one real Gotham weight with one
  substitute looks worse than using the substitute throughout, so the app only
  switches when `normal` and `bold` both load.
- `secondary` is optional. It is used for headline figures in the interface.
- These files stay out of git — `.gitignore` covers `Gotham*`, `Hakira*` and
  `fonts.json` here. If you deploy from this repo, copy them onto the host
  separately.

## What ships instead

`LaFugaSans-Regular.ttf` and `LaFugaSans-SemiBold.ttf` are **Montserrat**
(SIL Open Font License 1.1), instanced to two weights and subsetted to Latin plus
the punctuation and currency a quotation prints — about 50 KB each. Montserrat is
a geometric sans cut close to Gotham, so quotes read correctly out of the box.

The same two files are inlined as base64 in `assets/font-fallback.js`, which is
what the PDF embeds. Regenerate both together if you ever change them.
