/**
 * Text Cursor Layout — character position mapping for WebGL text editing.
 *
 * Replicates the character-walking logic from populateMultiLineGlyphBuffers
 * (text-layout.ts) to produce a position table instead of GPU buffers.
 * Same BMFont metrics, same scale/kerning/letter-spacing math.
 *
 * Also handles bidirectional mapping between content offsets (as used by
 * the hidden textarea) and visual positions in wrapped lines.
 */

import type { GlyphMap, KerningMap, FontMetrics } from './text-layout';
import { measureText, wrapTextMSDF } from './text-layout';

// ============================================================================
// Types
// ============================================================================

/** Position and dimensions of a single character in world space. */
export interface CharPosition {
  /** Left edge x (world coords) */
  x: number;
  /** Top of line box y (world coords) */
  y: number;
  /** Character advance width (world units) */
  width: number;
  /** Line height (world units) */
  height: number;
  /** Wrapped line index (0-based) */
  line: number;
  /** Character index within wrapped line (0-based) */
  charInLine: number;
}

/** Pre-computed position table for a text block. */
export interface CharPositionTable {
  /**
   * One CharPosition per visual character (characters that appear in
   * wrapped lines). Index = "position index" (posIdx).
   */
  positions: CharPosition[];

  /**
   * Maps content offset → position index.
   * Length = content.length. Characters trimmed during wrapping
   * (e.g. leading whitespace after a word-wrap break) map to the start
   * of the next line. \n characters map to end of preceding line.
   */
  contentToPos: number[];

  /**
   * Maps position index → content offset.
   * Length = positions.length.
   */
  posToContent: number[];

  /** Starting position index for each wrapped line. */
  lineOffsets: number[];
  /** Position count per wrapped line. */
  lineLengths: number[];
  /** Rendered width of each line (world units). */
  lineWidths: number[];
  /** StartX of each line (world coords, accounting for textAlign). */
  lineStartXs: number[];
  /** Number of wrapped lines. */
  lineCount: number;
  /** Line height in world units. */
  lineHeightPx: number;
  /** Content string length. */
  contentLength: number;
}

/** Cursor position in world space. */
export interface CursorPosition {
  x: number;
  y: number;
  height: number;
}

/** Rectangle for selection highlight. */
export interface SelectionRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

// ============================================================================
// buildCharPositions
// ============================================================================

/**
 * Build a character position table from content and its wrapped lines.
 *
 * Walks characters identically to populateMultiLineGlyphBuffers — same
 * startX alignment, same half-leading offset, same kerning. Returns
 * CharPosition per visual character and a bidirectional mapping between
 * content offsets and position indices.
 */
