import { describe, expect, it } from 'vitest';
import { MOTION } from './material';

declare global {
  interface ImportMeta {
    glob(
      pattern: string,
      options: { query: '?raw'; import: 'default'; eager: true; exhaustive: true }
    ): Record<string, string>;
  }
}

/**
 * A shader cannot read a custom property, so the GL controls keep their own copy of v2's clocks. A
 * copy drifts the day v2 retunes them — it did on 2026-09-14, to 0.6 of every duration — so the copy
 * is held to the stylesheet this package is installed against. `exhaustive`, because a glob skips
 * node_modules without it.
 */
const SHEETS = Object.values(
  import.meta.glob('../../node_modules/@kookie-ui/react/dist/styles.css', {
    query: '?raw',
    import: 'default',
    eager: true,
    exhaustive: true,
  })
);

/** A duration token in seconds, whether the minifier wrote `48ms` or `.33s`. */
function token(name: string): number {
  if (SHEETS.length !== 1) throw new Error(`expected v2's stylesheet once, read ${SHEETS.length} files`);
  const match = new RegExp(`--${name}:\\s*([\\d.]+)(ms|s)\\b`).exec(SHEETS[0]);
  if (!match) throw new Error(`v2's stylesheet declares no --${name}`);
  return match[2] === 'ms' ? Number(match[1]) / 1000 : Number(match[1]);
}

describe('MOTION', () => {
  it.each([
    ['hoverIn', 'motion-hover-in'],
    ['hoverOut', 'motion-hover-out'],
    ['press', 'motion-press'],
    ['rise', 'motion-rise'],
    ['mark', 'motion-mark'],
    ['ring', 'motion-ring'],
    ['floatingFall', 'floating-fall'],
    ['travelLead', 'motion-travel-lead'],
    ['travelTrail', 'motion-travel-trail'],
  ] as const)("%s is v2's --%s", (key, name) => {
    expect(MOTION[key]).toBeCloseTo(token(name), 6);
  });
});
