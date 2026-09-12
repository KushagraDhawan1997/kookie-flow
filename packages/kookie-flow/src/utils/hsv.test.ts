import { describe, it, expect } from 'vitest';
import { hexToHsv, hsvToHex, hsvToRgb } from './hsv';

describe('hsv', () => {
  it('round-trips the primaries and a grey', () => {
    for (const hex of ['#ff0000', '#00ff00', '#0000ff', '#808080', '#000000', '#ffffff', '#3b82f6']) {
      const hsv = hexToHsv(hex);
      expect(hsv).not.toBeNull();
      if (!hsv) continue;
      expect(hsvToHex(hsv[0], hsv[1], hsv[2])).toBe(hex);
    }
  });

  it('reads a three-digit hex and a hash-less one, and rejects the rest', () => {
    expect(hexToHsv('#f00')).toEqual([0, 1, 1]);
    expect(hexToHsv('00ff00')?.[0]).toBeCloseTo(1 / 3, 6);
    expect(hexToHsv('rebeccapurple')).toBeNull();
    expect(hexToHsv(42)).toBeNull();
    expect(hexToHsv('#zzzzzz')).toBeNull();
  });

  it('keeps hue 0 for a grey rather than NaN', () => {
    expect(hexToHsv('#777777')).toEqual([0, 0, 119 / 255]);
  });

  it('wraps hue', () => {
    expect(hsvToRgb(1, 1, 1)).toEqual(hsvToRgb(0, 1, 1));
    expect(hsvToHex(1.5, 1, 1)).toBe('#00ffff');
  });
});
