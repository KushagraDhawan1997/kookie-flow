import type { TextEntityData, TextSizingMode } from '../types';
import {
  DEFAULT_TEXT_FONT_SIZE,
  DEFAULT_TEXT_LINE_HEIGHT,
  DEFAULT_TEXT_PADDING,
} from '../core/constants';
import {
  type GlyphMap,
  type KerningMap,
  measureTextBlockMSDF,
} from './text-layout';

// ============================================================================
// TextStyleConfig — single source of truth for MSDF rendering and contenteditable CSS
// ============================================================================

export interface TextStyleConfig {
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  lineHeight: number;
  letterSpacing: number;
  textAlign: 'left' | 'center' | 'right';
  textColor: string;
  padding: number;
}

export interface TextStyleDefaults {
  fontFamily?: string;
  textColor?: string;
}

/** Resolve TextStyleConfig from TextEntityData + optional theme defaults */
export function resolveTextStyle(
  data: TextEntityData,
  defaults?: TextStyleDefaults
): TextStyleConfig {
  return {
    fontFamily: data.fontFamily ?? defaults?.fontFamily ?? '"Google Sans", system-ui, -apple-system, sans-serif',
    fontSize: data.fontSize ?? DEFAULT_TEXT_FONT_SIZE,
    fontWeight: data.fontWeight ?? 400,
    lineHeight: data.lineHeight ?? DEFAULT_TEXT_LINE_HEIGHT,
    letterSpacing: data.letterSpacing ?? 0,
    textAlign: data.textAlign ?? 'left',
    textColor: data.textColor ?? defaults?.textColor ?? '#e0e0e0',
    padding: DEFAULT_TEXT_PADDING,
  };
}

// ============================================================================
// MSDF-based auto-height calculation
// ============================================================================

/**
 * Calculate auto-height for a text entity using MSDF glyph measurement.
 * Returns the height needed to fit all text content.
 */
export function calculateTextAutoHeightMSDF(
  content: string,
  style: TextStyleConfig,
  entityWidth: number,
  baseFontSize: number,
  glyphMap: GlyphMap,
  kerningMap: KerningMap
): number {
  const { height } = measureTextBlockMSDF(
    content,
    style.fontSize,
    style.lineHeight,
    entityWidth,
    style.padding,
    baseFontSize,
    glyphMap,
    kerningMap,
    style.letterSpacing
  );
  return Math.max(
    height + 2 * style.padding,
    style.fontSize * style.lineHeight + 2 * style.padding
  );
}

// ============================================================================
// Auto-width sizing (no word wrap)
// ============================================================================

/** Very large width that prevents word wrapping — only explicit \n breaks lines. */
export const NO_WRAP_WIDTH = 1e7;

/**
 * Calculate auto-width and auto-height for 'auto-width' sizing mode.
 * No word wrapping; only explicit \n creates line breaks.
 */
export function calculateTextAutoSizeMSDF(
  content: string,
  style: TextStyleConfig,
  baseFontSize: number,
  glyphMap: GlyphMap,
  kerningMap: KerningMap
): { width: number; height: number } {
  const { width, height } = measureTextBlockMSDF(
    content,
    style.fontSize,
    style.lineHeight,
    NO_WRAP_WIDTH,
    style.padding,
    baseFontSize,
    glyphMap,
    kerningMap,
    style.letterSpacing
  );
  const minDim = style.fontSize + 2 * style.padding;
  return {
    width: Math.max(width + 2 * style.padding, minDim),
    height: Math.max(
      height + 2 * style.padding,
      style.fontSize * style.lineHeight + 2 * style.padding
    ),
  };
}

// ============================================================================
// Sizing mode → resizable mapping
// ============================================================================

/**
 * Derive the entity `resizable` property from the text sizing mode.
 * - auto-width: no handles (both dimensions auto)
 * - auto-height: E/W handles only (width manual, height auto)
 * - fixed: all 8 handles (both dimensions manual)
 */
export function resizableForSizingMode(
  mode: TextSizingMode
): boolean | { width?: boolean; height?: boolean } {
  switch (mode) {
    case 'auto-width':
      return false;
    case 'auto-height':
      return { width: true, height: false };
    case 'fixed':
      return { width: true, height: true };
  }
}