export function buildCharPositions(
  content: string,
  lines: string[],
  fontSize: number,
  lineHeight: number,
  textAlign: 'left' | 'center' | 'right',
  constrainedWidth: number,
  padding: number,
  entityX: number,
  entityY: number,
  metrics: FontMetrics,
  glyphMap: GlyphMap,
  kerningMap: KerningMap,
  letterSpacing: number
): CharPositionTable {
  const baseFontSize = metrics.info.size;
  const scale = fontSize / baseFontSize;
  const lineHeightPx = fontSize * lineHeight;
  const letterSpacingFontUnits = letterSpacing / scale;

  // Half-leading (matches populateMultiLineGlyphBuffers)
  const bmfontLineHeightScaled = metrics.common.lineHeight * scale;
  const halfLeading = (lineHeightPx - bmfontLineHeightScaled) / 2;

  const px = entityX + padding;
  const py = entityY + padding;

  const positions: CharPosition[] = [];
  const posToContent: number[] = [];
  const lineOffsets: number[] = [];
  const lineLengths: number[] = [];
  const lineWidths: number[] = [];
  const lineStartXs: number[] = [];

  // --- Phase 1: Build positions from wrapped lines ---
  // Same math as populateMultiLineGlyphBuffers (text-layout.ts:754-849)
  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx];
    lineOffsets.push(positions.length);

    // Measure line width for alignment
    let lineWidthFontUnits = measureText(line, glyphMap, kerningMap);
    let charCount = 0;
    for (let i = 0; i < line.length; i++) {
      if (glyphMap.has(line.charCodeAt(i))) charCount++;
    }
    if (charCount > 1) {
      lineWidthFontUnits += (charCount - 1) * letterSpacingFontUnits;
    }
    const lineWidth = lineWidthFontUnits * scale;
    lineWidths.push(lineWidth);

    // Compute startX from textAlign
    let startX = px;
    if (textAlign === 'center') {
      startX = px + (constrainedWidth - lineWidth) / 2;
    } else if (textAlign === 'right') {
      startX = px + constrainedWidth - lineWidth;
    }
    lineStartXs.push(startX);

    // Y position with half-leading (matches MSDF rendering)
    const lineY = py + lineIdx * lineHeightPx + halfLeading;

    let cursorX = startX;
    let prevCharCode: number | null = null;

    for (let i = 0; i < line.length; i++) {
      const charCode = line.charCodeAt(i);
      const glyph = glyphMap.get(charCode);

      let charWidth: number;
      if (!glyph) {
        charWidth = charCode === 32 ? baseFontSize * scale * 0.25 : 0;
      } else {
        if (prevCharCode !== null) {
          const kern = kerningMap.get((prevCharCode << 16) | charCode);
          if (kern) cursorX += kern * scale;
          cursorX += letterSpacing;
        }
        charWidth = glyph.xadvance * scale;
      }

      positions.push({
        x: cursorX,
        y: lineY,
        width: charWidth,
        height: lineHeightPx,
        line: lineIdx,
        charInLine: i,
      });

      cursorX += charWidth;
      prevCharCode = charCode;
    }

    lineLengths.push(line.length);
  }

  // --- Phase 2: Build content ↔ position mapping ---
  // Walk through content paragraphs and wrapped lines simultaneously.
  // Each paragraph (split by \n) maps to one or more consecutive wrapped lines.
  // Within a paragraph, line characters come from the paragraph in order,
  // but some whitespace may be trimmed during word-wrap breaks.

  const contentToPos = new Array<number>(content.length);
  const paragraphs = content.split('\n');
  let contentIdx = 0;
  let posIdx = 0;

  for (let pIdx = 0; pIdx < paragraphs.length; pIdx++) {
    const para = paragraphs[pIdx];
    let paraOffset = 0;

    // Consume wrapped lines belonging to this paragraph
    while (paraOffset < para.length && posIdx < positions.length) {
      const curLine = positions[posIdx].line;
      const lineLen = lineLengths[curLine];

      // Match this line's characters to paragraph characters
      for (let ci = 0; ci < lineLen && paraOffset < para.length; ci++) {
        contentToPos[contentIdx] = posIdx;
        posToContent[posIdx] = contentIdx;
        contentIdx++;
        paraOffset++;
        posIdx++;
      }

      // After a wrapped line within the same paragraph, there may be
      // trimmed whitespace. wrapTextMSDF trims leading whitespace of
      // the word that causes overflow. Skip past any such whitespace
      // in the paragraph, mapping it to the start of the next line.
      if (paraOffset < para.length && posIdx < positions.length) {
        const nextLine = positions[posIdx].line;
        if (nextLine !== curLine) {
          // Crossed a line boundary — skip trimmed whitespace.
          // wrapTextMSDF trims leading whitespace of the word that causes
          // overflow. If the next line starts with a non-space character,
          // any spaces remaining in the paragraph before it are trimmed.
          const nextLineStr = lines[nextLine];
          const nextLineStartsWithSpace = nextLineStr &&
            nextLineStr.length > 0 &&
            (nextLineStr[0] === ' ' || nextLineStr[0] === '\t');

          if (!nextLineStartsWithSpace) {
            while (paraOffset < para.length) {
              const ch = para[paraOffset];
              if (ch !== ' ' && ch !== '\t') break;
              contentToPos[contentIdx] = posIdx;
              contentIdx++;
              paraOffset++;
            }
          }
        }
      }
    }

    // Remaining paragraph characters (edge case: more chars than positions)
    while (paraOffset < para.length) {
      contentToPos[contentIdx] = posIdx > 0 ? posIdx - 1 : 0;
      contentIdx++;
      paraOffset++;
    }

    // Handle the \n between paragraphs
    if (pIdx < paragraphs.length - 1) {
      contentToPos[contentIdx] = posIdx > 0 ? posIdx : 0;
      contentIdx++;
    }
  }

  return {
    positions,
    contentToPos,
    posToContent,
    lineOffsets,
    lineLengths,
    lineWidths,
    lineStartXs,
    lineCount: lines.length,
    lineHeightPx,
    contentLength: content.length,
  };
}

// ============================================================================
// getCursorXY — cursor position from content offset
// ============================================================================

/**
 * Get the cursor (caret) position for a given content offset.
 * Uses the contentToPos mapping to find the visual position.
 */
