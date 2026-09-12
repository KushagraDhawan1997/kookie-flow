/**
 * HSV for the colour picker: the three numbers a picker's two controls move.
 *
 * Kept as its own tiny module rather than folded into color.ts, which is about resolving CSS
 * colour STRINGS through the browser. This is arithmetic that has to run inside a pointer drag
 * and inside a shader, and both sides have to agree on what hue 0.5 looks like.
 */

export type HSV = [number, number, number];

/** #rrggbb from HSV in 0..1. Always lower-case, always six digits, always with the hash. */
export function hsvToHex(h: number, s: number, v: number): string {
  const [r, g, b] = hsvToRgb(h, s, v);
  const to = (c: number) => Math.round(Math.min(1, Math.max(0, c)) * 255).toString(16).padStart(2, '0');
  return `#${to(r)}${to(g)}${to(b)}`;
}

export function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const hh = ((h % 1) + 1) % 1;
  const i = Math.floor(hh * 6);
  const f = hh * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  switch (i % 6) {
    case 0: return [v, t, p];
    case 1: return [q, v, p];
    case 2: return [p, v, t];
    case 3: return [p, q, v];
    case 4: return [t, p, v];
    default: return [v, p, q];
  }
}

/**
 * HSV from #rgb / #rrggbb, or null for anything else. Hue is 0 for a grey — the picker keeps its
 * own hue across a drag so a grey does not lose the hue strip's position (see the store field).
 */
export function hexToHsv(hex: unknown): HSV | null {
  if (typeof hex !== 'string') return null;
  let s = hex.trim();
  if (s.startsWith('#')) s = s.slice(1);
  if (s.length === 3) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
  if (s.length !== 6 || !/^[0-9a-fA-F]{6}$/.test(s)) return null;
  const n = Number.parseInt(s, 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  const v = max;
  const sat = max === 0 ? 0 : d / max;
  let h = 0;
  if (d > 0) {
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
  }
  return [h, sat, v];
}
