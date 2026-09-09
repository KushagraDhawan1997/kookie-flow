/**
 * The counts-and-allocations spike.
 *
 * Phase 3 of the remediation plan is nine perf commits whose stated proof is, every one of them,
 * "T-count" — and no such instrument existed. This is it, and it exists BEFORE those commits for
 * the reason CLAUDE.md gives: performance is rule one here, so an unmeasured change to the frame
 * loop is not an improvement, it is a guess.
 *
 * Frame TIMING is deliberately not the metric. This runs on SwiftShader, where a millisecond
 * means nothing about a real GPU. What does transfer is work: how many draw calls a pan issues,
 * how many instances get rewritten per pointermove, how many times React commits during a drag
 * (CLAUDE.md: zero), and how many bytes are allocated in the handlers. Those numbers are the same
 * on any machine.
 *
 * Usage:  node harness/spikes/counts.mjs [--count=1000] [--json]
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

const args = new Map(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? '1'];
  })
);
const COUNT = Number(args.get('count') ?? 1000);
const AS_JSON = args.has('json');

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
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await context.newPage();
page.on('pageerror', (e) => console.error('PAGE ERROR', String(e)));

// preserveBuffer is deliberately OFF: it changes what the driver may optimise, and every number
// here is meant to be about the app rather than about the harness.
await page.goto(`http://127.0.0.1:${port}/index.html?count=${COUNT}&seed=1`);
await page.waitForFunction(() => window.__harness !== undefined, { timeout: 120_000 });
await page.evaluate(() => window.__harness.ready);
await page.waitForTimeout(500);

const cdp = await context.newCDPSession(page);
await cdp.send('HeapProfiler.enable');

/**
 * Run one interaction and report the work it cost.
 *
 * Allocation is sampled through CDP rather than diffed from `usedJSHeapSize`, because a heap size
 * delta reports what SURVIVED a GC that may or may not have run — an interaction that allocates a
 * megabyte of garbage per frame and collects it all shows as zero. The sampling profiler counts
 * what was allocated, which is the thing the no-allocation-in-hot-paths rule is about.
 */
async function measure(name, run) {
  await page.evaluate((n) => window.__harness.mark(n), name);
  await cdp.send('HeapProfiler.startSampling', { samplingInterval: 4096 });

  const t0 = Date.now();
  await run();
  const wall = Date.now() - t0;

  const { profile } = await cdp.send('HeapProfiler.stopSampling');
  const gl = await page.evaluate(() => window.__harness.gl());
  const react = await page.evaluate(() => window.__harness.reactCommits());
  const frames = await page.evaluate(() => window.__harness.frames());

  // Walk the sampling tree, keeping the app's own frames so the report names WHERE.
  const byFunction = new Map();
  let total = 0;
  const walk = (node) => {
    const size = (node.selfSize ?? 0);
    total += size;
    if (size > 0) {
      const f = node.callFrame ?? {};
      const where = `${f.functionName || '(anonymous)'} @ ${String(f.url || '').split('/').pop()}:${f.lineNumber ?? '?'}`;
      byFunction.set(where, (byFunction.get(where) ?? 0) + size);
    }
    for (const c of node.children ?? []) walk(c);
  };
  walk(profile.head);

  // PER FRAME, not per interaction. Totals scale with how many frames rendered during the
  // gesture, which scales with wall time, which on a shared machine is whatever else was running —
  // so a total is only comparable against another total from the same run. A per-frame figure is
  // a property of the app and survives a busy machine, which is what makes the graph-size
  // comparison below mean anything.
  const f = Math.max(1, frames.count ?? 1);

  return {
    name,
    wallMs: wall,
    reactCommits: react.marks[name] ?? 0,
    drawCalls: gl.drawCalls,
    instancedDrawCalls: gl.instancedDrawCalls,
    instancesDrawn: gl.instancesDrawn,
    drawsPerFrame: Number((gl.drawCalls / f).toFixed(1)),
    instancesPerFrame: Math.round(gl.instancesDrawn / f),
    frames,
    allocatedBytes: total,
    allocBytesPerFrame: Math.round(total / f),
    topAllocators: [...byFunction.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6),
  };
}

const centre = { x: 640, y: 400 };

