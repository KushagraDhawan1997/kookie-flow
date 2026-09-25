import { defineConfig } from 'vitest/config';
export default defineConfig({
  resolve: { conditions: ['kookie-flow-source'] },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
});
