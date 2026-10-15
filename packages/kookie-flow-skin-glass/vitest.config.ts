import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { conditions: ['kookie-flow-source'] },
  ssr: {
    resolve: { conditions: ['kookie-flow-source'] },
    noExternal: [/^@kushagradhawan\/kookie-flow-/],
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    // Vitest empties every stylesheet, a `?raw` one included. v2's is let through so
    // motion.test.ts can hold the glass to the tokens v2 actually ships.
    css: { include: [/@kushagradhawan\/kookie-ui-react\/dist\/styles\.css/] },
  },
});
