import { describe, it, expect } from 'vitest';

/**
 * Nothing decides rendering from the user-agent string.
 *
 * `antialias: !isSafari` was decided by `/^((?!chrome|android).)*safari/i` against
 * `navigator.userAgent`. The regex reads Firefox-on-iOS and every iOS in-app WebView with no
 * `Safari/` token as NOT Safari — so the browsers with the least headroom got a multisampled
 * backbuffer allocated and resolved every frame, and the one it was written to spare was roughly
 * the only one it reached.
 *
 * This is a SOURCE law because the defect is a decision procedure rather than a value. A mounted
 * law can only see the answer this browser gets; it cannot see that the answer came from a string
 * that lies. And once the sniff is gone, an agreement law between two implementations of it has
 * nothing to compare.
 */

declare global {
  interface ImportMeta {
    glob(
      pattern: string,
      options: { query: '?raw'; import: 'default'; eager: true }
    ): Record<string, string>;
  }
}

const RAW = import.meta.glob('../**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true });

/** Strip comments, so the paragraph explaining this does not trip it. */
const code = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('no user-agent sniffing', () => {
  const files = Object.entries(RAW)
    .map(([path, body]) => ({ path: path.replace(/^\.\.\//, ''), body: code(body) }))
    .filter((f) => !/\.test\.tsx?$/.test(f.path));

  it('finds the source tree at all', () => {
    // Vacuity guard: an empty glob makes every assertion below true and meaningless.
    expect(files.length).toBeGreaterThan(20);
  });

  it('nothing reads navigator.userAgent', () => {
    const offenders = files.filter((f) => /navigator\s*\.\s*userAgent/.test(f.body)).map((f) => f.path);
    expect(offenders).toEqual([]);
  });

  it('nothing tests for a browser by name', () => {
    // The regex is the tell even without `userAgent` beside it — a rename or a helper would move
    // the read and keep the decision.
    const offenders = files
      .filter((f) => /\b(isSafari|isChrome|isFirefox|isWebKit)\b/.test(f.body))
      .map((f) => f.path);
    expect(offenders).toEqual([]);
  });
});
