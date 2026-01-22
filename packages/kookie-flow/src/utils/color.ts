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
 * Get or create a hidden element used to resolve CSS colors to RGB.
 * The browser will compute any color format (oklch, hsl, etc.) to RGB.
 */
function getColorProbe(): HTMLSpanElement | null {
  if (!colorProbe && typeof document !== 'undefined' && document.body) {
    colorProbe = document.createElement('span');
    colorProbe.style.cssText = 'position:absolute;visibility:hidden;pointer-events:none;';
    document.body.appendChild(colorProbe);
  }
  return colorProbe;
}

/**
 * Resolve any CSS color value to RGB using the browser's computed style.
 * This handles oklch, hsl, hwb, lab, lch, and all other CSS color formats.
 */
export function resolveColorToRGB(colorValue: string): RGBColor | null {
  if (typeof document === 'undefined') return null;

  const probe = getColorProbe();
  if (!probe) return null;

  // Set the color on the probe element
  probe.style.color = colorValue;

  // Get the computed color (browser converts to rgb())
  const computed = getComputedStyle(probe).color;

  // Reset for next use
  probe.style.color = '';

  // Parse the computed rgb() value
  return parseRGBString(computed);
}

/**
 * Parse a hex color string to RGB array [0-1].
 * Supports #fff, #ffffff formats.
 */
export function hexToRGB(hex: string): RGBColor {
  // Normalize short hex (#fff -> #ffffff)
  let normalizedHex = hex;
  if (hex.length === 4) {
    normalizedHex = `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`;
  }

  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(normalizedHex);
  if (result) {
    return [
      parseInt(result[1], 16) / 255,
      parseInt(result[2], 16) / 255,
      parseInt(result[3], 16) / 255,
    ];
  }

  // Fallback gray
  return [0.5, 0.5, 0.5];
}

/**
 * Parse an rgb(), rgba(), or color(display-p3 ...) string to RGB array [0-1].
 */
function parseRGBString(color: string): RGBColor {
  // Match color(display-p3 r g b) - values are already 0-1
  const p3Match = color.match(
    /color\(display-p3\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/
  );
  if (p3Match) {
    return [
      parseFloat(p3Match[1]),
      parseFloat(p3Match[2]),
      parseFloat(p3Match[3]),
    ];
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
  // Match color(display-p3 r g b / a) - values are already 0-1
  const p3AlphaMatch = color.match(
    /color\(display-p3\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\/\s*([\d.]+)/
  );
  if (p3AlphaMatch) {
    return [
      parseFloat(p3AlphaMatch[1]),
      parseFloat(p3AlphaMatch[2]),
      parseFloat(p3AlphaMatch[3]),
      parseFloat(p3AlphaMatch[4]),
    ];
  }

  // Match color(display-p3 r g b) without alpha - values are already 0-1
  const p3Match = color.match(
    /color\(display-p3\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\)/
  );
  if (p3Match) {
    return [
      parseFloat(p3Match[1]),
      parseFloat(p3Match[2]),
      parseFloat(p3Match[3]),
      1,
    ];
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
 * Supports: hex (#fff, #ffffff), rgb(), rgba(), 'transparent',
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

  const probe = getColorProbe();
  if (!probe) return null;

  // Set the color on the probe element
  probe.style.color = colorValue;

  // Get the computed color (browser converts to rgb() or rgba())
  const computed = getComputedStyle(probe).color;

  // Reset for next use
  probe.style.color = '';

  // Parse the computed rgba() or rgb() value
  return parseRGBAString(computed);
}

/**
 * Parse any CSS color string to RGBA array [0-1].
 * Supports: hex (#fff, #ffffff), rgb(), rgba(), 'transparent',
 * and any CSS color format the browser supports (oklch, hsl, hwb, etc.)
 */
export function parseColorToRGBA(color: string): RGBAColor {
  const trimmed = color.trim();

  // Handle empty
  if (!trimmed) {
    return [0.5, 0.5, 0.5, 1];
  }

  // Handle hex (no alpha support in hex for now)
  if (trimmed.startsWith('#')) {
    const rgb = hexToRGB(trimmed);
    return [rgb[0], rgb[1], rgb[2], 1];
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
