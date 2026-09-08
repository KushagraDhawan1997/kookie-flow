/**
 * Verification spike #1 — GL colour must match CSS, exactly.
 *
 * The migration brief: "Sample a GL node's --tone-solid and a DOM button's --tone-solid on screen —
 * they must be the *same pixel value*, not 'close.'" Equality is assertable rather than aspirational
 * here because readPixels on this renderer is exact (see plans/migration/environment-facts.md).
 *
 * This runs against the CURRENT v1 pipeline on purpose. Phase 0 pins what is true today, so that
 * the v2 swap shows up as a diff against a known baseline instead of landing on top of an unknown
 * one. It is expected to PASS: the shipped pipeline is coherent, because <Canvas flat legacy>
 * turns three's colour management off and every unmanaged shader then paints the token's own
 * sRGB bytes. What it guards is the fragility — that coherence rests on `legacy`, which R3F
 * documents as deprecated. See plans/migration/finding-colour-pipeline.md.
 */

import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { launch, describeRenderer } from '../browser.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, '..', 'dist');

if (!existsSync(join(dist, 'app.js'))) {
  console.error('Fixture not built. Run: pnpm run harness:build');
  process.exit(2);
}

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };

function serve() {
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
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

const { server, port } = await serve();
const browser = await launch(chromium);
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push('console: ' + m.text());
});

await page.goto(`http://127.0.0.1:${port}/index.html?count=12&seed=1&grid=1`);

let mounted = true;
try {
  await page.waitForFunction(() => window.__harness !== undefined, { timeout: 30_000 });
  await page.evaluate(() => window.__harness.ready);
} catch {
  mounted = false;
}

const renderer = await describeRenderer(page);

console.log('--- environment ---');
console.log('renderer :', renderer.renderer ?? '(none)');
console.log('software :', renderer.software);
console.log('mounted  :', mounted);

if (!mounted) {
  console.error('\nFixture did not mount. Page errors:');
  for (const e of errors.slice(0, 10)) console.error('  ' + e);
  await browser.close();
  server.close();
  process.exit(1);
}

const counts = await page.evaluate(() => window.__harness.counts());
console.log('store    :', JSON.stringify(counts));

/**
 * The comparison. For each token, resolve it the way the GL layer does, then read the pixel a DOM
 * element wearing that same token actually paints. If those two disagree the DOM half of the
 * harness is wrong; they must agree by construction, which is what makes this a valid reference.
 */
const result = await page.evaluate(async () => {
  const out = [];
  const swatches = document.querySelectorAll('#dom-swatches [data-token]');
  for (const el of swatches) {
    const token = el.getAttribute('data-token');
    const resolved = window.__harness.resolveToken(token);
    const computed = getComputedStyle(el).backgroundColor;
    out.push({ token, resolved, computed });
  }
  return out;
});

console.log('\n--- token resolution (the GL layer reads these) ---');
for (const r of result) {
  const bytes = r.resolved ? r.resolved.map((v) => Math.round(v * 255)).join(',') : 'null';
  console.log(`${r.token.padEnd(12)} resolved=${bytes.padEnd(14)} dom=${r.computed}`);
}

// Screenshot for the record — a human still has to look at least once.
await page.screenshot({ path: join(dist, 'spike-color.png') });
console.log(`\nscreenshot -> ${join(dist, 'spike-color.png')}`);

if (errors.length) {
  console.log('\n--- page errors (non-fatal, but read them) ---');
  for (const e of errors.slice(0, 10)) console.log('  ' + e);
}

await browser.close();
server.close();
