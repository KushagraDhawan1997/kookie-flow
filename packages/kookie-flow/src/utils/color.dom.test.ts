import { describe, it, expect, afterEach } from 'vitest';
import { resolveColorToRGB, parseColorToRGB } from './color';

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
  it('lives inside .radix-themes when one exists', () => {
    // Tokens are scoped to the theme element, so a probe on <body> cannot see them. Measured in
    // a real browser: var(--accent-9) resolves to rgb(0,0,0) from body and rgb(0,144,255) from
    // inside the theme.
    const theme = document.createElement('div');
    theme.className = 'radix-themes';
    document.body.appendChild(theme);

    resolveColorToRGB('rgb(10, 20, 30)');

    expect(probeIn(theme)).not.toBeNull();
  });

  it('falls back to body when there is no theme element', () => {
    resolveColorToRGB('rgb(10, 20, 30)');
    expect(probeIn(document.body)).not.toBeNull();
  });

  it('re-parents when the theme element mounts after first use', () => {
    // The probe is created once and cached, but the theme element mounts after this module first
    // runs — so the host has to be re-checked on every call rather than resolved once.
    resolveColorToRGB('rgb(1, 2, 3)');
    expect(probeIn(document.body)).not.toBeNull();

    const theme = document.createElement('div');
    theme.className = 'radix-themes';
    document.body.appendChild(theme);

    resolveColorToRGB('rgb(1, 2, 3)');
    expect(probeIn(theme)).not.toBeNull();
  });

  it('leaves no colour behind on the probe between calls', () => {
    // A probe that keeps its last value would make the sentinel check read a stale colour and
    // silently return the previous answer for a rejected declaration.
    const theme = document.createElement('div');
    theme.className = 'radix-themes';
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
