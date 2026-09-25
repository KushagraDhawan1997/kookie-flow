import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/** Server code only: the routes' helpers, the providers' shaping. The browser is Playwright's. */
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@kushagradhawan/kookie-flow/layout': fileURLToPath(new URL('../../packages/kookie-flow-core/src/core/layout.ts', import.meta.url)),
    },
  },
  test: {
    include: ['src/**/*.test.ts'],
  },
});