/*
 * CALIBRATE THE REACT COUNTER BEFORE READING A SINGLE ZERO FROM IT.
 *
 * "Zero commits during a drag" is the answer this spike most wants to report, and it is also
 * exactly what a dead probe reports. The first version of the counter lived in app.tsx's module
 * body, where it ran after React had already read the DevTools hook — it said zero for everything,
 * including a node drag that calls setState through the fixture's controlled-component contract,
 * and it looked like a pass.
 *
 * A resize forces React to commit. If the counter does not move here, no number below is evidence.
 */
{
  const before = await page.evaluate(() => window.__harness.reactCommits().commits);
  await page.setViewportSize({ width: 1281, height: 800 });
  await page.waitForTimeout(300);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.waitForTimeout(300);
  const after = await page.evaluate(() => window.__harness.reactCommits().commits);
  if (after <= before) {
    console.error(
      `INSTRUMENT DEAD: React committed ${after - before} times across two viewport changes. ` +
        'Every commit count below would read zero regardless of the app. Refusing to report.'
    );
    await browser.close();
    server.close();
    process.exit(3);
  }
  if (!AS_JSON) console.log(`  (calibration: ${after - before} commits from two resizes)`);
}

const results = [];

// Idle: the floor. Anything here is work the app does when nobody is touching it, and it is the
// baseline every other number has to be read against.
results.push(
  await measure('idle', async () => {
    await page.waitForTimeout(1000);
  })
);

results.push(
  await measure('pan', async () => {
    await page.mouse.move(centre.x, centre.y);
    await page.mouse.down({ button: 'middle' });
    for (let i = 0; i < 60; i++) {
      await page.mouse.move(centre.x + i * 4, centre.y + i * 2);
    }
    await page.mouse.up({ button: 'middle' });
  })
);

results.push(
  await measure('zoom', async () => {
    for (let i = 0; i < 30; i++) await page.mouse.wheel(0, i % 2 ? 120 : -120);
    await page.waitForTimeout(100);
  })
);

// Drag one node. The most common interaction there is, and the one the store's fast path exists
// for: sixty pointermoves should not cost sixty React commits.
const nodePos = await page.evaluate(() => {
  const s = window.__harness.store.getState();
  const e = s.entities[0];
  const { x, y, zoom } = s.viewport;
  return { x: (e.position.x + 60) * zoom + x, y: (e.position.y + 30) * zoom + y };
});

results.push(
  await measure('drag-node', async () => {
    await page.mouse.move(nodePos.x, nodePos.y);
    await page.mouse.down();
    for (let i = 0; i < 60; i++) await page.mouse.move(nodePos.x + i * 3, nodePos.y + i);
    await page.mouse.up();
  })
);

// A connection drag. Audit finding #1: every pointermove rebuilds every socket in the graph, so
// this is the number C15 has to move.
const socketPos = await page.evaluate(() => {
  const s = window.__harness.store.getState();
  const e = s.entities[0];
  for (const q of s.socketQuadtree.queryPoint(e.position.x + 100, e.position.y + 100, 900, [])) {
    if (q.entityId === e.id && !q.isInput) {
      const { x, y, zoom } = s.viewport;
      return { x: q.x * zoom + x, y: q.y * zoom + y };
    }
  }
  return null;
});

if (socketPos) {
  results.push(
    await measure('connection-drag', async () => {
      await page.mouse.move(socketPos.x, socketPos.y);
      await page.mouse.down();
      for (let i = 0; i < 60; i++) await page.mouse.move(socketPos.x + i * 4, socketPos.y + i * 2);
      await page.mouse.up();
    })
  );
} else {
  console.error('NOTE: no output socket found, connection-drag not measured');
}

await browser.close();
server.close();

if (AS_JSON) {
  console.log(JSON.stringify({ count: COUNT, results }, null, 2));
} else {
  console.log(`\ncounts @ ${COUNT} entities\n`);
  const pad = (s, n) => String(s).padEnd(n);
  console.log(
    `  ${pad('interaction', 18)}${pad('react', 7)}${pad('frames', 8)}${pad('draws/f', 9)}${pad(
      'inst/f',
      10
    )}${pad('alloc B/f', 11)}wall*`
  );
  for (const r of results) {
    console.log(
      `  ${pad(r.name, 18)}${pad(r.reactCommits, 7)}${pad(r.frames.count ?? 0, 8)}${pad(
        r.drawsPerFrame,
        9
      )}${pad(r.instancesPerFrame, 10)}${pad(r.allocBytesPerFrame, 11)}${r.wallMs}ms`
    );
  }
  console.log('\n  where the bytes went\n');
  for (const r of results) {
    if (!r.topAllocators.length) continue;
    console.log(`  ${r.name}`);
    for (const [where, bytes] of r.topAllocators) {
      console.log(`      ${pad(Math.round(bytes / 1024) + ' KB', 10)}${where}`);
    }
  }
  console.log('\n  * wall is round-trip time for the scripted input on a software rasteriser. It is');
  console.log('    NOT a performance number and does not transfer to a real machine; the counts are.\n');
}
