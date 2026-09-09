import { describe, it, expect } from 'vitest';
import { wrapTextMSDF, type GlyphMap, type KerningMap } from './text-layout';

/**
 * The wrap cache belongs to the font it was built with.
 *
 * Its key was `content|maxWidth|letterSpacing`. The font was not in it. A `clearWrapCache()` export
 * carried the comment "Call when font changes" and had ZERO callers anywhere in the package, so
 * once a paragraph had been wrapped it kept its line breaks for the rest of the session no matter
 * what font it was later drawn in — text overflowing its node, or breaking early, permanently.
 *
 * `clearWrapCache` went with the defect: it was the excuse for leaving the font out of the key,
 * and it was never called.
 *
 * These fixtures are two fonts that differ only in advance width, which is the whole of what
 * wrapping depends on. Nothing here needs a real MSDF atlas.
 */

const NARROW = 50;
const WIDE = 120;

/** A font where every character advances the same amount. */
function font(advance: number): GlyphMap {
  const map: GlyphMap = new Map();
  for (let c = 32; c < 127; c++) {
    map.set(c, { xadvance: advance } as unknown as NonNullable<ReturnType<GlyphMap['get']>>);
  }
  return map;
}

const NO_KERNING: KerningMap = new Map();
const TEXT = 'the quick brown fox jumps over the lazy dog';

describe('wrapTextMSDF is cached per font', () => {
  it('a wider font wraps sooner', () => {
    // The premise the rest of the file rests on: with the same content and the same width budget,
    // these two fonts MUST disagree, or every assertion below is about nothing.
    const narrow = wrapTextMSDF(TEXT, 600, font(NARROW), NO_KERNING);
    const wide = wrapTextMSDF(TEXT, 600, font(WIDE), NO_KERNING);
    expect(wide.length).toBeGreaterThan(narrow.length);
  });

  it('a second font does not inherit the first font\'s line breaks', () => {
    // This is the defect: same content, same width, different font, and the cache answered with
    // the first font's wrap.
    const first = font(NARROW);
    const second = font(WIDE);
    const a = wrapTextMSDF(TEXT, 600, first, NO_KERNING);
    const b = wrapTextMSDF(TEXT, 600, second, NO_KERNING);
    expect(b).not.toEqual(a);
  });

  it('going back to the first font returns the first answer', () => {
    // Round trip: a cache that invalidates forward but not back is still wrong, and this is where
    // "just clear it on change" quietly stops helping.
    const first = font(NARROW);
    const second = font(WIDE);
    const a = wrapTextMSDF(TEXT, 600, first, NO_KERNING);
    wrapTextMSDF(TEXT, 600, second, NO_KERNING);
    const again = wrapTextMSDF(TEXT, 600, first, NO_KERNING);
    expect(again).toEqual(a);
  });

  it('the same font is still cached', () => {
    // The cache has to keep working, or the fix is just a deletion. Identity, not equality:
    // a fresh array means it recomputed.
    const one = font(NARROW);
    const a = wrapTextMSDF(TEXT, 600, one, NO_KERNING);
    const b = wrapTextMSDF(TEXT, 600, one, NO_KERNING);
    expect(b).toBe(a);
  });
});
