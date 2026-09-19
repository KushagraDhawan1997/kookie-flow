import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // The layout is read from source, as the studio reads it: it is pure, and the library's root
    // entry would bring the canvas with it.
    alias: {
      '@kushagradhawan/kookie-flow/layout': fileURLToPath(new URL('../kookie-flow/src/core/layout.ts', import.meta.url)),
    },
  },
  test: {
    globals: true,
    include: ['src/**/*.test.ts'],
  },
});
