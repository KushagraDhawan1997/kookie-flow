import { describe, it, expect, afterEach, vi } from 'vitest';
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
 * What jsdom CAN answer is the DOM structure: where the probe element is attached, and — since
 * the probes became ephemeral — that it is GONE again by the time the call returns. That is the
 * half of the theme-scope fix that is about the document rather than about CSS, and it is worth
 * having in a tier that runs on every `pnpm test` rather than only under a browser.
 */

const probeIn = (host: ParentNode) => host.querySelector('span[style*="visibility"]');

afterEach(() => {
  document.body.innerHTML = '';
  document.body.removeAttribute('style');
});

/** Where a probe was appended to, captured while it was attached. */
function hostsAppendedTo(host: Element, run: () => void): Element[] {
  const seen: Element[] = [];
  const spy = vi.spyOn(host, 'appendChild');
  spy.mockImplementation(((node: Node) => {
    // The real append still happens — the point is to observe the moment, not to prevent it.
    const result = Element.prototype.appendChild.call(host, node);
    if (node instanceof Element) seen.push(node);
    return result;
  }) as typeof host.appendChild);
  try {
    run();
  } finally {
    spy.mockRestore();
  }
  return seen;
}

describe('the colour probe attaches inside the theme scope, and only for the length of the call', () => {
  it('appends into .kui-theme when one exists, and takes it out again', () => {
    // The probe has to sit inside the theme scope while it is read, because that element is what
    // carries the appearance. v2 declares its tokens at `:root` and re-declares them under
    // `[data-appearance]`, so a probe on <body> still resolves a COMPLETE palette — just the root
    // appearance's rather than this Theme's, which is silent rather than loud. (Under v1 the same
    // mistake was loud: tokens were scoped to `.radix-themes`, and var(--accent-9) measured
    // rgb(0,0,0) from body against rgb(0,144,255) from inside.)
    //
    // And it has to be GONE afterwards. Left attached, it is a node the server never sent sitting
    // inside a server-rendered element, and React 19 throws a hydration mismatch on the leftover
    // sibling — which is what the docs app was reporting.
    const theme = document.createElement('div');
    theme.className = 'kui-theme';
    document.body.appendChild(theme);

    const appended = hostsAppendedTo(theme, () => resolveColorToRGB('rgb(10, 20, 30)'));

    expect(appended.map((el) => el.tagName)).toEqual(['SPAN']);
    expect(probeIn(theme)).toBeNull();
  });

  it('appends into <html> when there is no theme element', () => {
    // `themeRoot()` falls back to `document.documentElement`, NOT to <body>, and the two are not
    // interchangeable for this purpose: v2 declares its tokens at `:root`, which IS
    // documentElement, so the fallback probe resolves the root palette rather than nothing.
    const appended = hostsAppendedTo(document.documentElement, () =>
      resolveColorToRGB('rgb(10, 20, 30)')
    );

    expect(appended.map((el) => el.tagName)).toEqual(['SPAN']);
    expect(probeIn(document.documentElement)).toBeNull();
  });

  it('re-hosts when the theme element mounts after first use', () => {
    // The element is created once and cached, but the theme mounts after this module first runs —
    // so the host is resolved on every call rather than once.
    resolveColorToRGB('rgb(1, 2, 3)');

    const theme = document.createElement('div');
    theme.className = 'kui-theme';
    document.body.appendChild(theme);

    const appended = hostsAppendedTo(theme, () => resolveColorToRGB('rgb(1, 2, 3)'));
    expect(appended.map((el) => el.tagName)).toEqual(['SPAN']);
  });

  it('leaves nothing behind anywhere in the document', () => {
    const theme = document.createElement('div');
    theme.className = 'kui-theme';
    document.body.appendChild(theme);

    resolveColorToRGB('rgb(10, 20, 30)');
    resolveColorToRGB('rgb(20, 30, 40)');

    expect(document.querySelectorAll('span[style*="visibility"]')).toHaveLength(0);
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

describe('the measuring probe is attached only while it is being read', () => {
  /**
   * THE BUG THIS PINS, and the diagnosis it used to carry was wrong.
   *
   * `parsePx` measures a `calc()` by writing it onto a probe `<div>` and reading the computed
   * width back. The probe was appended to `<body>` once and then trusted to stay there — and it
   * kept being found detached. The first explanation was that React rejected this node itself;
   * it does not, because React 19 does not treat body children as hydratable. What actually
   * happened was collateral: the COLOUR probe, appended inside the server-rendered `.kui-theme`
   * element during the hydration render, made React throw and client-render the root from
   * scratch, and this element went with the subtree.
   *
   * A detached element computes no width, so every length token read 0. `areTokensValid` reads a
   * zero length as a FAILED READ rather than a real value, so the hook kept FALLBACK_TOKENS —
   * dark by construction — and the WebGL canvas painted black under a working light theme.
   * Nothing threw, no token was missing, and the CSS was correct throughout.
   *
   * Both probes are ephemeral now, so "is it still attached?" is a question with no answer to get
   * wrong.
   *
   * ASSERTED STRUCTURALLY, for this file's own stated reason: jsdom lays nothing out, so
   * `calc(12px * 1)` resolves to nothing here no matter how correctly the probe is attached.
   * Whether the measurement is RIGHT belongs to the browser tier; whether the probe is in the
   * document is a DOM fact, and it is the half that broke.
   */
  const dimensionProbe = () => document.body.querySelector('div[style*="visibility"]');

  it('attaches during the call and detaches before it returns', () => {
    const appended = hostsAppendedTo(document.body, () => parsePx('calc(12px * 1)'));

    expect(appended.map((el) => el.tagName)).toEqual(['DIV']);
    expect(dimensionProbe()).toBeNull();
  });

  it('works again after the document is rebuilt under it', () => {
    parsePx('calc(12px * 1)');
    document.body.innerHTML = '';

    const appended = hostsAppendedTo(document.body, () => parsePx('calc(12px * 1)'));
    expect(appended.map((el) => el.tagName)).toEqual(['DIV']);
  });

  it('does not stack up probes when it is called repeatedly', () => {
    parsePx('calc(1px * 1)');
    parsePx('calc(2px * 1)');
    parsePx('calc(3px * 1)');

    expect(document.body.querySelectorAll('div[style*="visibility"]')).toHaveLength(0);
  });

  it('parses a plain length without needing the probe at all', () => {
    const appended = hostsAppendedTo(document.body, () => {
      expect(parsePx('16px')).toBe(16);
    });
    expect(appended).toHaveLength(0);
  });
});
