import { defineConfig } from 'vitest/config';

/**
 * Two projects, split by what they need to observe.
 *
 * The `include` glob used to be `src/**\/*.test.ts` — extension `.ts` only. A `.test.tsx` file
 * would have been SILENTLY SKIPPED, and "did not run" reads exactly like "passed". That is the
 * same failure this repo has already hit twice (a cached turbo task, and a browser project that
 * could not launch a browser), so both projects glob both extensions.
 */
export default defineConfig({
  resolve: { conditions: ['kookie-flow-source'] },
  ssr: {
    resolve: { conditions: ['kookie-flow-source'] },
    noExternal: [/^@kushagradhawan\/kookie-flow-/],
  },
  test: {
    projects: [
      {
        // Pure logic: graph algorithms, the store, colour maths. No DOM, no GL.
        extends: true,
        test: {
          name: 'unit',
          environment: 'node',
          include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
          exclude: ['src/**/*.dom.test.ts', 'src/**/*.dom.test.tsx'],
          // Vitest empties every stylesheet, a `?raw` one included. v2's is let through so
          // gl/material.test.ts can hold the GL clocks to the tokens v2 actually ships.
          css: { include: [/@kushagradhawan\/kookie-ui-react\/dist\/styles\.css/] },
        },
      },
      {
        // Anything that has to mount. jsdom has no WebGL, so this tier asserts on the DOM and on
        // store state after a synthetic interaction — never on pixels. Pixels live in
        // harness/ (real Chromium, real WebGL).
        extends: true,
        test: {
          name: 'dom',
          environment: 'jsdom',
          include: ['src/**/*.dom.test.ts', 'src/**/*.dom.test.tsx'],
          setupFiles: ['./src/test/setup.ts'],
        },
      },
    ],
  },
});
