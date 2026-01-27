/**
 * Text Layout Engine for MSDF Rendering
 *
 * Handles character positioning and text measurement using BMFont metrics.
 * Output is used to populate instanced glyph buffers.
 */

/**
 * BMFont glyph metrics (from msdf-bmfont-xml JSON output).
 */
export interface GlyphMetrics {
  /** Character ID (Unicode codepoint) */
  id: number;
  /** Glyph index in font (from msdf-bmfont-xml) */
  index?: number;
  /** Character string (from msdf-bmfont-xml) */
  char?: string;
  /** X position in atlas (pixels) */
  x: number;
  /** Y position in atlas (pixels) */
  y: number;
  /** Width in atlas (pixels) */
  width: number;
  /** Height in atlas (pixels) */
  height: number;
  /** X offset when rendering (pixels) */
  xoffset: number;
  /** Y offset when rendering (pixels) */
  yoffset: number;
  /** Horizontal advance after glyph (pixels) */
  xadvance: number;
  /** Atlas page index (for multi-page atlases) */
  page: number;
  /** Character channel (usually 15 for MSDF) */
  chnl: number;
}

/**
 * Kerning pair adjustment.
 */
export interface KerningPair {
  /** First character ID */
  first: number;
  /** Second character ID */
  second: number;
  /** Horizontal adjustment (pixels) */
  amount: number;
}

/**
 * BMFont common info (font metrics).
 */
export interface FontCommon {
  /** Line height (pixels) */
  lineHeight: number;
  /** Base (baseline position from top, pixels) */
  base: number;
  /** Atlas width (pixels) */
  scaleW: number;
  /** Atlas height (pixels) */
  scaleH: number;
  /** Number of atlas pages */
  pages: number;
  /** Whether font is packed */
  packed: number;
  /** Alpha channel content */
  alphaChnl?: number;
  /** Red channel content */
  redChnl?: number;
  /** Green channel content */
  greenChnl?: number;
  /** Blue channel content */
  blueChnl?: number;
}

/**
 * BMFont info section.
 */
export interface FontInfo {
  /** Font face name */
  face: string;
  /** Font size in pixels */
  size: number;
  /** Bold flag */
  bold: number;
  /** Italic flag */
  italic: number;
  /** Character set (can be string or array from different generators) */
  charset: string | string[];
  /** Unicode flag */
  unicode?: number;
  /** Height stretch percentage */
  stretchH?: number;
  /** Smoothing flag */
  smooth?: number;
  /** Supersampling level */
  aa?: number;
  /** Padding [top, right, bottom, left] */
  padding?: [number, number, number, number];
  /** Spacing [horizontal, vertical] */
  spacing?: [number, number];
  /** Outline thickness */
  outline?: number;
}

/**
 * Complete BMFont metrics (JSON format from msdf-bmfont-xml).
 */
export interface FontMetrics {
  pages: string[];
  chars: GlyphMetrics[];
  info: FontInfo;
  common: FontCommon;
  kernings?: KerningPair[];
  distanceField?: {
    fieldType: 'msdf' | 'sdf';
    distanceRange: number;
  };
}

/**
 * Text anchor/alignment.
 */
export type TextAnchor = 'left' | 'center' | 'right';

/**
 * Font weight for text rendering.
 */
export type TextFontWeight = 'regular' | 'semibold';

/**
 * Input for a single text entry to be rendered.
 */
export interface TextEntry {
  /** Unique ID for tracking */
  id: string;
  /** Text content */
  text: string;
  /** World position (x, y, z) */
  position: [number, number, number];
  /** Font size in world units */
  fontSize: number;
  /** Text color (hex or rgb string) */
  color: string;
  /** Horizontal anchor. Default: 'left' */
  anchor?: TextAnchor;
  /** Opacity (0-1). Default: 1 */
  opacity?: number;
  /** Font weight. Default: 'regular' */
  fontWeight?: TextFontWeight;
}

/**
 * Output glyph data for GPU buffer population.
 */
export interface GlyphInstance {
  /** World position of glyph center */
  x: number;
  y: number;
  z: number;
  /** Glyph width in world units */
  width: number;
  /** Glyph height in world units */
  height: number;
  /** UV offset in atlas (normalized 0-1) */
  uvX: number;
  uvY: number;
  uvW: number;
  uvH: number;
  /** Color RGB (0-1) */
  r: number;
  g: number;
  b: number;
  /** Opacity (0-1) */
  opacity: number;
}