export function getCursorXY(
  contentOffset: number,
  table: CharPositionTable,
  entityX: number,
  entityY: number,
  padding: number
): CursorPosition {
  const { positions, contentToPos, lineStartXs, lineHeightPx } = table;

  // Empty text or no positions: cursor at start
  if (positions.length === 0 || contentToPos.length === 0) {
    return {
      x: lineStartXs[0] ?? (entityX + padding),
      y: positions[0]?.y ?? (entityY + padding),
      height: lineHeightPx,
    };
  }

  const offset = Math.max(0, Math.min(contentOffset, table.contentLength));

  // At end of text: cursor after last character
  if (offset >= table.contentLength) {
    const lastPos = positions[positions.length - 1];
    return {
      x: lastPos.x + lastPos.width,
      y: lastPos.y,
      height: lineHeightPx,
    };
  }

  // Normal case: cursor at left edge of the character at this content offset
  const posIdx = contentToPos[offset];
  if (posIdx !== undefined && posIdx < positions.length) {
    const pos = positions[posIdx];
    return { x: pos.x, y: pos.y, height: lineHeightPx };
  }

  // Fallback
  return {
    x: lineStartXs[0] ?? (entityX + padding),
    y: positions[0]?.y ?? (entityY + padding),
    height: lineHeightPx,
  };
}

// ============================================================================
// getSelectionRects — selection highlight rectangles
// ============================================================================

/**
 * Get selection highlight rectangles for a content offset range.
 * Returns one rectangle per visual line that the selection spans.
 */
/**
 * Entity bounds for edge-to-edge selection rects (Figma-style).
 * When provided, selection rects extend to the full entity width and
 * use logical line positions (no half-leading offset).
 */
export interface SelectionEntityBounds {
  x: number;
  y: number;
  width: number;
  padding: number;
}

export function getSelectionRects(
  startContentOffset: number,
  endContentOffset: number,
  table: CharPositionTable,
  entityBounds?: SelectionEntityBounds
): SelectionRect[] {
  if (startContentOffset === endContentOffset || table.positions.length === 0) return [];

  const lo = Math.max(0, Math.min(startContentOffset, endContentOffset));
  const hi = Math.min(table.contentLength, Math.max(startContentOffset, endContentOffset));
  if (lo >= hi) return [];

  const { positions, contentToPos, lineOffsets, lineLengths, lineHeightPx } = table;

  // Map content offsets to position indices
  const startPosIdx = contentToPos[lo] ?? 0;
  const endPosIdx = hi >= table.contentLength
    ? positions.length
    : (contentToPos[hi] ?? positions.length);

  if (startPosIdx >= endPosIdx) return [];

  const rects: SelectionRect[] = [];
  const startLine = positions[startPosIdx].line;
  const endLine = endPosIdx < positions.length
    ? positions[endPosIdx].line
    : positions[positions.length - 1].line;

  for (let lineIdx = startLine; lineIdx <= endLine; lineIdx++) {
    const lineStart = lineOffsets[lineIdx];
    const lineLen = lineLengths[lineIdx];
    if (lineLen === 0) continue;

    const selStart = Math.max(startPosIdx, lineStart);
    const selEnd = Math.min(endPosIdx, lineStart + lineLen);
    if (selStart >= selEnd) continue;

    const firstChar = positions[selStart];
    const lastChar = positions[selEnd - 1];

    if (entityBounds) {
      // Figma-style: full entity width, logical line Y (no half-leading)
      const lineY = entityBounds.y + entityBounds.padding + lineIdx * lineHeightPx;
      rects.push({
        x: entityBounds.x,
        y: lineY,
        width: entityBounds.width,
        height: lineHeightPx,
      });
    } else {
      const rectWidth = (lastChar.x + lastChar.width) - firstChar.x;
      if (rectWidth > 0) {
        rects.push({
          x: firstChar.x,
          y: firstChar.y,
          width: rectWidth,
          height: lineHeightPx,
        });
      }
    }
  }

  return rects;
}

// ============================================================================
// hitTestCharOffset — click position to content offset
// ============================================================================

/**
 * Convert a world-space click position to a content offset.
 * Finds the closest inter-character gap on the nearest visual line.
 */
export function hitTestCharOffset(
  worldX: number,
  worldY: number,
  table: CharPositionTable,
  entityX: number,
  entityY: number,
  padding: number
): number {
  const { positions, posToContent, lineOffsets, lineLengths, lineHeightPx } = table;

  if (positions.length === 0) return 0;

  // Determine which line was clicked (by Y coordinate)
  const firstY = positions[0]?.y ?? 0;
  const relY = worldY - firstY;
  let lineIdx = Math.floor(relY / lineHeightPx);
  lineIdx = Math.max(0, Math.min(lineIdx, table.lineCount - 1));

  const lineStart = lineOffsets[lineIdx];
  const lineLen = lineLengths[lineIdx];

  if (lineLen === 0) {
    return posToContent[lineStart] ?? 0;
  }

  // Walk characters in this line, find closest x boundary
  let bestPosIdx = lineStart;
  let bestDist = Infinity;
  let afterLast = false;

  for (let i = 0; i < lineLen; i++) {
    const pos = positions[lineStart + i];
    const distLeft = Math.abs(worldX - pos.x);
    if (distLeft < bestDist) {
      bestDist = distLeft;
      bestPosIdx = lineStart + i;
      afterLast = false;
    }
    const distRight = Math.abs(worldX - (pos.x + pos.width));
    if (distRight < bestDist) {
      bestDist = distRight;
      bestPosIdx = lineStart + i;
      afterLast = true;
    }
  }

  // Convert to content offset
  const contentIdx = posToContent[bestPosIdx] ?? 0;
  return afterLast ? contentIdx + 1 : contentIdx;
}

