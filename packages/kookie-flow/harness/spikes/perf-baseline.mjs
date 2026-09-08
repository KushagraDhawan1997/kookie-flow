/**
 * Phase-0 performance baseline.
 *
 * The brief asks for frame time and interaction latency at 1K / 10K / 50K nodes, and the point of
 * recording them BEFORE any audit fix is that "perf is measured, not assumed" needs a before to
 * compare an after against.
 *
 * READ THIS BEFORE QUOTING A NUMBER FROM IT
 * ----------------------------------------
 * This machine has no GPU. Everything rasterises through ANGLE/SwiftShader in software (see
 * plans/migration/environment-facts.md). So:
 *
 *   - These numbers are NOT an SLO and must never be quoted as "Flow does N fps".
 *   - They ARE valid for relative comparison: same fixture, same machine, before vs after. That is
 *     the only claim this harness makes, and it is the claim the audit needs.
 *   - Absolute targets require a run on real hardware and must be labelled as such.
 *
 * Frame time is reported as a distribution, never a mean: one 200ms hitch inside a second of 8ms
 * frames averages to something that looks fine and feels broken. p95 is where the stutter lives.
 *
 * RUN IT ON A QUIET MACHINE. This was learned the hard way: a first run measured alongside an
 * audit and a browser-driven behavior suite on 4 cores produced numbers that describe the load,
 * not the library. The harness cannot detect that for you — nothing in-page can see the other
 * processes — so it is a procedural rule, not a guard.
 *
 * Usage:
 *   node harness/spikes/perf-baseline.mjs                 # 1k and 10k
 *   KOOKIE_PERF_SCALES=1000,10000,50000 node ...          # include the 50k run (slow)
 */

import { createServer } from 'node:http';
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
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

const SCALES = (process.env.KOOKIE_PERF_SCALES ?? '1000,10000')
  .split(',')
  .map((n) => Number(n.trim()))
  .filter(Boolean);

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

/** Measure one window: reset counters, do the work, read the distribution back. */
async function window_(page, ms, during) {
  await page.evaluate(() => window.__harness.resetGl());
  const started = Date.now();
  if (during) await during();
  const remaining = ms - (Date.now() - started);
  if (remaining > 0) await page.waitForTimeout(remaining);
  return page.evaluate(() => ({
    frames: window.__harness.frames(),
    gl: window.__harness.gl(),
  }));
}

const results = [];
let renderer = null;

for (const count of SCALES) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  // preserveDrawingBuffer stays OFF here: forcing it changes what the driver may optimise and
  // would bias every timing. Correctness runs turn it on; perf runs must not.
  const t0 = Date.now();
  await page.goto(`http://127.0.0.1:${port}/index.html?count=${count}&seed=1&grid=1`);
  await page.waitForFunction(() => window.__harness !== undefined, { timeout: 120_000 });
  await page.evaluate(() => window.__harness.ready);
  const mountMs = Date.now() - t0;

  if (!renderer) renderer = await describeRenderer(page);

  // Warm up: first frames include shader compilation and buffer allocation, which are real costs
  // but belong to mount, not to steady state.
  await page.waitForTimeout(1500);

  const idle = await window_(page, 2000);

  // Pan: drive real pointer events rather than writing the viewport, so the whole input path is
  // in the measurement — hit testing, the store write, culling, and the buffer rewrite.
  const pan = await window_(page, 2500, async () => {
    await page.mouse.move(640, 400);
    await page.mouse.down({ button: 'middle' });
    for (let i = 0; i < 40; i++) {
      await page.mouse.move(640 + i * 8, 400 + Math.sin(i / 4) * 40);
    }
    await page.mouse.up({ button: 'middle' });
  });

  // Zoom: wheel events across a range, which re-runs culling and LOD at every step.
  const zoom = await window_(page, 2500, async () => {
    await page.mouse.move(640, 400);
    for (let i = 0; i < 30; i++) await page.mouse.wheel(0, i % 2 === 0 ? -120 : 120);
  });

  results.push({ count, mountMs, idle, pan, zoom });
  await page.close();
}

const stamp = {
  renderer: renderer?.renderer ?? 'unknown',
  software: renderer?.software ?? null,
  note: 'Software rasterisation. Relative comparison only — never quote as an absolute fps figure.',
  results,
};

console.log('\n=== Phase-0 perf baseline ===');
console.log('renderer:', stamp.renderer);
console.log('software:', stamp.software, '\n');

const row = (label, f, g) =>
  `  ${label.padEnd(6)} p50 ${String(f.p50 ?? '-').padStart(7)}ms  p95 ${String(
    f.p95 ?? '-'
  ).padStart(7)}ms  max ${String(f.max ?? '-').padStart(8)}ms  fps(p50) ${String(
    f.fps50 ?? '-'
  ).padStart(6)}  draws ${g.drawCalls}`;

for (const r of results) {
  console.log(`${r.count} nodes   (mount ${r.mountMs}ms)`);
  console.log(row('idle', r.idle.frames, r.idle.gl));
  console.log(row('pan', r.pan.frames, r.pan.gl));
  console.log(row('zoom', r.zoom.frames, r.zoom.gl));
  console.log('');
}

const out = join(dist, 'perf-baseline.json');
writeFileSync(out, JSON.stringify(stamp, null, 2));
console.log('baseline ->', out);

await browser.close();
server.close();