/**
 * Parsed color from hex or rgb string.
 */
function parseColor(color: string): [number, number, number] {
  // Handle hex colors
  if (color.startsWith('#')) {
    const hex = color.slice(1);
    const bigint = parseInt(hex.length === 3
      ? hex.split('').map(c => c + c).join('')
      : hex, 16);
    return [
      ((bigint >> 16) & 255) / 255,
      ((bigint >> 8) & 255) / 255,
      (bigint & 255) / 255,
    ];
  }

  // Handle rgb/rgba
  const match = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (match) {
    return [
      parseInt(match[1], 10) / 255,
      parseInt(match[2], 10) / 255,
      parseInt(match[3], 10) / 255,
    ];
  }

  // Default to white
  return [1, 1, 1];
}

/**
 * Pre-built glyph lookup map for O(1) character lookup.
 */
export type GlyphMap = Map<number, GlyphMetrics>;

/**
 * Build glyph lookup map from font metrics.
 */
export function buildGlyphMap(metrics: FontMetrics): GlyphMap {
  const map = new Map<number, GlyphMetrics>();
  for (const glyph of metrics.chars) {
    map.set(glyph.id, glyph);
  }
  return map;
}

/**
 * Pre-built kerning lookup for O(1) pair lookup.
 * Key is `${first}:${second}`.
 */
export type KerningMap = Map<string, number>;

/**
 * Build kerning lookup map.
 */
export function buildKerningMap(metrics: FontMetrics): KerningMap {
  const map = new Map<string, number>();
  if (metrics.kernings) {
    for (const kern of metrics.kernings) {
      map.set(`${kern.first}:${kern.second}`, kern.amount);
    }
  }
  return map;
}

/**
 * Measure text width in font units.
 */
export function measureText(
  text: string,
  glyphMap: GlyphMap,
  kerningMap: KerningMap
): number {
  let width = 0;
  let prevCharCode: number | null = null;

  for (let i = 0; i < text.length; i++) {
    const charCode = text.charCodeAt(i);
    const glyph = glyphMap.get(charCode);

    if (!glyph) continue; // Skip unknown characters

    // Apply kerning if available
    if (prevCharCode !== null) {
      const kerning = kerningMap.get(`${prevCharCode}:${charCode}`);
      if (kerning) width += kerning;
    }

    width += glyph.xadvance;
    prevCharCode = charCode;
  }

  return width;
}

// Truncation cache: text:maxWidth:fontSize -> truncated result
// Using Map for O(1) lookup, with size limit to prevent unbounded growth
const truncationCache = new Map<string, string>();
const TRUNCATION_CACHE_MAX_SIZE = 1000;

/**
 * Clear the truncation cache. Call when font changes.
 */
export function clearTruncationCache(): void {
  truncationCache.clear();
}

/**
 * Truncate text to fit within maxWidth, adding ellipsis if needed.
 * Results are cached for performance.
 *
 * @param text - Text to truncate
 * @param maxWidth - Maximum width in world units
 * @param fontSize - Font size for scaling
 * @param baseFontSize - Base font size from metrics
 * @param glyphMap - Pre-built glyph lookup
 * @param kerningMap - Pre-built kerning lookup
 * @returns Truncated text (with "..." if truncated)
 */
export function truncateText(
  text: string,
  maxWidth: number,
  fontSize: number,
  baseFontSize: number,
  glyphMap: GlyphMap,
  kerningMap: KerningMap
): string {
  // Cache key combines text and sizing params
  const cacheKey = `${text}:${maxWidth}:${fontSize}`;
  const cached = truncationCache.get(cacheKey);
  if (cached !== undefined) {
    return cached;
  }

  const scale = fontSize / baseFontSize;
  const textWidth = measureText(text, glyphMap, kerningMap) * scale;

  // No truncation needed
  if (textWidth <= maxWidth) {
    // Cache the result (original text)
    if (truncationCache.size >= TRUNCATION_CACHE_MAX_SIZE) {
      // Simple eviction: clear half the cache when full
      const keys = Array.from(truncationCache.keys());
      for (let i = 0; i < keys.length / 2; i++) {
        truncationCache.delete(keys[i]);
      }
    }
    truncationCache.set(cacheKey, text);
    return text;
  }

  const ellipsis = '…';
  const ellipsisWidth = measureText(ellipsis, glyphMap, kerningMap) * scale;
  const availableWidth = maxWidth - ellipsisWidth;

  // Binary search for the right length
  let low = 0;
  let high = text.length;

  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    const truncated = text.slice(0, mid);
    const width = measureText(truncated, glyphMap, kerningMap) * scale;

    if (width <= availableWidth) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }

  const result = low > 0 ? text.slice(0, low) + ellipsis : ellipsis;

  // Cache the result
  if (truncationCache.size >= TRUNCATION_CACHE_MAX_SIZE) {
    const keys = Array.from(truncationCache.keys());
    for (let i = 0; i < keys.length / 2; i++) {
      truncationCache.delete(keys[i]);
    }
  }
  truncationCache.set(cacheKey, result);

  return result;
}

