import { describe, it, expect, vi } from 'vitest';
import { resolveAccentColorRGB, NO_OVERRIDE_SENTINEL } from './accent-colors';
import { FALLBACK_TOKENS } from '../hooks/useThemeTokens';
import type { AccentColor } from '../types';

/**
 * Accent resolution allocates nothing per entity, and an unknown colour still warns rather than
 * killing the canvas.
 *
 * The token key was assembled with a template literal — `--${color}-9` — once per entity per
 * frame, for a key drawn from a closed set of 26. It is a table now, typed
 * `Record<AccentColor, string>`.
 *
 * WHAT THE COMPILER ALREADY PROVES, so no law here restates it: the table has exactly one row per
 * union member (Record + excess property checks, both directions). WHAT IT DOES NOT: that a row's
 * value names a real theme token. The values are typed `string` and the lookup casts to
 * `keyof ThemeTokens | undefined`, so `'--blu-9'` compiles and silently falls back at runtime —
 * one node quietly losing its colour, which nothing else in this suite would see. That cast is the
 * hole this file is pointed at.
 *
 * THE GUARD IS THE POINT OF THE SECOND LAW. `entity.color` is typed and never validated at
 * runtime, so an unknown string out of stored JSON is reachable. The proposed version of this
 * change dropped the `Array.isArray` check; without it the lookup is `undefined`, `value[0]` throws
 * inside `useFrame`, and R3F does not catch frame-loop errors — the canvas would go black rather
 * than warn and carry on with the global accent.
 *
 * FALSIFIED against: a row naming a token that does not exist; a row naming a real token of the
 * wrong shape (`--space-1`, a number); the guard deleted outright, which fails with exactly the
 * `Cannot read properties of undefined (reading '0')` the critic predicted; and a warning added to
 * the absent-colour path. One attempted sabotage SURVIVES and is recorded rather than papered
 * over: weakening the guard to `if (value)` changes no behaviour any input can reach while the
 * rows are right, and the rows being right is what the first law checks.
 */

/**
 * The union, read from its own source rather than restated here.
 *
 * A list copied into a law agrees with the code on the day it is written and silently disagrees
 * afterwards; this one cannot fall behind. It is also the only runtime-reachable statement of the
 * union — the type itself is erased.
 */
const RAW = import.meta.glob('../types/index.ts', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

function unionMembers(): AccentColor[] {
  const src = RAW['../types/index.ts'];
  if (!src) throw new Error(`src/types/index.ts not read; keys: ${Object.keys(RAW).join(', ')}`);
  const decl = src.match(/export type AccentColor =([\s\S]*?);/);
  if (!decl) throw new Error('AccentColor union not found in src/types/index.ts');
  const members = [...decl[1].matchAll(/'([a-z]+)'/g)].map((m) => m[1]);
  if (members.length === 0) throw new Error('AccentColor union parsed empty');
  return members as AccentColor[];
}

describe('accent colour resolution', () => {
  it('every colour in the union resolves to a real theme value', () => {
    const colours = unionMembers();
    // Vacuity guard: the parse must actually have found the union, not one stray quoted word.
    expect(colours.length).toBeGreaterThan(20);

    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      for (const c of colours) {
        const rgb = resolveAccentColorRGB(c, FALLBACK_TOKENS);
        expect(rgb, `${c} fell through to the global accent`).not.toEqual(NO_OVERRIDE_SENTINEL);
        expect(rgb).toHaveLength(3);
        // Not just "some triple": ThemeTokens is a mixed bag — `--space-1` is a number — so a row
        // pointing at a real key of the wrong shape reads as three `undefined`s, which is neither
        // the sentinel nor a crash. Reading the values is what tells that apart from a colour.
        for (const ch of rgb) {
          expect(Number.isFinite(ch), `${c} resolved to ${JSON.stringify(rgb)}`).toBe(true);
          expect(ch).toBeGreaterThanOrEqual(0);
          expect(ch).toBeLessThanOrEqual(1);
        }
      }
      // A colour that resolves is a colour that never warned.
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it('an unknown colour warns and falls back rather than throwing', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      // Not in the union; reachable from stored JSON, which nothing validates.
      const rgb = resolveAccentColorRGB('chartreuse' as AccentColor, FALLBACK_TOKENS);
      expect(rgb).toEqual(NO_OVERRIDE_SENTINEL);
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }
  });

  it('an unknown colour warns ONCE, not once per frame', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      // This is what the caller does: `resolveAccentColorRGB` runs per entity inside `useFrame`, so
      // one bad entity reaches this line sixty times a second. A warning per call is a string build
      // and a console call in the frame loop — worse than the allocation this change removes.
      //
      // A fresh colour per law: the record of what has been reported is module scope, so a colour
      // another law already tripped would make this one pass with no de-duplication at all.
      for (let i = 0; i < 60; i++) {
        expect(resolveAccentColorRGB('vermilion' as AccentColor, FALLBACK_TOKENS)).toEqual(
          NO_OVERRIDE_SENTINEL
        );
      }
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }
  });

  it('no colour at all is the sentinel, silently', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(resolveAccentColorRGB(undefined, FALLBACK_TOKENS)).toEqual(NO_OVERRIDE_SENTINEL);
      // Absence is not a fault: an unstyled node is the ordinary case, and a warning per
      // unstyled node per frame would be the loudest thing in the console.
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
});
