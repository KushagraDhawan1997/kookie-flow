/**
 * Color parsing utilities for converting CSS colors to WebGL-compatible formats.
 */

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

// Reusable probe element for color resolution
let colorProbe: HTMLSpanElement | null = null;

/**
 * Get or create a hidden element used to resolve CSS colors.
 *
 * The probe MUST live inside the theme element, not on <body>. Design tokens are scoped to
 * `.radix-themes`, so a probe outside it cannot see them: measured, `var(--accent-9)` resolves to
 * rgb(0,0,0) from body and rgb(0,144,255) from inside the theme, and `--gray-2` gives the untinted
 * rgb(249,249,249) instead of the real rgb(249,249,251).
 *
 * The host is re-checked on every call rather than cached once, because the theme element mounts
 * after this module first runs.
 */
function getColorProbe(): HTMLSpanElement | null {
  if (typeof document === 'undefined' || !document.body) return null;

  const host = document.querySelector('.radix-themes') ?? document.body;

  if (!colorProbe) {
    colorProbe = document.createElement('span');
    colorProbe.style.cssText = 'position:absolute;visibility:hidden;pointer-events:none;';
  }
  if (colorProbe.parentElement !== host) {
    host.appendChild(colorProbe);
  }
  return colorProbe;
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

  probe.style.color = PROBE_SENTINEL;
  probe.style.color = `color-mix(in srgb, ${colorValue} 100%, transparent 0%)`;
  let computed = getComputedStyle(probe).color;

  if (computed === PROBE_SENTINEL) {
    // color-mix rejected it. Try the value on its own.
    probe.style.color = PROBE_SENTINEL;
    probe.style.color = colorValue;
    computed = getComputedStyle(probe).color;
    if (computed === PROBE_SENTINEL) {
      probe.style.color = '';
      return null;
    }
  }

  probe.style.color = '';
  return computed;
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

// Reusable probe element for dimension resolution
let dimensionProbe: HTMLDivElement | null = null;

/**
 * Get or create a hidden element used to resolve CSS dimensions.
 * The browser will compute calc() expressions to actual pixel values.
 */
function getDimensionProbe(): HTMLDivElement | null {
  if (!dimensionProbe && typeof document !== 'undefined' && document.body) {
    dimensionProbe = document.createElement('div');
    dimensionProbe.style.cssText = 'position:absolute;visibility:hidden;pointer-events:none;';
    document.body.appendChild(dimensionProbe);
  }
  return dimensionProbe;
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

  // Set width to the value and read computed width
  probe.style.width = trimmed;
  const computed = getComputedStyle(probe).width;
  probe.style.width = '';

  return parseFloat(computed) || 0;
}
