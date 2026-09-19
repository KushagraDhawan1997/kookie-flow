import { defineConfig } from 'tsup';

export default defineConfig({
  // `core/layout` is its own entry so a server can arrange a graph without loading the canvas:
  // it is pure, and the root entry brings three and React with it.
  entry: ['src/index.ts', 'src/plugins/index.ts', 'src/core/layout.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  // Belt and braces on the design system. tsup auto-externalizes `dependencies` and
  // `peerDependencies` only, and @kookie-ui/react sits in devDependencies as a vendored tarball —
  // so without naming it here a build would BUNDLE the whole design system into dist. It is a
  // peerDependency too, which is what would normally cover it; both, because the failure is
  // silent and only visible in the shipped bytes.
  external: [
    'react',
    'react-dom',
    'three',
    '@react-three/fiber',
    '@react-three/drei',
    '@kookie-ui/react',
  ],
  treeshake: true,
});
