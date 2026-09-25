import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/** The bench only. Separate from the unit config so `pnpm test` never spends money. */
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@kushagradhawan/kookie-flow/layout': fileURLToPath(new URL('../../packages/kookie-flow-core/src/core/layout.ts', import.meta.url)),
    },
  },
  test: {
    include: ['bench/**/*.test.ts'],
    // The bench's progress is the point of watching it run, and vitest holds intercepted console
    // output back until a test ends — which for a sweep is hours.
    disableConsoleIntercept: true,
    testTimeout: 1000 * 60 * 200,
    hookTimeout: 1000 * 60 * 5,
  },
});
