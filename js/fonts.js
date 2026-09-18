/*
 * Brand typography.
 *
 * Gotham is the primary face and Hakira the secondary. Both are licensed, so
 * neither ships here — drop your own .ttf files into assets/fonts/ alongside a
 * fonts.json naming them, and the app picks them up everywhere: the interface via
 * the FontFace API, the PDF via jsPDF. Until then a bundled geometric sans stands
 * in, close enough to Gotham that nothing reads wrong.
 *
 * Discovery is driven by that one manifest rather than by guessing filenames, so
 * an install without the licensed fonts costs a single 404 and no console noise.
 */

import { FALLBACK_NORMAL, FALLBACK_BOLD, FALLBACK_FAMILY } from '../assets/font-fallback.js';

const BASE = 'assets/fonts/';
const MANIFEST = `${BASE}fonts.json`;

/** CSS family names the stylesheet refers to. */
export const PRIMARY_FAMILY = 'Gotham Brand';
export const SECONDARY_FAMILY = 'Hakira Brand';

/* Resolved once per session. */
let resolved = null;
let pending = null;

const FALLBACK = {
  family: FALLBACK_FAMILY,
  weights: { normal: FALLBACK_NORMAL, bold: FALLBACK_BOLD },
  secondary: null,
  source: 'bundled fallback',
};

/**
 * Read the manifest, load whatever it names, and register it for the interface.
 * Safe to call repeatedly; the work happens once.
 */
export function loadBrandFonts() {
  if (resolved) return Promise.resolve(resolved);
  if (pending) return pending;

  pending = (async () => {
    const manifest = await readManifest();
    if (!manifest) {
      resolved = FALLBACK;
      return resolved;
    }

    const [normal, bold, secondary] = await Promise.all([
      loadFile(manifest.primary?.normal),
      loadFile(manifest.primary?.bold),
      loadFile(manifest.secondary),
    ]);

    // Mixing one real weight with one substitute looks worse than using the
    // substitute throughout, so only switch when both weights arrived.
    const complete = normal && bold;
    resolved = {
      family: complete ? 'GothamBrand' : FALLBACK.family,
      weights: complete ? { normal: normal.base64, bold: bold.base64 } : FALLBACK.weights,
      secondary: secondary ? { family: 'HakiraBrand', base64: secondary.base64 } : null,
      source: complete ? `${manifest.primary.normal} / ${manifest.primary.bold}` : FALLBACK.source,
    };

    if (complete) {
      registerWebFont(PRIMARY_FAMILY, normal.buffer, '400');
      registerWebFont(PRIMARY_FAMILY, bold.buffer, '500 700');
    }
    if (secondary) registerWebFont(SECONDARY_FAMILY, secondary.buffer, '400');

    return resolved;
  })();

  return pending;
}

/** What loadBrandFonts settled on, or the fallback if it has not finished yet. */
export function brandFonts() {
  return resolved || FALLBACK;
}

/** Register the resolved fonts on a jsPDF document and return the family name. */
export function registerPdfFonts(doc) {
  const fonts = brandFonts();
  Object.entries(fonts.weights).forEach(([weight, base64]) => {
    const file = `${fonts.family}-${weight}.ttf`;
    doc.addFileToVFS(file, base64);
    doc.addFont(file, fonts.family, weight);
  });
  if (fonts.secondary) {
    const file = `${fonts.secondary.family}.ttf`;
    doc.addFileToVFS(file, fonts.secondary.base64);
    doc.addFont(file, fonts.secondary.family, 'normal');
  }
  return fonts;
}

/* -------------------------------------------------------------------- loading */

async function readManifest() {
  try {
    const res = await fetch(MANIFEST, { cache: 'no-cache' });
    if (!res.ok) return null; // Expected when the licensed fonts are not installed.
    const json = await res.json();
    return json && typeof json === 'object' ? json : null;
  } catch {
    return null;
  }
}

async function loadFile(filename) {
  if (!filename || typeof filename !== 'string') return null;
  try {
    const res = await fetch(`${BASE}${filename}`, { cache: 'force-cache' });
    if (!res.ok) {
      console.warn(`Font listed in fonts.json but not found: ${filename}`);
      return null;
    }
    const buffer = await res.arrayBuffer();
    if (!looksLikeFont(buffer)) {
      console.warn(`Not a usable font file: ${filename}`);
      return null;
    }
    return { buffer, base64: toBase64(buffer) };
  } catch (err) {
    console.warn(`Could not load font ${filename}`, err);
    return null;
  }
}

/** Every TrueType/OpenType file opens with one of these signatures. */
function looksLikeFont(buffer) {
  const head = new Uint8Array(buffer.slice(0, 4));
  const sig = [...head].map((b) => b.toString(16).padStart(2, '0')).join('');
  return ['00010000', '74727565', '4f54544f', '74746366'].includes(sig);
}

function registerWebFont(family, buffer, weight) {
  try {
    const face = new FontFace(family, buffer, { weight, style: 'normal', display: 'swap' });
    face.load().then((loaded) => document.fonts.add(loaded));
  } catch (err) {
    console.warn(`Could not register ${family} for the interface`, err);
  }
}

function toBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  // Chunked so a large font does not blow the argument limit on String.fromCharCode.
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}