// ============================================================================
// Line/column conversion (for arrow key navigation)
// ============================================================================

/**
 * Convert a content offset to (visual line, column within that line).
 */
export function contentOffsetToLineColumn(
  contentOffset: number,
  table: CharPositionTable
): { line: number; column: number } {
  const { contentToPos, positions, lineOffsets } = table;

  if (positions.length === 0) return { line: 0, column: 0 };

  const offset = Math.max(0, Math.min(contentOffset, table.contentLength));

  if (offset >= table.contentLength) {
    const lastLine = table.lineCount - 1;
    return { line: lastLine, column: table.lineLengths[lastLine] };
  }

  const posIdx = contentToPos[offset];
  if (posIdx === undefined || posIdx >= positions.length) {
    return { line: table.lineCount - 1, column: table.lineLengths[table.lineCount - 1] };
  }

  const pos = positions[posIdx];
  return { line: pos.line, column: posIdx - lineOffsets[pos.line] };
}

/**
 * Convert (visual line, column) to content offset.
 */
export function lineColumnToContentOffset(
  line: number,
  column: number,
  table: CharPositionTable
): number {
  const { lineOffsets, lineLengths, posToContent, positions } = table;

  const clampedLine = Math.max(0, Math.min(line, table.lineCount - 1));
  const clampedCol = Math.max(0, Math.min(column, lineLengths[clampedLine]));
  const posIdx = lineOffsets[clampedLine] + clampedCol;

  if (posIdx >= positions.length) {
    const last = posToContent[positions.length - 1];
    return last !== undefined ? last + 1 : table.contentLength;
  }

  return posToContent[posIdx] ?? 0;
}

// ============================================================================
// Word / line boundary helpers (for multi-click selection)
// ============================================================================

/** Test if a character is a "word" character (letters, digits, underscore). */
function isWordChar(ch: string): boolean {
  return /\w/.test(ch);
}

/**
 * Find the word boundary around a content offset.
 * Double-click behavior: selects the word under cursor, or whitespace run if on whitespace.
 */
export function getWordBoundary(
  offset: number,
  content: string
): { start: number; end: number } {
  if (content.length === 0) return { start: 0, end: 0 };

  const clampedOffset = Math.max(0, Math.min(offset, content.length));

  // Pick the character at or before cursor to determine class
  const charIdx = clampedOffset > 0 ? clampedOffset - 1 : 0;
  const isWord = isWordChar(content[charIdx]);

  // Walk backward
  let start = clampedOffset;
  while (start > 0 && isWordChar(content[start - 1]) === isWord) {
    start--;
  }

  // Walk forward
  let end = clampedOffset;
  while (end < content.length && isWordChar(content[end]) === isWord) {
    end++;
  }

  return { start, end };
}

/**
 * Find visual line boundary as content offsets.
 * Triple-click behavior: selects the entire visual (wrapped) line.
 */
export function getLineBoundary(
  offset: number,
  table: CharPositionTable
): { start: number; end: number } {
  const { line } = contentOffsetToLineColumn(offset, table);
  const start = lineColumnToContentOffset(line, 0, table);
  const end = lineColumnToContentOffset(line, table.lineLengths[line], table);
  return { start, end };
}

// ============================================================================
// Convenience: build table from entity data
// ============================================================================

/**
 * Build a CharPositionTable for a text entity, performing wrapping internally.
 */
export function buildCharPositionsForEntity(
  content: string,
  fontSize: number,
  lineHeight: number,
  textAlign: 'left' | 'center' | 'right',
  entityWidth: number,
  padding: number,
  entityX: number,
  entityY: number,
  metrics: FontMetrics,
  glyphMap: GlyphMap,
  kerningMap: KerningMap,
  letterSpacing: number
): CharPositionTable {
  const baseFontSize = metrics.info.size;
  const innerWidth = Math.max(1, entityWidth - 2 * padding);
  const maxWidthFontUnits = innerWidth * baseFontSize / fontSize;
  const letterSpacingFontUnits = letterSpacing * baseFontSize / fontSize;

  const lines = wrapTextMSDF(content, maxWidthFontUnits, glyphMap, kerningMap, letterSpacingFontUnits);

  return buildCharPositions(
    content, lines,
    fontSize, lineHeight, textAlign, innerWidth,
    padding, entityX, entityY,
    metrics, glyphMap, kerningMap, letterSpacing
  );
}
