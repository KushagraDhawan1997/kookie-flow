import { expect, it } from 'vitest';
import {
  buildGlyphMap,
  buildKerningMap,
  kerningKey,
  layoutText,
  measureText,
  truncateText,
  wrapTextMSDF,
  populateGlyphBuffers,
  populateMultiLineGlyphBuffers,
  type FontMetrics,
} from './text-layout';
import {
  buildCharPositions,
  hitTestCharOffset,
  lineColumnToContentOffset,
} from './text-cursor-layout';
import { EMBEDDED_FONT_METRICS_REGULAR } from '../core/embedded-font';
const metrics: FontMetrics = {
  ...EMBEDDED_FONT_METRICS_REGULAR,
  info: { ...EMBEDDED_FONT_METRICS_REGULAR.info, size: 20 },
  chars: ['A', '😀', '…'].map((char) => ({
    id: char.codePointAt(0)!,
    x: 0,
    y: 0,
    width: 20,
    height: 20,
    xoffset: 0,
    yoffset: 0,
    xadvance: 22,
    page: 0,
    chnl: 15,
  })),
  kernings: [{ first: 65, second: 0x1f600, amount: -3 }],
};
const glyphs = buildGlyphMap(metrics),
  kernings = buildKerningMap(metrics);
it('measures, wraps, and renders supplementary code points consistently', () => {
  const entry = {
    text: 'A😀',
    position: [0, 0, 0] as [number, number, number],
    fontSize: 20,
    color: '#fff',
  };
  expect(measureText(entry.text, glyphs, kernings)).toBe(41);
  expect(layoutText([entry], metrics, glyphs, kernings)).toHaveLength(2);
  expect(wrapTextMSDF('😀😀😀', 24, glyphs, kernings)).toEqual(['😀', '😀', '😀']);
  const matrices = new Float32Array(32),
    uv = new Float32Array(8),
    colors = new Float32Array(6),
    opacity = new Float32Array(2);
  expect(
    populateGlyphBuffers([entry], metrics, glyphs, kernings, matrices, uv, colors, opacity, 2)
  ).toBe(2);
  expect(
    populateMultiLineGlyphBuffers(
      [
        {
          id: 't',
          lines: [entry.text],
          position: entry.position,
          fontSize: 20,
          lineHeight: 1,
          textAlign: 'left',
          constrainedWidth: 100,
          color: '#fff',
        },
      ],
      metrics,
      glyphs,
      kernings,
      matrices,
      uv,
      colors,
      opacity,
      2
    )
  ).toBe(2);
});
it('uses collision-free supplementary kerning keys and retains legacy BMP keys', () => {
  expect(kerningKey(65, 66)).toBe((65 << 16) | 66);
  expect(kerningKey(65, 0x1f600)).not.toBe(kerningKey(65, 0xf600));
  expect(kerningKey(0x1f600, 65)).not.toBe(kerningKey(0xf600, 65));
});
it('truncates only at codepoint boundaries and caches by font and scale', () => {
  expect(truncateText('😀😀😀', 45, 20, 20, glyphs, kernings)).toBe('😀…');
  const wide = new Map([...glyphs].map(([id, glyph]) => [id, { ...glyph, xadvance: 100 }]));
  expect(truncateText('😀😀😀', 45, 20, 20, wide, kernings)).toBe('…');
  expect(truncateText('😀😀😀', 45, 20, 40, glyphs, kernings)).toBe('😀😀😀');
});
it('keeps cursor offsets in UTF-16 without placing a caret inside a surrogate pair', () => {
  const table = buildCharPositions(
    'A😀',
    ['A😀'],
    20,
    1,
    'left',
    100,
    0,
    0,
    0,
    metrics,
    glyphs,
    kernings,
    0
  );
  expect(table.positions).toHaveLength(2);
  expect(table.contentToPos).toEqual([0, 1, 1]);
  expect(table.posToContent).toEqual([0, 1]);
  expect(hitTestCharOffset(500, table.positions[0].y, table, 0, 0, 0)).toBe(3);
  expect(lineColumnToContentOffset(0, 2, table)).toBe(3);
});
