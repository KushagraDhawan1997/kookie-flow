/**
 * Bundle the harness fixture with esbuild.
 *
 * esbuild rather than the package's own tsup config: this builds a browser APP, not the library,
 * and it must NOT inherit the library's externals — React, three and Kookie UI all have to be
 * bundled in for the page to run standalone.
 */
import { build } from 'esbuild';
import { copyFileSync, mkdirSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, 'dist');
const require = createRequire(import.meta.url);

mkdirSync(out, { recursive: true });

await build({
  entryPoints: [join(here, 'fixture', 'app.tsx')],
  bundle: true,
  format: 'esm',
  target: 'chrome120',
  jsx: 'automatic',
  outfile: join(out, 'app.js'),
  define: { 'process.env.NODE_ENV': '"production"' },
  loader: { '.png': 'dataurl' },
  logLevel: 'info',
});

copyFileSync(join(here, 'fixture', 'index.html'), join(out, 'index.html'));
copyFileSync(
  require.resolve('@kookie-ui/react/styles.css'),
  join(out, 'kookie-ui.css')
);
// Media the fixture serves rather than inlines: a video and a glTF are binary formats esbuild has
// no loader for, and a media law that reached the network would fail for reasons unrelated to the
// renderer under test.
const mediaOut = join(out, 'media');
mkdirSync(mediaOut, { recursive: true });
for (const file of readdirSync(join(here, 'fixture', 'media'))) {
  copyFileSync(join(here, 'fixture', 'media', file), join(mediaOut, file));
}

console.log('fixture built ->', out);
