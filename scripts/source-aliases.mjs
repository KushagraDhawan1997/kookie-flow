/**
 * The library's entry points, mapped to their TypeScript source for an app in this workspace.
 *
 * Each package names its source beside its build with a `kookie-flow-source` export condition.
 * `tsc` follows it through `customConditions`, but the Next bundler has no setting for a custom
 * condition, so without this map an app bundled `dist`: an edit to the library reached the page
 * only after a build, and with no watcher running the docs showed a library days old.
 *
 * Read from each package's own `exports`, so a new entry point needs no second list here.
 */
import { readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PACKAGES = ['core', 'webgl', 'skin', 'react'];

/** @param {string} appDir The app's own directory; the paths returned are relative to it. */
export function sourceAliases(appDir) {
  /** @type {Record<string, string>} */
  const aliases = {};
  for (const name of PACKAGES) {
    const dir = join(root, 'packages', `kookie-flow-${name}`);
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    for (const [subpath, target] of Object.entries(pkg.exports)) {
      const source = target?.['kookie-flow-source'];
      if (typeof source !== 'string') continue;
      const specifier = subpath === '.' ? pkg.name : pkg.name + subpath.slice(1);
      aliases[specifier] = './' + relative(appDir, join(dir, source));
    }
  }
  return aliases;
}
