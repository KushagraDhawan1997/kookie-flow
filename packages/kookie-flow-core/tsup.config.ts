import { defineConfig } from 'tsup';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
const entries = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? e.name === 'test'
        ? []
        : entries(join(dir, e.name))
      : /\.tsx?$/.test(e.name) && !e.name.includes('.test.')
        ? [join(dir, e.name)]
        : []
  );
export default defineConfig({
  entry: entries('src'),
  format: ['esm', 'cjs'],
  splitting: true,
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  external: ['zustand'],
});
