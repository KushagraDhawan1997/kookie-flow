/**
 * The colour path of the GL widget layer.
 *
 * `writeColor` replaced a function that returned a fresh `[r, g, b]` tuple, because the caller is
 * the per-widget loop inside `useFrame` and it ran that once per widget on every frame of a pan.
 * The tuple was only ever read three times and dropped, so it now writes into the instance buffer
 * directly. These tests hold the two things that refactor could have broken: that it writes the
 * three components at the offset it was given and nowhere else, and that the parse — including
 * every fallback to mid-grey — still says what it said.
 */

import { describe, it, expect } from 'vitest';
import { writeColor, colorOf } from './widgets-gl';

describe('writeColor', () => {
  it('writes three components at the offset and leaves its neighbours alone', () => {
    const buffer = new Float32Array(9).fill(-1);
    writeColor('#ff0000', buffer, 3);
    expect(buffer[3]).toBe(1);
    expect(buffer[4]).toBe(0);
    expect(buffer[5]).toBe(0);
    // The instances either side of it belong to other widgets.
    expect(Array.from(buffer.slice(0, 3))).toEqual([-1, -1, -1]);
    expect(Array.from(buffer.slice(6, 9))).toEqual([-1, -1, -1]);
  });

  it('parses each channel out of its own byte', () => {
    const buffer = new Float32Array(3);
    writeColor('#0080ff', buffer, 0);
    expect(buffer[0]).toBe(0);
    expect(buffer[1]).toBeCloseTo(128 / 255, 5);
    expect(buffer[2]).toBe(1);
  });

  it('takes a hex with no leading hash, and trims surrounding space', () => {
    const buffer = new Float32Array(3);
    writeColor('  00ff00  ', buffer, 0);
    expect(Array.from(buffer)).toEqual([0, 1, 0]);
  });

  it('falls back to mid-grey rather than throwing, for anything unparseable', () => {
    for (const value of [undefined, null, 42, '#f00', 'rebeccapurple', '', '#zzzzzz']) {
      const buffer = new Float32Array(3).fill(-1);
      writeColor(value, buffer, 0);
      expect(buffer[0]).toBeCloseTo(0.5, 5);
      expect(buffer[1]).toBeCloseTo(0.5, 5);
      expect(buffer[2]).toBeCloseTo(0.5, 5);
    }
  });
});

describe('colorOf', () => {
  it('agrees with writeColor, and hands back a tuple the caller owns', () => {
    const buffer = new Float32Array(3);
    writeColor('#123456', buffer, 0);
    const tuple = colorOf('#123456');
    expect(tuple[0]).toBeCloseTo(buffer[0], 5);
    expect(tuple[1]).toBeCloseTo(buffer[1], 5);
    expect(tuple[2]).toBeCloseTo(buffer[2], 5);

    // Not a shared scratch array: two results must not be the same object, or a caller holding
    // one while asking for another would find the first had changed underneath it.
    const other = colorOf('#ffffff');
    expect(other).not.toBe(tuple);
    expect(tuple).toEqual([0x12 / 255, 0x34 / 255, 0x56 / 255]);
    expect(other).toEqual([1, 1, 1]);
  });
});
