import { describe, it, expect } from 'vitest';

/**
 * Vite's raw-glob, declared locally rather than pulling `@types/node` or `vite/client` into a
 * package that has neither. This reads the same source text the bundler reads.
 */
declare global {
  interface ImportMeta {
    glob(
      pattern: string,
      options: { query: '?raw'; import: 'default'; eager: true }
    ): Record<string, string>;
  }
}

/**
 * A socket's position is computed in exactly one place.
 *
 * There were FIVE copies of this arithmetic — the socket index, `getSocketPosition`, the edge
 * renderer, the connection line and the socket renderer — and three of the five were wrong, each
 * for a different reason. They are now one function pair in `utils/geometry.ts`, which is the fix;
 * this is what stops a sixth appearing.
 *
 * It has to be a SOURCE law, and the reason is worth stating because it is the same trap that
 * ate the first draft of `socket-index.test.ts`. Now that every caller shares the arithmetic, an
 * agreement test between any two of them passes by construction — sabotaging the shared function
 * moves both sides together, which was measured, three separate ways, all green. A behavioural
 * law cannot see a new private copy either, as long as that copy happens to agree on the day it
 * is written. What is actually being protected is a property of the source, so the source is what
 * gets read.
 */

/** The one file allowed to write it, plus the constants that define it and the barrels. */
const ALLOWED = new Set(['utils/geometry.ts', 'core/constants.ts', 'index.ts', 'utils/index.ts']);

// Rooted at src/ deliberately: globbed from a subdirectory, Vite keys same-directory files as
// `./x.ts` and everything else as `../dir/x.ts`, so the paths a law compares against would depend
// on where the law happens to live.
const RAW = import.meta.glob('./**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true });

/** Strip comments so a law does not fire on the paragraph explaining itself. */
function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

describe('socket geometry has one home', () => {
  const files = Object.entries(RAW)
    .map(([path, body]) => ({ path: path.replace(/^\.\//, ''), body: code(body) }))
    .filter((f) => !/\.test\.tsx?$/.test(f.path));

  it('finds the source tree at all', () => {
    // Vacuity guard: a walk that lists nothing passes every assertion below, and this one is a
    // build-tool feature rather than a filesystem read, so "it resolved to {}" is a real outcome.
    expect(files.length).toBeGreaterThan(20);
    expect(files.some((f) => f.path === 'utils/geometry.ts')).toBe(true);
  });

  it('nothing outside utils/geometry.ts offsets a socket from the entity edge', () => {
    // `SOCKET_OFFSET` is the distance from the body to the socket centre. Naming it anywhere else
    // means re-deriving a socket's X, which is how the index came to sit 12px off its paint.
    const offenders = files
      .filter((f) => !ALLOWED.has(f.path))
      .filter((f) => /\bSOCKET_OFFSET\b/.test(f.body))
      .map((f) => f.path);
    expect(offenders).toEqual([]);
  });

  it('nothing outside utils/geometry.ts reads an explicit socket position', () => {
    // `socket.position` is a 0..1 fraction of the entity height that bypasses row layout. Four
    // files honoured it and the index did not, which put three sockets up to 57.6px from their
    // paint. Any new reader of the field is a new chance to disagree.
    const offenders = files
      .filter((f) => !ALLOWED.has(f.path))
      .filter((f) => /\bsocket\.position\b|\bsocketInfo\.socket\.position\b/.test(f.body))
      .map((f) => f.path);
    expect(offenders).toEqual([]);
  });

  it('nothing re-derives an entity height from the socket counts', () => {
    // `calculateMinEntityHeight` is `max(1, out + in) * rowHeight` — right only when every row is
    // the same height, which stacked sockets, multi-row widgets and explicit socket heights all
    // break. `getEntitySocketLayout().computedHeight` is the one that handles them.
    const offenders = files
      .filter((f) => f.path !== 'utils/style-resolver.ts' && !ALLOWED.has(f.path))
      .filter((f) => /\bcalculateMinEntityHeight\b/.test(f.body))
      .map((f) => f.path);
    // minimap.tsx is a KNOWN remaining caller and is listed rather than hidden: it sizes the
    // minimap's node rectangles, not sockets, so it is a different defect with a different blast
    // radius, and it is not being fixed under cover of this one.
    expect(offenders).toEqual(['components/minimap.tsx']);
  });
});
