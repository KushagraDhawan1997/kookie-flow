/**
 * Color parsing utilities for converting CSS colors to WebGL-compatible formats.
 */

export type RGBColor = [number, number, number]; // [0-1, 0-1, 0-1]
export type RGBAColor = [number, number, number, number]; // [0-1, 0-1, 0-1, 0-1]

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
 * Parse an rgb() or rgba() string to RGB array [0-1].
 */
function parseRGBString(color: string): RGBColor {
  // Match rgb(r, g, b) or rgba(r, g, b, a)
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
 * Parse an rgba() string to RGBA array [0-1].
 */
function parseRGBAString(color: string): RGBAColor {
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
 * Supports: hex (#fff, #ffffff), rgb(), rgba(), 'transparent'
 */
export function parseColorToRGB(color: string): RGBColor {
  const trimmed = color.trim();

  // Handle hex
  if (trimmed.startsWith('#')) {
    return hexToRGB(trimmed);
  }

  // Handle rgb()/rgba()
  if (trimmed.startsWith('rgb')) {
    return parseRGBString(trimmed);
  }

  // Handle 'transparent'
  if (trimmed === 'transparent') {
    return [0, 0, 0];
  }

  // Fallback
  console.warn(`[kookie-flow] Unknown color format: ${color}`);
  return [0.5, 0.5, 0.5];
}

/**
 * Parse any CSS color string to RGBA array [0-1].
 * Supports: hex (#fff, #ffffff), rgb(), rgba(), 'transparent'
 */
export function parseColorToRGBA(color: string): RGBAColor {
  const trimmed = color.trim();

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

  // Fallback
  console.warn(`[kookie-flow] Unknown color format: ${color}`);
  return [0.5, 0.5, 0.5, 1];
}

/**
 * Parse a CSS pixel value to a number.
 * getComputedStyle returns resolved values like "12px"
 */
export function parsePx(value: string): number {
  return parseFloat(value) || 0;
}
