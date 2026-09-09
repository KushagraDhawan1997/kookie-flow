/**
 * Color parsing utilities for converting CSS colors to WebGL-compatible formats.
 */

import { themeRoot } from './theme-root';

export type RGBColor = [number, number, number]; // [0-1, 0-1, 0-1]
export type RGBAColor = [number, number, number, number]; // [0-1, 0-1, 0-1, 0-1]

/**
 * Convert RGB array [0-1] to hex string.
 */
export function rgbToHex(rgb: RGBColor): string {
  const r = Math.round(rgb[0] * 255);
  const g = Math.round(rgb[1] * 255);
  const b = Math.round(rgb[2] * 255);
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

/**
 * The measuring probes are EPHEMERAL: attached, read and removed inside one synchronous call.
 *
 * They used to be attached and left there, and that is what produced the docs app's hydration
 * mismatch. The colour probe's host is the theme element — a real, server-rendered `.kui-theme`
 * div wrapping the whole app — and the token read happens in a `useState` lazy initialiser,
 * which on the client IS the hydration render. So React would finish hydrating a host element,
 * find a leftover hydratable sibling that the server never sent, and throw. React 19's
 * `popHydrationState` treats any element node as hydratable, so a hidden, empty, absolutely
 * positioned span counts.
 *
 * Every other route was weighed. `suppressHydrationWarning` does not apply — this is a thrown
 * mismatch on a sibling, not a warned attribute diff. Deferring the read to an effect would fix
 * hydration and break first paint: the tokens would be unread for a frame, `areTokensValid`
 * would reject the empty result, and the canvas would paint one frame from the entirely-dark
 * FALLBACK table under a light theme — the exact black-canvas failure this file has already had
 * once. Ephemeral keeps the read where it is and makes "is the probe still attached?" a question
 * with no answer, which is the only version of it that cannot be got wrong.
 *
 * The elements themselves are still cached at module scope, so this costs no allocation per
 * call — only an append and a remove, which do not invalidate style or force layout on their own.
 * A depth counter lets one caller wrap a whole token pass (`withProbes`) and pay that once
 * instead of ~112 times.
 */
let colorProbe: HTMLSpanElement | null = null;
let colorProbeDepth = 0;

/**
 * Get or create a hidden element used to resolve CSS colors, ATTACHED for the caller's use.
 *
 * The probe MUST live inside the theme element, not on <body>. v1 scoped its tokens to
 * `.radix-themes`, so a probe outside it could not see them at all: measured, `var(--accent-9)`
 * resolved to rgb(0,0,0) from body against rgb(0,144,255) from inside.
 *
 * Under v2 the same mistake is WORSE rather than louder, which is why the host comes from the one
 * shared resolver instead of a second `?? document.body` written here. v2 declares its tokens at
 * `:root` and re-declares them inside the Theme's own `[data-appearance]` scope, so a probe
 * outside the Theme resolves every token successfully — at the ROOT appearance. Nothing is
 * missing and nothing warns; the colours are simply the other mode's.
 *
 * The host is resolved on every call rather than cached, because the theme element mounts after
 * this module first runs. Every caller must pair this with `releaseColorProbe()`, in a `finally`.
 */
function getColorProbe(): HTMLSpanElement | null {
  if (typeof document === 'undefined' || !document.body) return null;

  if (!colorProbe) {
    colorProbe = document.createElement('span');
    colorProbe.style.cssText = 'position:absolute;visibility:hidden;pointer-events:none;';
  }
  // `appendChild` on an already-parented node MOVES it, which is exactly what re-hosting needs
  // when the theme element has mounted or changed since the last call.
  themeRoot().appendChild(colorProbe);
  colorProbeDepth++;
  return colorProbe;
}

/** Detach the colour probe once the outermost caller is done with it. */
function releaseColorProbe(): void {
  colorProbeDepth = Math.max(0, colorProbeDepth - 1);
  if (colorProbeDepth === 0) colorProbe?.remove();
}

/**
 * Read a colour off the probe, forcing modern colour functions to resolve.
 *
 * Chrome returns modern colour functions from getComputedStyle UNCHANGED — `oklch(...)` in,
 * `oklch(...)` out — so reading `.color` directly cannot resolve an OKLCH token, and the caller
 * silently falls back to mid-grey. Wrapping in `color-mix(in srgb, ...)` forces conversion and
 * yields `color(srgb r g b)` at full float precision. Measured alternatives that do NOT work:
 * a canvas 2D fillStyle round-trip, and CSS.registerProperty with syntax '<color>'.
 *
 * If the wrapped form is rejected (unsupported, or the value is invalid) the declaration is
 * dropped and `color` keeps whatever it inherited — which would be silently wrong rather than
 * absent. A sentinel detects that and falls back to the unwrapped value.
 */
const PROBE_SENTINEL = 'rgb(1, 2, 3)';

function readProbe(colorValue: string): string | null {
  const probe = getColorProbe();
  if (!probe) return null;

  // `finally`, not a cleanup line per exit: there are three ways out of this function and the
  // probe must be detached on all of them, including a throw. Leaving it attached on any one path
  // is the whole hydration defect.
  try {
    probe.style.color = PROBE_SENTINEL;
    probe.style.color = `color-mix(in srgb, ${colorValue} 100%, transparent 0%)`;
    let computed = getComputedStyle(probe).color;

    if (computed === PROBE_SENTINEL) {
      // color-mix rejected it. Try the value on its own.
      probe.style.color = PROBE_SENTINEL;
      probe.style.color = colorValue;
      computed = getComputedStyle(probe).color;
      if (computed === PROBE_SENTINEL) return null;
    }

    return computed;
  } finally {
    probe.style.color = '';
    releaseColorProbe();
  }
}

/**
 * Resolve any CSS color value to RGB using the browser's computed style.
 * This handles oklch, hsl, hwb, lab, lch, and all other CSS color formats.
 */
export function resolveColorToRGB(colorValue: string): RGBColor | null {
  if (typeof document === 'undefined') return null;

  const computed = readProbe(colorValue);
  if (computed === null) return null;
  return parseRGBString(computed);
}


const COLOR_SRGB_RE = /color\(srgb\s+(-?[\d.eE+-]+)\s+(-?[\d.eE+-]+)\s+(-?[\d.eE+-]+)(?:\s*\/\s*([\d.eE+-]+))?/;
const COLOR_P3_RE = /color\(display-p3\s+(-?[\d.eE+-]+)\s+(-?[\d.eE+-]+)\s+(-?[\d.eE+-]+)(?:\s*\/\s*([\d.eE+-]+))?/;

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** sRGB / Display-P3 share a transfer function; these move between encoded and linear light. */
function toLinear(v: number): number {
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}
function toEncoded(v: number): number {
  return v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
}

/**
 * Display-P3 -> sRGB, through linear light and the P3->XYZ->sRGB matrix product.
 * Values outside sRGB's gamut clamp, which is the only honest thing a narrower space can do.
 */
function displayP3ToSRGB(r: number, g: number, b: number): RGBColor {
  const lr = toLinear(r);
  const lg = toLinear(g);
  const lb = toLinear(b);
  return [
    clamp01(toEncoded(1.2249401762 * lr - 0.2249404157 * lg + 0.0000002395 * lb)),
    clamp01(toEncoded(-0.0420569547 * lr + 1.0420571668 * lg - 0.0000002121 * lb)),
    clamp01(toEncoded(-0.0196375546 * lr - 0.0786360655 * lg + 1.0982736200 * lb)),
  ];
}

const HEX_RE = /^([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})?$/i;

/**
 * Parse a hex color string to RGBA array [0-1].
 *
 * Supports #rgb, #rgba, #rrggbb and #rrggbbaa, with or without the leading '#'.
 *
 * The 8-digit form is why this exists. Without it, an alpha hex fell through to the mid-grey
 * fallback in one path and, in the other, was handed to the browser — which resolves it correctly
 * and returns `color(display-p3 ...)` on a P3 display and `rgb(...)` on an sRGB one. The sRGB
 * answer parsed; the P3 answer went through a different branch that DID understand alpha. So one
 * token produced two different colours depending on the monitor, and neither the fallback nor the
 * divergence raised anything.
 */
export function hexToRGBA(hex: string): RGBAColor {
  // typeof rather than a bare startsWith: `hexToRGB` is a public export and an untyped consumer
  // passing a number used to get the grey fallback rather than a TypeError.
  if (typeof hex !== 'string') return [0.5, 0.5, 0.5, 1];

  const body = hex.charCodeAt(0) === 35 /* # */ ? hex.slice(1) : hex;
  // Expand shorthand AFTER dropping the '#': the old code tested `hex.length === 4` on the
  // un-sliced string, so hashless 'abcd' had its first character dropped and parsed as '#bbccdd'
  // while its own regex advertised the '#' as optional.
  const full =
    body.length === 3 || body.length === 4
      ? body
          .split('')
          .map((c) => c + c)
          .join('')
      : body;

  const m = HEX_RE.exec(full);
  if (!m) return [0.5, 0.5, 0.5, 1];

  return [
    parseInt(m[1], 16) / 255,
    parseInt(m[2], 16) / 255,
    parseInt(m[3], 16) / 255,
    m[4] === undefined ? 1 : parseInt(m[4], 16) / 255,
  ];
}

/**
 * Parse a hex color string to RGB array [0-1], discarding any alpha.
 * Supports #rgb, #rgba, #rrggbb and #rrggbbaa.
 */
export function hexToRGB(hex: string): RGBColor {
  const [r, g, b] = hexToRGBA(hex);
  return [r, g, b];
}

/**
 * Parse an rgb(), rgba(), or color(display-p3 ...) string to RGB array [0-1].
 */
function parseRGBString(color: string): RGBColor {
  // color(srgb r g b) — what readProbe's color-mix produces. Already sRGB, full float precision.
  const srgbMatch = color.match(COLOR_SRGB_RE);
  if (srgbMatch) {
    return [
      clamp01(parseFloat(srgbMatch[1])),
      clamp01(parseFloat(srgbMatch[2])),
      clamp01(parseFloat(srgbMatch[3])),
    ];
  }

  // color(display-p3 r g b) — 0-1 but in a WIDER gamut. Using these as sRGB is wrong: a saturated
  // P3 red is not sRGB (1,0,0). Convert properly.
  const p3Match = color.match(COLOR_P3_RE);
  if (p3Match) {
    return displayP3ToSRGB(
      parseFloat(p3Match[1]),
      parseFloat(p3Match[2]),
      parseFloat(p3Match[3])
    );
  }

  // Match rgb(r, g, b) or rgba(r, g, b, a) - values are 0-255
  const match = color.match(
    /rgba?\(\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)/
  );
  if (match) {
    return [
      parseFloat(match[1]) / 255,
      parseFloat(match[2]) / 255,
      parseFloat(match[3]) / 255,
    ];
  }

  // Try matching the modern syntax: rgb(r g b) or rgb(r g b / a)
  const modernMatch = color.match(
    /rgba?\(\s*(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)/
  );
  if (modernMatch) {
    return [
      parseFloat(modernMatch[1]) / 255,
      parseFloat(modernMatch[2]) / 255,
      parseFloat(modernMatch[3]) / 255,
    ];
  }

  return [0.5, 0.5, 0.5];
}

/**
 * Parse an rgba(), or color(display-p3 ... / a) string to RGBA array [0-1].
 */
function parseRGBAString(color: string): RGBAColor {
  // color(srgb r g b [/ a]) — what readProbe's color-mix produces.
  const srgbMatch = color.match(COLOR_SRGB_RE);
  if (srgbMatch) {
    return [
      clamp01(parseFloat(srgbMatch[1])),
      clamp01(parseFloat(srgbMatch[2])),
      clamp01(parseFloat(srgbMatch[3])),
      srgbMatch[4] === undefined ? 1 : clamp01(parseFloat(srgbMatch[4])),
    ];
  }

  // color(display-p3 r g b [/ a]) — wider gamut; convert rather than reinterpret.
  const p3Match = color.match(COLOR_P3_RE);
  if (p3Match) {
    const [r, g, b] = displayP3ToSRGB(
      parseFloat(p3Match[1]),
      parseFloat(p3Match[2]),
      parseFloat(p3Match[3])
    );
    return [r, g, b, p3Match[4] === undefined ? 1 : clamp01(parseFloat(p3Match[4]))];
  }

  // Match rgba(r, g, b, a) with comma syntax
  const match = color.match(
    /rgba\(\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*([\d.]+)/
  );
  if (match) {
    return [
      parseFloat(match[1]) / 255,
      parseFloat(match[2]) / 255,
      parseFloat(match[3]) / 255,
      parseFloat(match[4]),
    ];
  }

  // Try matching the modern syntax: rgba(r g b / a)
  const modernMatch = color.match(
    /rgba?\(\s*(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s*\/\s*([\d.]+)/
  );
  if (modernMatch) {
    return [
      parseFloat(modernMatch[1]) / 255,
      parseFloat(modernMatch[2]) / 255,
      parseFloat(modernMatch[3]) / 255,
      parseFloat(modernMatch[4]),
    ];
  }

  // Fallback: parse as RGB and add alpha 1
  const rgb = parseRGBString(color);
  return [rgb[0], rgb[1], rgb[2], 1];
}

/**
 * Parse any CSS color string to RGB array [0-1].
 * Supports: hex (#fff, #rgba, #ffffff, #rrggbbaa), rgb(), rgba(), 'transparent',
 * and any CSS color format the browser supports (oklch, hsl, hwb, etc.)
 */
export function parseColorToRGB(color: string): RGBColor {
  const trimmed = color.trim();

  // Handle empty
  if (!trimmed) {
    return [0.5, 0.5, 0.5];
  }

  // Handle hex
  if (trimmed.startsWith('#')) {
    return hexToRGB(trimmed);
  }

  // Handle rgb()/rgba() - already in the format we need
  if (trimmed.startsWith('rgb')) {
    return parseRGBString(trimmed);
  }

  // Handle 'transparent'
  if (trimmed === 'transparent') {
    return [0, 0, 0];
  }

  // For any other format (oklch, hsl, hwb, lab, lch, color(), etc.),
  // use the browser to resolve it to RGB
  const resolved = resolveColorToRGB(trimmed);
  if (resolved) {
    return resolved;
  }

  // Fallback
  console.warn(`[kookie-flow] Could not parse color: ${color}`);
  return [0.5, 0.5, 0.5];
}

/**
 * Resolve any CSS color value to RGBA using the browser's computed style.
 * This handles oklch, hsl, hwb, lab, lch, and all other CSS color formats.
 */
export function resolveColorToRGBA(colorValue: string): RGBAColor | null {
  if (typeof document === 'undefined') return null;

  const computed = readProbe(colorValue);
  if (computed === null) return null;
  return parseRGBAString(computed);
}

/**
 * Parse any CSS color string to RGBA array [0-1].
 * Supports: hex (#fff, #rgba, #ffffff, #rrggbbaa), rgb(), rgba(), 'transparent',
 * and any CSS color format the browser supports (oklch, hsl, hwb, etc.)
 */
export function parseColorToRGBA(color: string): RGBAColor {
  const trimmed = color.trim();

  // Handle empty
  if (!trimmed) {
    return [0.5, 0.5, 0.5, 1];
  }

  // Handle hex, including the #rgba and #rrggbbaa forms
  if (trimmed.startsWith('#')) {
    return hexToRGBA(trimmed);
  }

  // Handle rgba()
  if (trimmed.startsWith('rgba')) {
    return parseRGBAString(trimmed);
  }

  // Handle rgb()
  if (trimmed.startsWith('rgb')) {
    const rgb = parseRGBString(trimmed);
    return [rgb[0], rgb[1], rgb[2], 1];
  }

  // Handle 'transparent'
  if (trimmed === 'transparent') {
    return [0, 0, 0, 0];
  }

  // For any other format (oklch, hsl, hwb, lab, lch, color(), etc.),
  // use the browser to resolve it to RGBA
  const resolved = resolveColorToRGBA(trimmed);
  if (resolved) {
    return resolved;
  }

  // Fallback
  console.warn(`[kookie-flow] Could not parse color: ${color}`);
  return [0.5, 0.5, 0.5, 1];
}

let dimensionProbe: HTMLDivElement | null = null;
let dimensionProbeDepth = 0;
let warnedDetachedProbe = false;

/**
 * Get or create a hidden element used to resolve CSS dimensions, ATTACHED for the caller's use.
 * The browser computes calc() expressions to actual pixel values on it.
 *
 * EPHEMERAL, for the reason given at the colour probe above, and it also closes a second failure
 * this one had on its own. It used to be appended once and re-attached only when found
 * disconnected — and the earlier diagnosis of WHY it kept being found disconnected was wrong. It
 * was not that React regenerated `<body>`'s children over this node; React 19 does not treat
 * body children as hydratable. It was collateral: the COLOUR probe's mismatch threw, React
 * client-rendered the root from scratch, and this element went with the subtree. `getComputedStyle`
 * on a detached element resolves nothing, `parsePx` returned 0 for every length, `areTokensValid`
 * read that as a failed read, and the hook kept FALLBACK_TOKENS — dark by construction. A black
 * canvas under a working light theme.
 *
 * With the lifetime shortened to one synchronous call, "is it still attached?" stops being a
 * question anything can get wrong. The host stays `<body>`: every length token is px arithmetic
 * with `var()` already substituted by the time `getPropertyValue` returns, so there is no em/rem
 * scope to inherit and no reason to reach for the theme element.
 */
function getDimensionProbe(): HTMLDivElement | null {
  if (typeof document === 'undefined' || !document.body) return null;

  if (!dimensionProbe) {
    dimensionProbe = document.createElement('div');
    dimensionProbe.style.cssText = 'position:absolute;visibility:hidden;pointer-events:none;';
  }
  document.body.appendChild(dimensionProbe);
  dimensionProbeDepth++;
  return dimensionProbe;
}

/** Detach the dimension probe once the outermost caller is done with it. */
function releaseDimensionProbe(): void {
  dimensionProbeDepth = Math.max(0, dimensionProbeDepth - 1);
  if (dimensionProbeDepth === 0) dimensionProbe?.remove();
}

/**
 * Hold both probes attached for the length of one pass, instead of per lookup.
 *
 * A full token read resolves upwards of a hundred values, and without this each one appends and
 * removes an element. Correctness does not depend on it — attach/detach per call is already
 * safe — it only stops the mount and theme-change paths churning the DOM a hundred times over.
 */
export function withProbes<T>(fn: () => T): T {
  const color = getColorProbe();
  const dim = getDimensionProbe();
  try {
    return fn();
  } finally {
    if (dim) releaseDimensionProbe();
    if (color) releaseColorProbe();
  }
}

/**
 * Parse a CSS pixel value to a number.
 * Handles simple values like "12px" and calc() expressions like "calc(12px * 1)".
 */
export function parsePx(value: string): number {
  const trimmed = value.trim();
  if (!trimmed) return 0;

  // Try simple parseFloat first (handles "12px", "12", etc.)
  const simple = parseFloat(trimmed);
  if (!isNaN(simple) && !trimmed.startsWith('calc')) {
    return simple;
  }

  // For calc() or other complex values, use browser to resolve
  const probe = getDimensionProbe();
  if (!probe) return 0;

  let computed: string;
  try {
    probe.style.width = trimmed;
    computed = getComputedStyle(probe).width;
  } finally {
    probe.style.width = '';
    releaseDimensionProbe();
  }

  const px = parseFloat(computed);
  if (Number.isNaN(px)) {
    // The probe was attached for the read, so this is the environment declining to lay anything
    // out rather than the probe being lost — jsdom, most often, which computes no widths at all.
    //
    // Returning a bare 0 is what kept the original failure silent: a zero length is
    // indistinguishable from a token that is legitimately zero, so the whole token read was
    // reported as failed and the canvas painted from the dark fallback table under a light
    // theme. Warned ONCE, because the caller is a render path.
    if (!warnedDetachedProbe) {
      warnedDetachedProbe = true;
      console.warn(
        `[kookie-flow] Could not resolve the length ${JSON.stringify(trimmed)}: ` +
          'the measuring probe computed no width. This is expected under jsdom, which lays ' +
          'nothing out; in a browser it means layout is unavailable on this document.'
      );
    }
    return 0;
  }
  return px;
}
