import type { TextEntityData } from '../types';
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
