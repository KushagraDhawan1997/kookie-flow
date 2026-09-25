import { describe, it, expect } from 'vitest';
import { hexToRGB, hexToRGBA, parseColorToRGB, parseColorToRGBA } from './color';

/**
 * Hex alpha, and the two answers one token used to have.
 *
 * `hexToRGB` understood `#fff` and `#ffffff` and nothing else, so an 8-digit `#1e1e1eaa` missed its
 * regex and fell to the mid-grey fallback. That alone is a wrong colour. The part that made it
 * genuinely strange is what happened on the OTHER path: a token like `--gray-a3` is resolved by the
 * browser, and the browser answers `rgb(...)` on an sRGB display and `color(display-p3 ...)` on a
 * P3 one. The `color(...)` branch understood alpha; the hex branch did not. So the same token
 * produced two different colours depending on the monitor, and nothing anywhere raised a word.
 *
 * That is the half of this that is unconditionally true today, and it is what makes the fix a
 * prerequisite for the v2 port rather than a nicety: v2's `--tone-a*` roles are alpha tokens, and
 * wiring them onto a parser that discards alpha turns a silent divergence into visible pixels.
 */

describe('hex alpha', () => {
  it('an 8-digit hex is not mid-grey', () => {
    // The exact shape from the finding. Before: [0.5, 0.5, 0.5] — the fallback, not the colour.
    const [r, g, b, a] = hexToRGBA('#1e1e1eaa');
    expect(Math.round(r * 255)).toBe(0x1e);
    expect(Math.round(g * 255)).toBe(0x1e);
    expect(Math.round(b * 255)).toBe(0x1e);
    expect(Math.round(a * 255)).toBe(0xaa);
  });

  it('4-digit shorthand expands like 3-digit does', () => {
    const [r, g, b, a] = hexToRGBA('#f0a8');
    expect([r, g, b, a].map((v) => Math.round(v * 255))).toEqual([0xff, 0x00, 0xaa, 0x88]);
  });

  it('a hex with no alpha is opaque, not transparent', () => {
    // The guard against over-fixing: defaulting the missing channel to 0 would make every existing
    // colour in the package invisible.
    expect(hexToRGBA('#1e1e1e')[3]).toBe(1);
    expect(hexToRGBA('#fff')[3]).toBe(1);
  });

  it('the RGB entry point still drops alpha and keeps its length', () => {
    // `hexToRGB` is a published export. It must keep answering three numbers.
    const rgb = hexToRGB('#1e1e1eaa');
    expect(rgb).toHaveLength(3);
    expect(rgb.map((v) => Math.round(v * 255))).toEqual([0x1e, 0x1e, 0x1e]);
  });

  it('the two entry points agree on the same string', () => {
    // The divergence this whole item is about, asserted directly: one input, one answer.
    for (const hex of ['#1e1e1eaa', '#f0a8', '#ffffff', '#000']) {
      expect(parseColorToRGB(hex)).toEqual(parseColorToRGBA(hex).slice(0, 3));
    }
  });

  it('an alpha hex and its rgba() equivalent agree', () => {
    // This is the gamut divergence stated as an equality. `rgba()` is what an sRGB browser hands
    // back for an alpha token; the hex form is what a stylesheet or a consumer prop carries. They
    // described the same colour and did not resolve to it.
    const viaHex = parseColorToRGBA('#1e1e1eaa');
    const viaRgba = parseColorToRGBA('rgba(30, 30, 30, 0.667)');
    for (let i = 0; i < 3; i++) expect(viaHex[i]).toBeCloseTo(viaRgba[i], 5);
    expect(viaHex[3]).toBeCloseTo(viaRgba[3], 2);
  });

  it('garbage is still the grey fallback, not a crash', () => {
    // The fallback has to survive: it is what stops a typo taking the canvas down.
    expect(hexToRGBA('#12345')).toEqual([0.5, 0.5, 0.5, 1]);
    expect(hexToRGBA('#zzzzzz')).toEqual([0.5, 0.5, 0.5, 1]);
    // An untyped consumer of the published export used to get grey here rather than a TypeError.
    expect(hexToRGBA(0xfff as unknown as string)).toEqual([0.5, 0.5, 0.5, 1]);
  });

  it('hashless input works, as the old regex already claimed it did', () => {
    // The old code tested `hex.length === 4` against the UN-sliced string, so hashless 'abcd' lost
    // its first character and parsed as '#bbccdd', while the regex beside it wrote the '#' as
    // optional. Reconciling code with its own stated contract; no in-tree caller reaches it.
    expect(hexToRGB('fff')).toEqual([1, 1, 1]);
    expect(hexToRGBA('abcd').map((v) => Math.round(v * 255))).toEqual([0xaa, 0xbb, 0xcc, 0xdd]);
  });
});
