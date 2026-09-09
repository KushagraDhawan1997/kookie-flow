import { describe, it, expect, afterEach } from 'vitest';
import { resolveColorToRGB, parseColorToRGB, parsePx } from './color';

/**
 * What jsdom can and cannot answer about colour.
 *
 * jsdom's CSS engine does not resolve `var()` in getComputedStyle and does not implement
 * `color-mix`, so it cannot answer "what colour does this token resolve to". A first draft of this
 * file asserted exactly that and failed — against a fake, not against the code. Those claims are
 * asserted in `harness/spikes/color-formats.mjs` against real Chromium, where ten formats are
 * checked against an independent canvas readback.
 *
 * What jsdom CAN answer is the DOM structure: where the probe element is attached. That is the
 * half of the theme-scope fix that is about the document rather than about CSS, and it is worth
 * having in a tier that runs on every `pnpm test` rather than only under a browser.
 */

const probeIn = (host: ParentNode) => host.querySelector('span[style*="visibility"]');

afterEach(() => {
  document.body.innerHTML = '';
  document.body.removeAttribute('style');
});

describe('the colour probe attaches inside the theme scope', () => {
  it('lives inside .kui-theme when one exists', () => {
    // The probe has to sit inside the theme scope, because that element is what carries the
    // appearance. v2 declares its tokens at `:root` and re-declares them under
    // `[data-appearance]`, so a probe on <body> still resolves a COMPLETE palette — just the
    // root appearance's rather than this Theme's, which is silent rather than loud. (Under v1
    // the same mistake was loud: tokens were scoped to `.radix-themes`, and var(--accent-9)
    // measured rgb(0,0,0) from body against rgb(0,144,255) from inside.)
    const theme = document.createElement('div');
    theme.className = 'kui-theme';
    document.body.appendChild(theme);

    resolveColorToRGB('rgb(10, 20, 30)');

    expect(probeIn(theme)).not.toBeNull();
  });

  it('falls back to <html> when there is no theme element', () => {
    // `themeRoot()` falls back to `document.documentElement`, NOT to <body>, and the two are not
    // interchangeable for this purpose: v2 declares its tokens at `:root`, which IS
    // documentElement, so the fallback probe resolves the root palette rather than nothing. This
    // asserted <body> until the v1 removal moved the fallback, and then measured a fallback the
    // code no longer had.
    resolveColorToRGB('rgb(10, 20, 30)');
    expect(probeIn(document.documentElement)).not.toBeNull();
  });

  it('re-parents when the theme element mounts after first use', () => {
    // The probe is created once and cached, but the theme element mounts after this module first
    // runs — so the host has to be re-checked on every call rather than resolved once.
    resolveColorToRGB('rgb(1, 2, 3)');
    expect(probeIn(document.documentElement)).not.toBeNull();

    const theme = document.createElement('div');
    theme.className = 'kui-theme';
    document.body.appendChild(theme);

    resolveColorToRGB('rgb(1, 2, 3)');
    expect(probeIn(theme)).not.toBeNull();
  });

  it('leaves no colour behind on the probe between calls', () => {
    // A probe that keeps its last value would make the sentinel check read a stale colour and
    // silently return the previous answer for a rejected declaration.
    const theme = document.createElement('div');
    theme.className = 'kui-theme';
    document.body.appendChild(theme);

    resolveColorToRGB('rgb(10, 20, 30)');
    const probe = probeIn(theme) as HTMLElement | null;
    expect(probe).not.toBeNull();
    expect(probe!.style.color).toBe('');
  });
});

describe('the DOM-free parser paths are unaffected', () => {
  it('hex parses without touching the probe', () => {
    expect(parseColorToRGB('#808080').map((v) => Math.round(v * 255))).toEqual([128, 128, 128]);
    expect(parseColorToRGB('#f0a').map((v) => Math.round(v * 255))).toEqual([255, 0, 170]);
  });

  it('rgb() parses without touching the probe', () => {
    expect(parseColorToRGB('rgb(10, 200, 30)').map((v) => Math.round(v * 255))).toEqual([
      10, 200, 30,
    ]);
  });

  it('color(srgb ...) parses without touching the probe', () => {
    // This is the shape `color-mix(in srgb, ...)` produces in a real browser, so the parser has
    // to understand it even though jsdom will never generate it.
    expect(parseColorToRGB('color(srgb 0.2 0.4 0.6)').map((v) => Math.round(v * 255))).toEqual([
      51, 102, 153,
    ]);
  });
});

describe('the measuring probe survives the document being rebuilt', () => {
  /**
   * THE BUG THIS PINS. `parsePx` measures a `calc()` by writing it onto a probe `<div>` and
   * reading the computed width back. The probe was appended to `<body>` exactly once and then
   * trusted to stay there — but it is appended DURING RENDER, while React is still hydrating,
   * so React finds a node the server never sent, reports a hydration mismatch and regenerates
   * that subtree. The probe comes out of the document with it.
   *
   * A detached element computes no width, so every length token read 0. `areTokensValid` reads
   * a zero length as a FAILED READ rather than a real value, so the hook kept FALLBACK_TOKENS —
   * which is dark by construction — and the WebGL canvas painted black under a working light
   * theme. Nothing threw, no token was missing, and the CSS was correct throughout.
   *
   * The colour probe never had this fault because it re-parents on every call. This is the
   * length probe being held to the same rule.
   *
   * ASSERTED STRUCTURALLY, for this file's own stated reason: jsdom does not lay anything out,
   * so `calc(12px * 1)` resolves to nothing here no matter how correctly the probe is attached.
   * Whether the measurement is RIGHT belongs to the browser tier; whether the probe is in the
   * document is a DOM fact, and it is the half that broke.
   */
  const dimensionProbe = () => document.body.querySelector('div[style*="visibility"]');

  it('re-attaches after the document is rebuilt under it', () => {
    parsePx('calc(12px * 1)');
    expect(dimensionProbe()).not.toBeNull();

    // What React's hydration repair does to a node it did not expect.
    document.body.innerHTML = '';
    expect(dimensionProbe()).toBeNull();

    parsePx('calc(12px * 1)');
    expect(dimensionProbe()).not.toBeNull();
  });

  it('does not stack up probes when it is called repeatedly', () => {
    parsePx('calc(1px * 1)');
    parsePx('calc(2px * 1)');
    parsePx('calc(3px * 1)');

    expect(document.body.querySelectorAll('div[style*="visibility"]')).toHaveLength(1);
  });

  it('parses a plain length without needing the probe at all', () => {
    document.body.innerHTML = '';
    expect(parsePx('16px')).toBe(16);
    expect(dimensionProbe()).toBeNull();
  });
});
