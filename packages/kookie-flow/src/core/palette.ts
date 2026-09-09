/**
 * The hue palette kookie-flow owns, frozen out of CSS.
 *
 * WHY THIS FILE EXISTS. The socket-type palette and the per-entity accent palette used to name
 * Radix hue tokens — `--purple-10`, `--teal-9` and 40 others — and read them out of the mounted
 * theme. KookieUI v2 does not have them: it ships TEN tone families (neutral, accent, destructive,
 * success, warning, info, blue, green, orange, amber), which is SIX distinct pigments once the
 * aliases collapse, two of them semantically spoken for. A socket palette needs nine mutually
 * distinguishable hues and a per-entity accent needs twenty-six. Those are not meanings a design
 * system should carry; they are a graph's own vocabulary.
 *
 * So the graph owns them. Widening v2's `tones` was the alternative and was rejected: it is about
 * 1.15KB gzipped per family against v2's hard CSS budget gate, roughly 18KB for the sixteen that
 * are missing, and it would make adding a socket type a change to the design system.
 *
 * THE VALUES ARE MEASURED, NOT CHOSEN. Every hex here is what KookieUI v1 resolved in a real
 * browser at the moment of the freeze, read through `color-mix(in srgb, … 100%, transparent 0%)`
 * to force the P3 declarations into sRGB — the same wrapper `readProbe` uses, for the same reason.
 * Re-measure with `harness/spikes/palette-freeze.mjs`. Freezing measured values is what makes the
 * v1 -> v2 swap a port: the graph paints identical pixels on either side of it.
 *
 * MODE. Step 9 is mode-invariant in Radix for every family but grey — measured, 25 of 26 — and
 * v2's steps 9 and 10 are mode-invariant for all ten of its families. Step 10 is NOT: every one
 * of them flips, because it is the hover step and hover moves toward the foreground in light and
 * away from it in dark. A single hex per family would have quietly deleted that flip from every
 * socket dot, so the entries that differ carry both.
 *
 * WHAT THIS DELIBERATELY GIVES UP: a consumer who re-declared `--purple-10` in their own CSS no
 * longer moves the socket colour. That dependency is exactly the one that cannot survive the swap,
 * and the escape is unchanged and better — `socketTypes` takes any CSS colour string verbatim, so
 * an app that wants its own palette states it rather than overriding a token behind our back.
 */

/** A frozen colour: one hex, or one per appearance where the two differ. */
export type FrozenColor = string | { light: string; dark: string };

/**
 * Every hue token kookie-flow used to read from CSS, at the value v1 resolved.
 *
 * Keyed by the ORIGINAL token name so the public vocabulary is untouched: `color: '--purple-10'`
 * in a `socketTypes` map, and `entity.color = 'purple'` through `ACCENT_TOKEN_KEY`, both keep
 * working and both keep meaning the same colour.
 */
export const FROZEN_HUES: Readonly<Record<string, FrozenColor>> = {
  // Step 9 — the solid step. Every family but grey is the same in both appearances.
  '--gray-9': { light: '#8b8d98', dark: '#696e77' },
  '--gold-9': '#978365',
  '--bronze-9': '#a18072',
  '--brown-9': '#ad7f58',
  '--yellow-9': '#ffe629',
  '--amber-9': '#ffc53d',
  '--orange-9': '#f76b15',
  '--tomato-9': '#e54d2e',
  '--red-9': '#e5484d',
  '--ruby-9': '#e54666',
  '--crimson-9': '#e93d82',
  '--pink-9': '#d6409f',
  '--plum-9': '#ab4aba',
  '--purple-9': '#8e4ec6',
  '--violet-9': '#6e56cf',
  '--iris-9': '#5b5bd6',
  '--indigo-9': '#3e63dd',
  '--blue-9': '#0090ff',
  '--cyan-9': '#00a2c7',
  '--teal-9': '#12a594',
  '--jade-9': '#29a383',
  '--green-9': '#30a46c',
  '--grass-9': '#46a758',
  '--lime-9': '#bdee63',
  '--mint-9': '#86ead4',
  '--sky-9': '#7ce2fe',

  // Step 10 — the hover step. Every one of these differs by appearance.
  '--gray-10': { light: '#80838d', dark: '#777b84' },
  '--gold-10': { light: '#8c7a5e', dark: '#a39073' },
  '--bronze-10': { light: '#957468', dark: '#ae8c7e' },
  '--brown-10': { light: '#a07553', dark: '#b88c67' },
  '--yellow-10': { light: '#ffdc00', dark: '#ffff57' },
  '--amber-10': { light: '#ffba18', dark: '#ffd60a' },
  '--orange-10': { light: '#ef5f00', dark: '#ff801f' },
  '--tomato-10': { light: '#dd4425', dark: '#ec6142' },
  '--red-10': { light: '#dc3e42', dark: '#ec5d5e' },
  '--ruby-10': { light: '#dc3b5d', dark: '#ec5a72' },
  '--crimson-10': { light: '#df3478', dark: '#ee518a' },
  '--pink-10': { light: '#cf3897', dark: '#de51a8' },
  '--plum-10': { light: '#a144af', dark: '#b658c4' },
  '--purple-10': { light: '#8347b9', dark: '#9a5cd0' },
  '--violet-10': { light: '#654dc4', dark: '#7d66d9' },
  '--iris-10': { light: '#5151cd', dark: '#6e6ade' },
  '--indigo-10': { light: '#3358d4', dark: '#5472e4' },
  '--blue-10': { light: '#0588f0', dark: '#3b9eff' },
  '--cyan-10': { light: '#0797b9', dark: '#23afd0' },
  '--teal-10': { light: '#0d9b8a', dark: '#0eb39e' },
  '--jade-10': { light: '#26997b', dark: '#27b08b' },
  '--green-10': { light: '#2b9a66', dark: '#33b074' },
  '--grass-10': { light: '#3e9b4f', dark: '#53b365' },
  '--lime-10': { light: '#b0e64c', dark: '#d4ff70' },
  '--mint-10': { light: '#7de0cb', dark: '#a8f5e5' },
  '--sky-10': { light: '#74daf8', dark: '#a8eeff' },
};

/** Resolve a frozen colour for an appearance. */
export function frozenHue(name: string, appearance: 'light' | 'dark'): string | null {
  const v = FROZEN_HUES[name];
  if (v === undefined) return null;
  return typeof v === 'string' ? v : v[appearance];
}