/**
 * Layout text entries into glyph instances.
 *
 * @param entries - Text entries to layout
 * @param metrics - Font metrics
 * @param glyphMap - Pre-built glyph lookup
 * @param kerningMap - Pre-built kerning lookup
 * @returns Array of glyph instances for GPU buffer
 */
export function layoutText(
  entries: TextEntry[],
  metrics: FontMetrics,
  glyphMap: GlyphMap,
  kerningMap: KerningMap
): GlyphInstance[] {
  const glyphs: GlyphInstance[] = [];
  const atlasWidth = metrics.common.scaleW;
  const atlasHeight = metrics.common.scaleH;
  const fontSize = metrics.info.size;
  const lineHeight = metrics.common.lineHeight;

  for (const entry of entries) {
    const [px, py, pz] = entry.position;
    const scale = entry.fontSize / fontSize;
    const anchor = entry.anchor ?? 'left';
    const opacity = entry.opacity ?? 1;
    const [r, g, b] = parseColor(entry.color);

    // Measure text for anchor alignment
    const textWidth = measureText(entry.text, glyphMap, kerningMap) * scale;

    // Calculate starting X based on anchor
    let startX = px;
    if (anchor === 'center') {
      startX = px - textWidth / 2;
    } else if (anchor === 'right') {
      startX = px - textWidth;
    }

    // Layout each character
    let cursorX = startX;
    let prevCharCode: number | null = null;

    // Y position: we're in Y-down coordinate system
    // Baseline is at py, glyphs render below it
    const baselineY = py;

    for (let i = 0; i < entry.text.length; i++) {
      const charCode = entry.text.charCodeAt(i);
      const glyph = glyphMap.get(charCode);

      if (!glyph) {
        // Skip unknown characters, but advance cursor for space-like chars
        if (charCode === 32) cursorX += fontSize * scale * 0.25;
        continue;
      }

      // Apply kerning
      if (prevCharCode !== null) {
        const kerning = kerningMap.get(`${prevCharCode}:${charCode}`);
        if (kerning) cursorX += kerning * scale;
      }

      // Skip rendering for space (no visible glyph)
      if (glyph.width > 0 && glyph.height > 0) {
        // Glyph position in world space
        // xoffset/yoffset are relative to cursor position
        const glyphW = glyph.width * scale;
        const glyphH = glyph.height * scale;

        // Position is glyph center
        // X: cursor + xoffset + half width
        // Y: baseline + yoffset + half height (Y-down, so we add)
        const glyphX = cursorX + glyph.xoffset * scale + glyphW / 2;
        const glyphY = baselineY + glyph.yoffset * scale + glyphH / 2;

        // UV coordinates in atlas (normalized 0-1)
        // Note: atlas Y is top-down
        const uvX = glyph.x / atlasWidth;
        const uvY = glyph.y / atlasHeight;
        const uvW = glyph.width / atlasWidth;
        const uvH = glyph.height / atlasHeight;

        glyphs.push({
          x: glyphX,
          y: glyphY,
          z: pz,
          width: glyphW,
          height: glyphH,
          uvX,
          uvY,
          uvW,
          uvH,
          r,
          g,
          b,
          opacity,
        });
      }

      cursorX += glyph.xadvance * scale;
      prevCharCode = charCode;
    }
  }

  return glyphs;
}

/**
 * Get total glyph count for pre-allocation.
 * Counts visible characters (excludes spaces).
 */
export function countGlyphs(entries: TextEntry[], glyphMap: GlyphMap): number {
  let count = 0;
  for (const entry of entries) {
    for (let i = 0; i < entry.text.length; i++) {
      const charCode = entry.text.charCodeAt(i);
      const glyph = glyphMap.get(charCode);
      if (glyph && glyph.width > 0 && glyph.height > 0) {
        count++;
      }
    }
  }
  return count;
}

