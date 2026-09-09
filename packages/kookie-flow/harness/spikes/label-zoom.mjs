/**
 * GL label behaviour across zoom — the regression record for the LOD thresholds.
 *
 * This began as the gate for moving labels off the DOM. It compared both renderers and found
 * two things that decided it: at 1:1 the DOM path garbled output socket labels ("OO 0", "Ou 2"),
 * and at zoom 0.5 it held labels at constant screen size so text overflowed the shrunken nodes.
 * The DOM label path is now deleted, so the comparison arm is gone and what remains is the part
 * still worth running: a sweep that pins when GL stops drawing text.
 *
 *   text-renderer.tsx:57-59  MIN_TEXT_ZOOM 0.15 | MIN_SOCKET_ZOOM 0.35 | MIN_EDGE_ZOOM 0.25
 *
 * A change to any of those shows up here as a step moving to a different zoom row.
 *
 * Usage: node harness/spikes/label-zoom.mjs
 * Writes crops to harness/dist/legibility/ for a human to look at once.
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

const rows = [];

{
  const mode = 'gl';
  const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
  await page.goto(
    `http://127.0.0.1:${port}/index.html?count=24&seed=1&grid=0&preserveBuffer=1`
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

    // No label should be a DOM element any more. A non-zero count here means the DOM label
    // path came back, which is the regression this guards.
    const probe = await page.evaluate(() => {
      let domTextish = 0;
      // Scoped to the flow's container — see the same change in behaviors.mjs. An unscoped sweep
      // answers "is there a text-bearing leaf div on the page", which stops being the same
      // question the moment anything else is mounted beside the canvas.
      for (const el of document.querySelectorAll('[data-kookie-flow-container] div')) {
        if (el.children.length === 0 && (el.textContent ?? '').trim().length > 0) domTextish++;
      }
      window.__harness.resetGl();
      return { domTextish };
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

console.log('\nGL label rendering across zoom. "glInstances" counts instances drawn over ~0.35s;');
console.log('"domText" must stay 0 — a non-zero value means DOM labels returned.\n');
console.log('mode   zoom    domText      glInstances   glDrawCalls');
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
