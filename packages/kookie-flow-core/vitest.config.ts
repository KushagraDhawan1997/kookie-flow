import { defineConfig } from 'vitest/config';
export default defineConfig({
  resolve: { conditions: ['kookie-flow-source'] },
  test: { environment: 'node', include: ['src/**/*.test.ts', 'src/**/*.test.tsx'] },
});
