/*
 * La Fuga product catalogue — structure only.
 *
 * Deliberately free of money. Costs, RRPs and margins are unit financials and
 * never live in this repository; they arrive from the private data file you
 * import on the phone (see docs/DATA.md) and stay in that phone's storage.
 *
 * Each product's `id` is the join key the private file uses, so renaming a
 * product here is safe but changing an id orphans its figures.
 */

export const CATEGORIES = [
  { id: 'jersey-m', label: "Men's Jerseys" },
  { id: 'bib-m', label: "Men's Bib Shorts" },
  { id: 'jersey-w', label: "Women's Jerseys" },
  { id: 'bib-w', label: "Women's Bib Shorts" },
  { id: 'gilet', label: 'Gilets' },
  { id: 'baselayer', label: 'Base Layers' },
  { id: 'jacket', label: 'Jackets' },
  { id: 'accessories', label: 'Accessories' },
  /* Made-to-order work. Nothing ships in this category — it fills up as club
     jobs get priced, which is why it sits at the end. */
  { id: 'custom', label: 'Custom' },
];

export const CATALOG = [
  { id: 'm-equinnox-jersey-ls', name: 'Equinnox Jersey LS', category: 'jersey-m', maker: 'Engobe' },
  { id: 'm-disruptive-jersey', name: 'Disruptive Jersey', category: 'jersey-m', maker: 'Sobike' },
  { id: 'm-rogue-jersey', name: 'Rogue Jersey', category: 'jersey-m', maker: 'Engobe' },
  { id: 'm-pro-ss-jersey', name: 'Cycling PRO SS Jersey', code: 'CMT23004K-1A', category: 'jersey-m', maker: 'Sobike' },

  { id: 'm-equinnox-pants-thermal', name: 'Equinnox Pants Thermal', category: 'bib-m', maker: 'Engobe' },
  { id: 'm-disruptive-bib', name: 'Disruptive Bib Short', category: 'bib-m', maker: 'Sobike' },
  { id: 'm-rogue-bib', name: 'Rogue Bib Short', category: 'bib-m', maker: 'Engobe' },
  { id: 'm-essentials-cargo-bib', name: 'Essentials Cargo Bib Short', category: 'bib-m', maker: 'Sobike' },

  { id: 'w-equinnox-jersey-ls', name: 'Equinnox Jersey LS', category: 'jersey-w', maker: 'Engobe' },
  { id: 'w-disruptive-jersey', name: 'Disruptive Jersey', category: 'jersey-w', maker: 'Sobike' },
  { id: 'w-pro7-ss-jersey', name: 'Cycling PRO7 SS Jersey', code: 'CMTPRO704B-7A', category: 'jersey-w', maker: 'Sobike' },
  { id: 'w-pro-ss-jersey', name: 'Cycling PRO SS Jersey', code: 'CMT23004K-1A', category: 'jersey-w', maker: 'Sobike' },

  { id: 'w-equinnox-pants-thermal', name: 'Equinnox Pants Thermal', category: 'bib-w', maker: 'Engobe' },
  { id: 'w-disruptive-bib', name: 'Disruptive Bib Short', category: 'bib-w', maker: 'Sobike' },
  { id: 'w-rogue-bib', name: 'Rogue Bib Shorts', category: 'bib-w', maker: 'Engobe' },
  { id: 'w-essentials-cargo-bib', name: 'Essentials Cargo Bib Short', category: 'bib-w', maker: 'Sobike' },

  { id: 'm-waterproof-gilet', name: "Men's Waterproof Cycling Gilet", code: 'CMT2154E-1A', category: 'gilet', maker: 'Sobike' },
  { id: 'm-pro7-wind-vest', name: "Men's PRO7 Ultra-light Wind Vest", category: 'gilet', maker: 'Sobike' },
  { id: 'm-disruptive-gilet', name: "Men's Disruptive Gilet", category: 'gilet', maker: 'Sobike' },
  { id: 'w-waterproof-gilet', name: "Women's Waterproof Cycling Gilet", code: 'CMT2154E-1A', category: 'gilet', maker: 'Sobike' },
  { id: 'w-pro7-wind-vest', name: "Women's PRO7 Ultra-light Wind Vest", code: 'CMT2154D-1A', category: 'gilet', maker: 'Sobike' },
  { id: 'w-disruptive-gilet', name: "Women's Disruptive Gilet", category: 'gilet', maker: 'Sobike' },

  { id: 'equinnox-baselayer-merino', name: 'Equinnox Base Layer (Merino)', category: 'baselayer', maker: 'Engobe' },
  { id: 'disruptive-baselayer', name: 'Disruptive Base Layer', category: 'baselayer', maker: 'Sobike' },

  { id: 'm-rain-jacket', name: "Men's Cycling Rain Jacket", code: 'CMT2053A-1B', category: 'jacket', maker: 'Sobike' },
  { id: 'w-rain-jacket', name: "Women's Cycling Rain Jacket", code: 'CMT2053A-1B', category: 'jacket', maker: 'Sobike' },

  { id: 'socks', name: 'Cycling Socks', code: '23-2', category: 'accessories', maker: 'Sobike' },
  { id: 'cap-milo', name: 'Cap Milo', category: 'accessories', maker: 'Sobike' },
  { id: 'leg-warmers', name: 'Leg Warmers', category: 'accessories', maker: 'Engobe' },
  { id: 'arm-warmers', name: 'Arm Warmers', category: 'accessories', maker: 'Engobe' },
  { id: 'thermal-gloves', name: 'Thermal Gloves', category: 'accessories', maker: 'Sobike' },
];

export const CATEGORY_LABEL = Object.fromEntries(CATEGORIES.map((c) => [c.id, c.label]));

/** Men's/Women's live in the category for apparel, so only prefix where it isn't implied. */
export function displayName(product) {
  // A product you named yourself is shown exactly as you named it.
  if (product.custom) return product.name;
  const cat = product.category;
  const gendered = cat === 'jersey-m' || cat === 'bib-m' || cat === 'jersey-w' || cat === 'bib-w';
  if (!gendered) return product.name;
  const prefix = cat.endsWith('-m') ? "Men's" : "Women's";
  return product.name.startsWith("Men's") || product.name.startsWith("Women's")
    ? product.name
    : `${prefix} ${product.name}`;
}
