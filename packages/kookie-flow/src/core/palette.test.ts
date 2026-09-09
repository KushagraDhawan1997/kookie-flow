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
  // The families a design system DOES supply stay: neutral (every system has greys) and the two
  // semantic ones (v2 ships `destructive` and `success` by those names). What is deleted is what
  // v2 genuinely lacks, which is exactly what the freeze exists for.
  const KEPT = new Set(['--accent-9', '--neutral-9', '--neutral-10', '--destructive-9', '--success-9']);
  for (const k of Object.keys(t)) {
    if (/^--[a-z]+-(9|10)$/.test(k) && !KEPT.has(k)) delete t[k];
  }
  return t as unknown as typeof FALLBACK_TOKENS;
}

describe('the frozen hue palette', () => {
  it('covers every accent colour in the public union', () => {
    // Derived from the union's own source, not restated: a colour added to the API without a
    // frozen hue would resolve to the global accent on v2 and nobody would hear about it.
    const src = Object.keys(FROZEN_HUES).filter((k) => k.endsWith('-9'));
    expect(src.length).toBeGreaterThan(20);
    // Grey, red and green are NOT in the freeze — they are the design system's, as neutral,
    // destructive and success. Asserted so a future re-freeze cannot quietly take them back.
    expect(src).not.toContain('--gray-9');
    expect(Object.keys(FROZEN_HUES)).not.toContain('--gray-10');

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
      25
    );
    // EVERY frozen entry that flips is a -10, and none of the -9s do. That is the shape, not a
    // number: step 9 is Radix's solid step and mode-invariant for every hue; step 10 is the hover
    // step and moves toward the foreground in light, away from it in dark. Grey was the one
    // exception at step 9 and it is no longer frozen — a neutral family is the design system's.
    expect(flipping.every(([k]) => k.endsWith('-10'))).toBe(true);
    expect(flipping.length).toBe(Object.keys(FROZEN_HUES).filter((k) => k.endsWith('-10')).length);

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
