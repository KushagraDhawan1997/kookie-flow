/**
 * The legibility gate for moving labels from DOM to GL.
 *
 * Both label renderers ship today, switched by `textRenderMode`. Flipping the default to 'webgl'
 * and deleting the DOM path is only defensible if GL labels are at least as usable, so this
 * measures rather than assumes — and it measures the thing that actually differs.
 *
 * The two paths do NOT agree on when to hide text:
 *
 *   GL   (text-renderer.tsx:57-59)  MIN_TEXT_ZOOM 0.15 | MIN_SOCKET_ZOOM 0.35 | MIN_EDGE_ZOOM 0.25
 *   DOM  (dom-layer.tsx:40-41)      MIN_ZOOM_FOR_LABELS 0.10, plus an 8px screen-size floor
 *
 * So socket labels vanish at zoom 0.35 under GL and survive to 0.10 under DOM. That is an
 * observable behavior change and the brief requires it be deliberate and logged, not discovered.
 *
 * Usage: node harness/spikes/label-legibility.mjs
 * Writes side-by-side crops to harness/dist/legibility/ for a human to look at once.
 */

import { createServer } from 'node:http';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { launch } from '../browser.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, '..', 'dist');
const outDir = join(dist, 'legibility');

if (!existsSync(join(dist, 'app.js'))) {
  console.error('Fixture not built. Run: pnpm run harness:build');
  process.exit(2);
}
mkdirSync(outDir, { recursive: true });

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

/** Zooms chosen to straddle every threshold either renderer declares. */
const ZOOMS = [1, 0.5, 0.36, 0.34, 0.26, 0.24, 0.16, 0.14, 0.1];
const MODES = ['dom', 'webgl'];

const rows = [];

for (const mode of MODES) {
  const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
  await page.goto(
    `http://127.0.0.1:${port}/index.html?count=24&seed=1&textRenderMode=${mode}&grid=0&preserveBuffer=1`
  );
  await page.waitForFunction(() => window.__harness !== undefined, { timeout: 30_000 });
  await page.evaluate(() => window.__harness.ready);

  for (const zoom of ZOOMS) {
    await page.evaluate((z) => {
      const store = window.__harness.store;
      store.getState().setViewport({ x: 40, y: 40, zoom: z });
    }, zoom);

    // Let culling, LOD and the buffer rewrite settle. Both paths update on a rAF cadence.
    await page.waitForTimeout(400);

    const probe = await page.evaluate(() => {
      // DOM path: labels are real elements, so count them.
      const domLabels = document.querySelectorAll(
        '[data-entity-label], [data-socket-label], [data-edge-label]'
      ).length;
      // Fall back to counting text-bearing divs in the overlay when there are no data hooks.
      const overlay = document.querySelectorAll('div');
      let domTextish = 0;
      for (const el of overlay) {
        if (el.children.length === 0 && (el.textContent ?? '').trim().length > 0) domTextish++;
      }
      window.__harness.resetGl();
      return { domLabels, domTextish };
    });

    // GL path: one frame's instance count is the number of glyph quads drawn.
    await page.waitForTimeout(350);
    const gl = await page.evaluate(() => window.__harness.gl());

    const file = join(outDir, `${mode}-zoom${String(zoom).replace('.', '_')}.png`);
    await page.screenshot({ path: file });

    rows.push({
      mode,
      zoom,
      domTextish: probe.domTextish,
      instancedDrawCalls: gl.instancedDrawCalls,
      instancesDrawn: gl.instancesDrawn,
    });
  }
  await page.close();
}

console.log('\nLabel rendering across zoom. "instancesDrawn" counts GL glyph quads over ~0.35s;');
console.log('"domTextish" counts leaf DOM elements carrying text.\n');
console.log('mode   zoom    domTextish   glInstances   glDrawCalls');
for (const r of rows) {
  console.log(
    `${r.mode.padEnd(6)} ${String(r.zoom).padEnd(7)} ${String(r.domTextish).padEnd(12)} ${String(
      r.instancesDrawn
    ).padEnd(13)} ${r.instancedDrawCalls}`
  );
}

console.log(`\ncrops -> ${outDir}`);

await browser.close();
server.close();
