import { describe, expect, it } from 'vitest';
import { FALLBACK_TOKENS } from '../hooks/useThemeTokens';
import { TEST_METRICS } from '../test/metrics';
import { resolveSocketLayout, TITLE_LINE_BOX } from './style-resolver';

const EDGE = { ...TEST_METRICS, titleBand: 'edge' as const };

describe('title band', () => {
  it('insets the band by the padding by default', () => {
    const layout = resolveSocketLayout(true, '2', FALLBACK_TOKENS, TEST_METRICS);
    // A line of type with the row's own block inset above and below it.
    expect(layout.titleBand).toBeGreaterThan(TITLE_LINE_BOX);
    expect(layout.marginTop).toBe(layout.padding + layout.titleBand);
  });

  it('makes an edge band one row tall, with the padding below it', () => {
    const inset = resolveSocketLayout(true, '2', FALLBACK_TOKENS, TEST_METRICS);
    const rowInset = (inset.titleBand - TITLE_LINE_BOX) / 2;
    const layout = resolveSocketLayout(true, '2', FALLBACK_TOKENS, EDGE);
    expect(layout.titleBand).toBe(layout.rowHeight);
    // The first row's control sits one padding below the band, as it does from the card's sides.
    expect(layout.marginTop + rowInset - layout.titleBand).toBe(layout.padding);
  });

  it('reserves nothing without an inside title, whatever the band style', () => {
    const inset = resolveSocketLayout(false, '2', FALLBACK_TOKENS, TEST_METRICS);
    const edge = resolveSocketLayout(false, '2', FALLBACK_TOKENS, EDGE);
    expect(edge.titleBand).toBe(0);
    expect(edge.marginTop).toBe(inset.marginTop);
  });
});
