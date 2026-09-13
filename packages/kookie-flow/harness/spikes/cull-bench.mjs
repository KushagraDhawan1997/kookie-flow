/**
 * What the viewport cull costs, per frame, as the graph grows.
 *
 * WHY THIS EXISTS ALONGSIDE perf-baseline.mjs. That harness measures wall-clock frame time in a
 * real browser, which is the right instrument for the whole pipeline — and the wrong one here.
 * This machine has no GPU: everything rasterises through SwiftShader at hundreds of milliseconds a
 * frame (plans/migration/environment-facts.md), so a CPU saving of a few milliseconds is three
 * orders of magnitude below the noise floor. The browser harness cannot see this change at all.
 *
 * So this measures the JS directly, in node, with nothing else in the frame: the per-frame work a
 * GL layer does to decide WHAT to draw, in the two shapes the layers have had.
 *
 *   scan      what every layer did — walk `entities` and test each one's box against the viewport
 *   quadtree  what they do now — one spatial range query into a reused array
 *   pan       forty frames of a continuous pan, with the hysteresis margin the layers use, so the
 *             frames a pan is allowed to SKIP are counted rather than assumed
 *
 * The numbers are a CPU-time ratio on one machine, not an fps figure, and they are only comparable
 * against each other. Run: node harness/spikes/cull-bench.mjs
 */

import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, '..', '..', 'src');

// The measured code is TypeScript. Bundle exactly the two modules this needs into one ESM file
// rather than pulling a test runner in to transpile.
const tmp = mkdtempSync(join(tmpdir(), 'kookie-cull-'));
const entry = join(tmp, 'entry.ts');
writeFileSync(
  entry,
  `export { Quadtree, getEntityBounds } from '${join(src, 'core', 'spatial').replace(/\\/g, '/')}';\n` +
    `export { inflateViewRect, viewEscaped, worldViewRect } from '${join(src, 'utils', 'viewport-cull').replace(/\\/g, '/')}';\n`
);
const out = join(tmp, 'bundle.mjs');
await build({ entryPoints: [entry], bundle: true, format: 'esm', outfile: out, logLevel: 'silent' });
const { Quadtree, getEntityBounds, inflateViewRect, viewEscaped, worldViewRect } = await import(out);

const VIEW_W = 1280;
const VIEW_H = 800;
const CULL_PAD = 300;

/** A grid of entities the size of a real board: 240x100 cards on a 300x200 pitch. */
function makeEntities(count) {
  const cols = Math.ceil(Math.sqrt(count));
  const entities = [];
  for (let i = 0; i < count; i++) {
    entities.push({
      id: `e${i}`,
      type: 'default',
      data: {},
      position: { x: (i % cols) * 300, y: Math.floor(i / cols) * 200 },
      width: 240,
      height: 100,
    });
  }
  return entities;
}

/** The loop every layer used to run: the whole array, one box test each. */
function scanVisible(entities, left, right, top, bottom, out) {
  let n = 0;
  for (let i = 0; i < entities.length; i++) {
    const e = entities[i];
    const w = e.width;
    const h = e.height;
    if (
      e.position.x + w < left - CULL_PAD ||
      e.position.x > right + CULL_PAD ||
      e.position.y + h < top - CULL_PAD ||
      e.position.y > bottom + CULL_PAD
    ) {
      continue;
    }
    out[n++] = e.id;
  }
  return n;
}

function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

/** Time one frame's work, repeated, reporting the median so a GC pause does not set the number. */
function timeFrames(frames, fn) {
  const times = [];
  for (let f = 0; f < frames; f++) {
    const t0 = performance.now();
    fn(f);
    times.push(performance.now() - t0);
  }
  return median(times);
}

const SCALES = (process.env.KOOKIE_CULL_SCALES ?? '1000,10000,50000')
  .split(',')
  .map((n) => Number(n.trim()))
  .filter(Boolean);

console.log('\n=== viewport cull: per-frame CPU ===');
console.log('median of 200 frames, one layer, 1280x800 view. Ratios only — not an fps figure.\n');
console.log(
  '  nodes    visible   scan/frame   quadtree/frame   speedup   pan(40f): scan   hysteresis   speedup'
);

for (const count of SCALES) {
  const entities = makeEntities(count);
  const qt = new Quadtree({ x: -10000, y: -10000, width: 20000, height: 20000 });
  qt.rebuild(entities);

  const scanOut = [];
  const qtOut = [];
  const query = { x: 0, y: 0, width: 0, height: 0 };

  // A viewport somewhere in the middle of the board.
  const vp = { x: -4000, y: -3000, zoom: 1 };
  const view = { left: 0, right: 0, top: 0, bottom: 0 };
  worldViewRect(view, vp.x, vp.y, vp.zoom, VIEW_W, VIEW_H);

  const scanMs = timeFrames(200, () =>
    scanVisible(entities, view.left, view.right, view.top, view.bottom, scanOut)
  );

  const rect = { left: 0, right: 0, top: 0, bottom: 0 };
  const qtMs = timeFrames(200, () => {
    inflateViewRect(rect, view.left, view.right, view.top, view.bottom, CULL_PAD);
    query.x = rect.left;
    query.y = rect.top;
    query.width = rect.right - rect.left;
    query.height = rect.bottom - rect.top;
    qt.queryRangeInto(query, qtOut);
  });

  const visible = scanVisible(entities, view.left, view.right, view.top, view.bottom, scanOut);

  /**
   * Forty frames of a pan at 8 world px a frame — the perf harness's own gesture.
   *
   * The scan pays every frame. The hysteresis path pays only on the frames the screen has left
   * the rect it collected for, which is the saving the margin buys and the one worth measuring on
   * a gesture rather than on a single frame.
   */
  const panScanMs = timeFrames(12, () => {
    for (let f = 0; f < 40; f++) {
      const v = { left: 0, right: 0, top: 0, bottom: 0 };
      worldViewRect(v, vp.x - f * 8, vp.y, vp.zoom, VIEW_W, VIEW_H);
      scanVisible(entities, v.left, v.right, v.top, v.bottom, scanOut);
    }
  });

  let recollects = 0;
  const panHystMs = timeFrames(12, () => {
    const collected = { left: 0, right: 0, top: 0, bottom: 0 };
    let first = true;
    recollects = 0;
    for (let f = 0; f < 40; f++) {
      const v = { left: 0, right: 0, top: 0, bottom: 0 };
      worldViewRect(v, vp.x - f * 8, vp.y, vp.zoom, VIEW_W, VIEW_H);
      if (first || viewEscaped(collected, v.left, v.right, v.top, v.bottom)) {
        first = false;
        recollects++;
        inflateViewRect(collected, v.left, v.right, v.top, v.bottom, CULL_PAD);
        query.x = collected.left;
        query.y = collected.top;
        query.width = collected.right - collected.left;
        query.height = collected.bottom - collected.top;
        qt.queryRangeInto(query, qtOut);
      }
    }
  });

  const pad = (s, n) => String(s).padStart(n);
  console.log(
    `  ${pad(count, 6)}   ${pad(visible, 7)}   ${pad(scanMs.toFixed(3), 8)}ms   ` +
      `${pad(qtMs.toFixed(3), 12)}ms   ${pad((scanMs / qtMs).toFixed(1), 6)}x   ` +
      `${pad(panScanMs.toFixed(2), 13)}ms   ${pad(panHystMs.toFixed(2), 8)}ms   ` +
      `${pad((panScanMs / panHystMs).toFixed(1), 6)}x  (${recollects}/40 collects)`
  );
}

console.log('');
rmSync(tmp, { recursive: true, force: true });
