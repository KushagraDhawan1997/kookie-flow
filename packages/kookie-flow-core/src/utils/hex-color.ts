export type RGBColor = [number, number, number];

export type RGBAColor = [number, number, number, number];

const HEX_RE = /^([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})?$/i;

export function hexToRGBA(hex: string): RGBAColor {
  // typeof rather than a bare startsWith: `hexToRGB` is a public export and an untyped consumer
  // passing a number used to get the grey fallback rather than a TypeError.
  if (typeof hex !== 'string') return [0.5, 0.5, 0.5, 1];

  const body = hex.charCodeAt(0) === 35 /* # */ ? hex.slice(1) : hex;
  // Expand shorthand AFTER dropping the '#': the old code tested `hex.length === 4` on the
  // un-sliced string, so hashless 'abcd' had its first character dropped and parsed as '#bbccdd'
  // while its own regex advertised the '#' as optional.
  const full =
    body.length === 3 || body.length === 4
      ? body
          .split('')
          .map((c) => c + c)
          .join('')
      : body;

  const m = HEX_RE.exec(full);
  if (!m) return [0.5, 0.5, 0.5, 1];

  return [
    parseInt(m[1], 16) / 255,
    parseInt(m[2], 16) / 255,
    parseInt(m[3], 16) / 255,
    m[4] === undefined ? 1 : parseInt(m[4], 16) / 255,
  ];
}

export function hexToRGB(hex: string): RGBColor {
  const [r, g, b] = hexToRGBA(hex);
  return [r, g, b];
}
