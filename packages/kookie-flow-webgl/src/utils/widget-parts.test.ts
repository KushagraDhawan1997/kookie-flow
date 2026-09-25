import { describe, it, expect } from 'vitest';
import {
  vectorDimensions,
  vectorComponent,
  withComponent,
  scrubValue,
  randomSeed,
  segmentIndex,
  parseVectorText,
  SEED_MAX,
} from './widget-parts';
import {
  partIndexAt,
  readPartBoxInto,
  isOnSeedButton,
  seedButtonWidth,
  type WidgetBox,
} from './widget-geometry';

const BOX: WidgetBox = { x: 100, y: 50, width: 240, height: 32 };

describe('vector values', () => {
  it('clamps the component count to 2..4 and defaults to 3', () => {
    expect(vectorDimensions({})).toBe(3);
    expect(vectorDimensions({ dimensions: 1 })).toBe(2);
    expect(vectorDimensions({ dimensions: 9 })).toBe(4);
  });

  it('reads a missing or non-numeric component as 0', () => {
    expect(vectorComponent([1, 'a', Number.NaN], 1)).toBe(0);
    expect(vectorComponent([1, 2], 5)).toBe(0);
    expect(vectorComponent('1,2,3', 0)).toBe(0);
    expect(vectorComponent([4, 5], 1)).toBe(5);
  });

  it('replaces one component in a fresh array of the right length', () => {
    const before = [1, 2];
    const after = withComponent(before, 3, 2, 9);
    expect(after).toEqual([1, 2, 9]);
    expect(after).not.toBe(before);
  });

  it('parses typed text and keeps 0 for what is missing', () => {
    expect(parseVectorText('1, 2.5', 3)).toEqual([1, 2.5, 0]);
    expect(parseVectorText('  ', 3)).toBeNull();
    expect(parseVectorText('a b', 2)).toBeNull();
  });
});

describe('scrubValue', () => {
  it('moves one step per screen pixel for a fine step', () => {
    expect(scrubValue(0, 10, 0.1, undefined, undefined)).toBe(1);
  });

  it('takes four pixels per step for a whole-number step', () => {
    expect(scrubValue(10, 40, 1, undefined, undefined)).toBe(20);
  });

  it('prints without float noise', () => {
    // 0.1 * 3 is 0.30000000000000004 raw.
    expect(scrubValue(0, 3, 0.1, undefined, undefined)).toBe(0.3);
  });

  it('clamps to the ordered min/max pair, however it is written', () => {
    expect(scrubValue(0, -100, 1, 64, 4096)).toBe(64);
    expect(scrubValue(0, 100000, 1, 4096, 64)).toBe(4096);
  });
});

describe('randomSeed', () => {
  it('stays inside an inclusive range', () => {
    expect(randomSeed(5, 7, () => 0)).toBe(5);
    expect(randomSeed(5, 7, () => 0.9999)).toBe(7);
  });

  it('defaults to 0..SEED_MAX', () => {
    expect(randomSeed(undefined, undefined, () => 0.9999999999)).toBe(SEED_MAX);
  });
});

describe('parts geometry', () => {
  it('finds the part under an x, clamped to the box', () => {
    expect(partIndexAt(BOX, 3, 100)).toBe(0);
    expect(partIndexAt(BOX, 3, 181)).toBe(1);
    expect(partIndexAt(BOX, 3, 1000)).toBe(2);
    expect(partIndexAt(BOX, 3, -50)).toBe(0);
  });

  it('writes a part box into the caller rectangle', () => {
    const out = { x: 0, y: 0, width: 0, height: 0 };
    expect(readPartBoxInto(out, BOX, 4, 3)).toEqual({ x: 280, y: 50, width: 60, height: 32 });
  });

  it('puts the seed button at the trailing end, as wide as the field is tall', () => {
    expect(seedButtonWidth(BOX)).toBe(32);
    expect(isOnSeedButton(BOX, 100 + 240 - 10)).toBe(true);
    expect(isOnSeedButton(BOX, 100 + 240 - 40)).toBe(false);
  });

  it('names a segment by its option, or -1', () => {
    expect(segmentIndex(['a', 'b'], 'b')).toBe(1);
    expect(segmentIndex(['a', 'b'], 'c')).toBe(-1);
    expect(segmentIndex(undefined, 'a')).toBe(-1);
  });
});
