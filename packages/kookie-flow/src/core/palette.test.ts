import { describe, it, expect, vi } from 'vitest';
import { FROZEN_HUES, frozenHue } from './palette';
import { resolveAccentColorRGB, NO_OVERRIDE_SENTINEL } from '../utils/accent-colors';
import { FALLBACK_TOKENS } from '../hooks/useThemeTokens';
import type { AccentColor } from '../types';

/**
 * The frozen palette carries the graph's own hues, and the point of it is that it becomes the live
 * path the moment the tokens stop existing — which is exactly what the v2 swap does.
 *
 * These laws are written against a theme with NO hue tokens in it, because that is the state the
 * migration produces and the state in which the freeze either works or silently paints grey.
 */

/** A theme that resolves no hue token at all — v2's shape for these 42 names. */
function themeWithoutHues(appearance: 'light' | 'dark') {
  const t = { ...FALLBACK_TOKENS, appearance } as Record<string, unknown>;
  for (const k of Object.keys(t)) {
    if (/^--[a-z]+-(9|10)$/.test(k) && k !== '--accent-9') delete t[k];
  }
  return t as unknown as typeof FALLBACK_TOKENS;
}

describe('the frozen hue palette', () => {
  it('covers every accent colour in the public union', () => {
    // Derived from the union's own source, not restated: a colour added to the API without a
    // frozen hue would resolve to the global accent on v2 and nobody would hear about it.
    const src = Object.keys(FROZEN_HUES).filter((k) => k.endsWith('-9'));
    expect(src.length).toBeGreaterThan(20);

    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      for (const appearance of ['light', 'dark'] as const) {
        const tokens = themeWithoutHues(appearance);
        for (const key of src) {
          const colour = key.slice(2, -2) as AccentColor;
          const rgb = resolveAccentColorRGB(colour, tokens);
          expect(rgb, `${colour} fell back to the global accent in ${appearance}`).not.toEqual(
            NO_OVERRIDE_SENTINEL
          );
          for (const ch of rgb) {
            expect(Number.isFinite(ch)).toBe(true);
            expect(ch).toBeGreaterThanOrEqual(0);
            expect(ch).toBeLessThanOrEqual(1);
          }
        }
      }
      expect(spy, 'a covered colour warned').not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it('keeps the appearance flip where v1 had one', () => {
    // The hover step moves toward the foreground in light and away from it in dark. A single hex
    // per family would have deleted that from every socket dot, silently — the census sees names,
    // and nothing in the repo read a socket's painted colour before this migration.
    const flipping = Object.entries(FROZEN_HUES).filter(([, v]) => typeof v !== 'string');
    expect(flipping.length, 'nothing flips — the freeze collapsed both appearances into one').toBe(
      27
    );
    // Every -10 flips; only grey flips at -9. Stated as the shape, not as a count alone.
    expect(flipping.filter(([k]) => k.endsWith('-10')).length).toBe(26);
    expect(flipping.filter(([k]) => k.endsWith('-9')).map(([k]) => k)).toEqual(['--gray-9']);

    for (const [name] of flipping) {
      expect(frozenHue(name, 'light')).not.toEqual(frozenHue(name, 'dark'));
    }
  });

  it('is measured values, not invented ones', () => {
    // Spot-checks against Radix's published scale, which is where v1's values come from. If a
    // regeneration of this table drifts, these are the three that say so.
    expect(frozenHue('--purple-9', 'light')).toBe('#8e4ec6');
    expect(frozenHue('--teal-10', 'dark')).toBe('#0eb39e');
    expect(frozenHue('--blue-10', 'light')).toBe('#0588f0');
    // And every value is a real six-digit hex, which a hand-edit is most likely to break.
    for (const v of Object.values(FROZEN_HUES)) {
      for (const hex of typeof v === 'string' ? [v] : [v.light, v.dark]) {
        expect(hex, `${hex} is not a six-digit hex`).toMatch(/^#[0-9a-f]{6}$/);
      }
    }
  });

  it('an unknown name is not silently a colour', () => {
    expect(frozenHue('--chartreuse-9', 'light')).toBeNull();
    expect(frozenHue('--purple-9', 'light')).not.toBeNull();
  });
});
