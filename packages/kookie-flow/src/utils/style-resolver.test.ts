import { describe, it, expect } from 'vitest';
import { RADIUS_MAP, WIDGET_RADIUS_MAP, SIZE_MAP, resolveEntityStyle } from './style-resolver';
import { FALLBACK_TOKENS, type ThemeTokens } from '../hooks/useThemeTokens';
import type { EntityRadius, EntitySize } from '../types';

const LEVELS: EntityRadius[] = ['none', 'small', 'medium', 'large', 'full'];
const SIZES: EntitySize[] = ['1', '2', '3', '4', '5'];

/**
 * KookieUI v2's radius scale, at the two levels that matter, read out of the shipped stylesheet.
 *
 * `full` is the level this whole file exists for: the CONTROL family goes to 9999px there and the
 * SURFACE family does not move at all — 24/32/40/48, exactly where `large` leaves it. `:root` with
 * no `data-radius` resolves the same way, which is why an app that never states a level was
 * getting the pill too.
 */
function v2Tokens(level: 'medium' | 'full'): ThemeTokens {
  const control =
    level === 'full'
      ? { '--radius-1': 9999, '--radius-2': 9999, '--radius-3': 9999, '--radius-4': 9999, '--radius-5': 9999 }
      : { '--radius-1': 4, '--radius-2': 6, '--radius-3': 8, '--radius-4': 10, '--radius-5': 12 };
  const surface =
    level === 'full'
      ? { '--radius-surface-1': 24, '--radius-surface-2': 32, '--radius-surface-3': 40, '--radius-surface-4': 48 }
      : { '--radius-surface-1': 12, '--radius-surface-2': 18, '--radius-surface-3': 24, '--radius-surface-4': 30 };
  return { ...FALLBACK_TOKENS, ...control, ...surface };
}

/** The widest a corner can be on a box this size before the SDF clamps it into a capsule. */
const capsuleAt = (w: number, h: number) => Math.min(w, h) / 2;

describe('the radius scale is partitioned by role', () => {
  it('gives the node body a surface token at every level, and never a control one', () => {
    for (const level of LEVELS) {
      const token = RADIUS_MAP[level];
      if (token === 0) continue;
      expect(token).toMatch(/^--radius-surface-[1-4]$/);
    }
  });

  it('gives a widget a control token at every level', () => {
    for (const level of LEVELS) {
      const token = WIDGET_RADIUS_MAP[level];
      if (token === 0) continue;
      expect(token).toMatch(/^--radius-(?:[1-5]|full)$/);
    }
  });

  it('sizes the body off the surface family too, so an unstated radius cannot pill either', () => {
    for (const size of SIZES) {
      expect(SIZE_MAP[size].borderRadius).toMatch(/^--radius-surface-[1-4]$/);
    }
  });
});

describe('no radius level turns a node into a capsule', () => {
  // A default node, and the short one that pills first.
  const BOXES: Array<[number, number]> = [
    [240, 100],
    [240, 305],
  ];

  for (const level of ['medium', 'full'] as const) {
    it(`stays inside the shape at the theme's ${level} level`, () => {
      const tokens = v2Tokens(level);
      for (const entityLevel of LEVELS) {
        const style = resolveEntityStyle('2', 'surface', entityLevel, 'none', false, tokens);
        for (const [w, h] of BOXES) {
          expect(style.borderRadius).toBeLessThan(capsuleAt(w, h));
        }
      }
    });
  }

  it('is the case that would have failed before: full used to resolve 9999', () => {
    const tokens = v2Tokens('full');
    // The old table read `--radius-full` here, which is 9999 at every level of both systems.
    expect(tokens['--radius-full']).toBe(9999);
    expect(resolveEntityStyle('2', 'surface', 'full', 'none', false, tokens).borderRadius).toBe(48);
  });
});

describe('the radius level reaches the controls on the node', () => {
  it('moves a widget with the level rather than pinning it to one number', () => {
    const tokens = v2Tokens('medium');
    const at = (level: EntityRadius) =>
      resolveEntityStyle('2', 'surface', level, 'none', false, tokens).widgetRadius;
    expect(at('none')).toBe(0);
    expect(at('small')).toBe(4);
    expect(at('medium')).toBe(6);
    expect(at('large')).toBe(8);
    // A control at the `full` level is a pill; the shader clamps this to half the widget's box,
    // which is v2's own `calc(control-height / 2)`.
    expect(at('full')).toBe(9999);
  });

  it('leaves the body and the controls on independent families', () => {
    const tokens = v2Tokens('full');
    const style = resolveEntityStyle('2', 'surface', 'full', 'none', false, tokens);
    expect(style.borderRadius).toBe(48); // surface: bounded
    expect(style.widgetRadius).toBe(9999); // control: a pill, clamped to its own box downstream
  });

  it('does not let a body radius override reshape the fields on it', () => {
    const tokens = v2Tokens('medium');
    const style = resolveEntityStyle('2', 'surface', 'medium', 'none', false, tokens, {
      borderRadius: 0,
    });
    expect(style.borderRadius).toBe(0);
    expect(style.widgetRadius).toBe(6);
  });
});