/**
 * Populate pre-allocated buffers with glyph data.
 * More efficient than creating new array - zero allocations.
 *
 * Buffer layout:
 * - matrices: Float32Array(capacity * 16) - instance matrices (position + scale)
 * - uvOffsets: Float32Array(capacity * 4) - UV offset per glyph
 * - colors: Float32Array(capacity * 3) - RGB color per glyph
 * - opacities: Float32Array(capacity) - opacity per glyph
 *
 * @returns Number of glyphs written
 */
export function populateGlyphBuffers(
  entries: TextEntry[],
  metrics: FontMetrics,
  glyphMap: GlyphMap,
  kerningMap: KerningMap,
  matrices: Float32Array,
  uvOffsets: Float32Array,
  colors: Float32Array,
  opacities: Float32Array,
  capacity: number
): number {
  const atlasWidth = metrics.common.scaleW;
  const atlasHeight = metrics.common.scaleH;
  const fontSize = metrics.info.size;

  let glyphIndex = 0;

  for (const entry of entries) {
    if (glyphIndex >= capacity) break;

    const [px, py, pz] = entry.position;
    const scale = entry.fontSize / fontSize;
    const anchor = entry.anchor ?? 'left';
    const opacity = entry.opacity ?? 1;
    const [r, g, b] = parseColor(entry.color);

    // Measure text for anchor alignment
    const textWidth = measureText(entry.text, glyphMap, kerningMap) * scale;

    // Calculate starting X based on anchor
    let startX = px;
    if (anchor === 'center') {
      startX = px - textWidth / 2;
    } else if (anchor === 'right') {
      startX = px - textWidth;
    }

    let cursorX = startX;
    let prevCharCode: number | null = null;
    const baselineY = py;

    for (let i = 0; i < entry.text.length; i++) {
      if (glyphIndex >= capacity) break;

      const charCode = entry.text.charCodeAt(i);
      const glyph = glyphMap.get(charCode);

      if (!glyph) {
        if (charCode === 32) cursorX += fontSize * scale * 0.25;
        continue;
      }

      // Apply kerning
      if (prevCharCode !== null) {
        const kerning = kerningMap.get(`${prevCharCode}:${charCode}`);
        if (kerning) cursorX += kerning * scale;
      }

      // Skip rendering for space
      if (glyph.width > 0 && glyph.height > 0) {
        const glyphW = glyph.width * scale;
        const glyphH = glyph.height * scale;
        const glyphX = cursorX + glyph.xoffset * scale + glyphW / 2;
        const glyphY = baselineY + glyph.yoffset * scale + glyphH / 2;

        // Write instance matrix (4x4, column-major)
        // Simple translation + scale matrix
        const mi = glyphIndex * 16;
        // Column 0
        matrices[mi + 0] = glyphW; // scaleX
        matrices[mi + 1] = 0;
        matrices[mi + 2] = 0;
        matrices[mi + 3] = 0;
        // Column 1
        matrices[mi + 4] = 0;
        matrices[mi + 5] = glyphH; // scaleY
        matrices[mi + 6] = 0;
        matrices[mi + 7] = 0;
        // Column 2
        matrices[mi + 8] = 0;
        matrices[mi + 9] = 0;
        matrices[mi + 10] = 1;
        matrices[mi + 11] = 0;
        // Column 3 (translation)
        matrices[mi + 12] = glyphX;
        matrices[mi + 13] = -glyphY; // Flip Y for Three.js (Y-up)
        matrices[mi + 14] = pz;
        matrices[mi + 15] = 1;

        // Write UV offset (x, y, width, height in normalized coords)
        const uvi = glyphIndex * 4;
        uvOffsets[uvi + 0] = glyph.x / atlasWidth;
        uvOffsets[uvi + 1] = glyph.y / atlasHeight;
        uvOffsets[uvi + 2] = glyph.width / atlasWidth;
        uvOffsets[uvi + 3] = glyph.height / atlasHeight;

        // Write color
        const ci = glyphIndex * 3;
        colors[ci + 0] = r;
        colors[ci + 1] = g;
        colors[ci + 2] = b;

        // Write opacity
        opacities[glyphIndex] = opacity;

        glyphIndex++;
      }

      cursorX += glyph.xadvance * scale;
      prevCharCode = charCode;
    }
  }

  return glyphIndex;
}
