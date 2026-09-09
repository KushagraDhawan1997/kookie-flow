/**
 * Which theme tokens does the GL layer actually get?
 *
 * The token reader takes a fallback for anything it cannot find, and the whole fallback table is
 * DARK. So a theme that is missing tokens produces no error, no warning and nothing obviously
 * wrong in dark mode — it paints dark constants into a light UI, one token at a time.
 *
 * The behaviour suite asserts the census is clean. This prints it, which is what you want while
 * porting a theme: the list, grouped, so the work is visible rather than a pass/fail.
 *
 * Usage:  node harness/spikes/token-census.mjs
 */

import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { launch } from '../browser.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, '..', 'dist');

if (!existsSync(join(dist, 'app.js'))) {
  console.error('Fixture not built. Run: pnpm run harness:build');
  process.exit(2);
}

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const server = createServer((req, res) => {
  const url = (req.url ?? '/').split('?')[0];
  const file = join(dist, url === '/' ? 'index.html' : url.slice(1));
  if (!existsSync(file)) {
    res.writeHead(404);
    return res.end('not found');
  }
  res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
  res.end(readFileSync(file));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

const browser = await launch(chromium);
const page = await browser.newPage();
page.on('pageerror', (e) => console.error('PAGE ERROR', String(e)));
await page.goto(`http://127.0.0.1:${port}/index.html?count=6`);
await page.waitForFunction(() => window.__harness !== undefined, { timeout: 60_000 });
await page.evaluate(() => window.__harness.ready);

const { present, missing } = await page.evaluate(() => window.__harness.tokenCensus());

// Also report what each present token RESOLVES to, because "defined" and "sensible" are different
// questions and the second one is what a port gets wrong.
const values = await page.evaluate((keys) => {
  const root = document.querySelector('.radix-themes') ?? document.body;
  const styles = getComputedStyle(root);
  return Object.fromEntries(keys.map((k) => [k, styles.getPropertyValue(k).trim()]));
}, present);

const group = (k) => k.replace(/^--/, '').replace(/-?\d+$/, '').replace(/-a$/, '-alpha') || 'other';
const groups = new Map();
for (const k of [...present, ...missing]) {
  const g = group(k);
  if (!groups.has(g)) groups.set(g, { present: [], missing: [] });
  groups.get(g)[missing.includes(k) ? 'missing' : 'present'].push(k);
}

console.log(`\ntoken census — ${present.length} present, ${missing.length} missing\n`);
for (const [g, { present: p, missing: m }] of [...groups].sort()) {
  const mark = m.length === 0 ? 'ok  ' : 'MISS';
  console.log(`  ${mark} ${g.padEnd(18)} ${p.length} present${m.length ? `, ${m.length} missing` : ''}`);
  for (const k of m) console.log(`         ${k}`);
}

if (missing.length === 0) {
  console.log('\n  every token the reader asks for is defined. Sample of resolved values:\n');
  for (const k of present.slice(0, 8)) console.log(`    ${k.padEnd(20)} ${values[k]}`);
} else {
  console.log(
    `\n  ${missing.length} tokens fall back to a DARK constant. In a light theme those are` +
      '\n  hardcoded dark values painted into the canvas, silently.\n'
  );
}
console.log('');

await browser.close();
server.close();
process.exit(missing.length ? 1 : 0);
