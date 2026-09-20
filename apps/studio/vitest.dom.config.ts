import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/** The editor's own code, which needs a window. The unit config is server code and excludes these. */
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@kushagradhawan/kookie-flow/layout': fileURLToPath(
        new URL('../../packages/kookie-flow/src/core/layout.ts', import.meta.url)
      ),
    },
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.dom.test.ts'],
  },
});
