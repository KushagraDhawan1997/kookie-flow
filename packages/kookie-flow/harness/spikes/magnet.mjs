/**
 * The magnet, seen: a wire dragged toward a socket, stopped at four distances.
 *
 * Not a law — the pull, the morph and the fused bridge are a LOOK, and no law can tell whether a
 * socket reads as reaching back. This walks a drag in from far out and screenshots each stage, in
 * both appearances, plus a socket that refuses. Writes to harness/dist/magnet/.
 *
 * Run after `node harness/build.mjs`.
 */

import { createServer } from 'node:http';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { launch } from '../browser.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, '..', 'dist');
const outDir = join(dist, 'magnet');

if (!existsSync(join(dist, 'app.js'))) {
  console.error('Fixture not built. Run: node harness/build.mjs');
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
const page = await browser.newPage({ viewport: { width: 900, height: 700 }, deviceScaleFactor: 3 });
const logs = [];
page.on('pageerror', (e) => logs.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') logs.push(`[error] ${m.text().slice(0, 400)}`); });

await page.goto(`http://127.0.0.1:${port}/index.html?count=6&seed=3&grid=0`);
await page.waitForFunction(() => window.__harness !== undefined, { timeout: 30_000 });
await page.evaluate(() => window.__harness.ready);

/**
 * Two pairs to drag between: one the target will ACCEPT (same socket type) and one it will
 * REFUSE (different types, neither of them the wildcard). The refusal is half the behaviour —
 * a socket that will not take the wire has to say so in the drag — so the spike shows both.
 */
const pairs = await page.evaluate(() => {
  const h = window.__harness;
  const s = h.store.getState();
  const sockets = h.indexedSockets();
  const taken = new Set();
  for (const e of s.edges) {
    taken.add(`${e.source}:${e.sourceSocket}:o`);
    taken.add(`${e.target}:${e.targetSocket}:i`);
  }
  const key = (x) => `${x.entityId}:${x.socketId}:${x.isInput ? 'i' : 'o'}`;
  const free = sockets.filter((x) => !taken.has(key(x)));
  const typeOf = (x) => {
    const ent = s.entityMap.get(x.entityId);
    const list = x.isInput ? ent?.inputs : ent?.outputs;
    return list?.find((k) => k.id === x.socketId)?.type ?? 'any';
  };
  const outs = free.filter((x) => !x.isInput);
  const ins = free.filter((x) => x.isInput);
  const { viewport } = s;
  const rect = document.querySelector('canvas').getBoundingClientRect();
  const toScreen = (p) => ({
    x: p.x * viewport.zoom + viewport.x + rect.left,
    y: p.y * viewport.zoom + viewport.y + rect.top,
  });
  const pick = (wants) => {
    let best = null;
    for (const o of outs) {
      for (const i of ins) {
        if (i.entityId === o.entityId) continue;
        const ot = typeOf(o);
        const it = typeOf(i);
        const same = ot === it;
        const wild = ot === 'any' || it === 'any';
        if (wants === 'accept' && !same) continue;
        if (wants === 'refuse' && (same || wild)) continue;
        const d = Math.hypot(i.x - o.x, i.y - o.y);
        if (d > 460) continue;
        if (!best || d < best.d) {
          best = {
            d,
            from: toScreen(o),
            to: toScreen(i),
            source: `${o.entityId}/${o.socketId}:${ot}`,
            target: `${i.entityId}/${i.socketId}:${it}`,
          };
        }
      }
    }
    return best;
  };
  return { accept: pick('accept'), refuse: pick('refuse') };
});

/** The socket's own reach, in world px, read from the magnet rather than guessed. */
const reach = await page.evaluate(() => {
  const m = window.__harness.store.getState().magnet;
  return { range: m.bounds.range, fuse: m.bounds.fuse, zoom: window.__harness.store.getState().viewport.zoom };
});
console.log(`reach: range ${reach.range} world px, fuse ${reach.fuse}, zoom ${reach.zoom}`);

const magnetState = () =>
  page.evaluate(() => {
    const m = window.__harness.store.getState().magnet;
    return {
      stage: m.stage,
      pull: Number(m.strength.toFixed(2)),
      accepts: m.compatible,
      lag: Number(Math.hypot(m.tipX - m.pointerX, m.tipY - m.pointerY).toFixed(1)),
    };
  });

const edgeCount = () => page.evaluate(() => window.__harness.store.getState().edges.length);

/** Walk a drag in from out of reach to on the dot, shooting each stage around the TARGET socket. */
async function walk(pair, label) {
  const shot = async (name) => {
    const file = join(outDir, `${name}.png`);
    await page.screenshot({
      path: file,
      clip: {
        x: Math.max(0, pair.to.x - 150),
        y: Math.max(0, pair.to.y - 110),
        width: 300,
        height: 220,
      },
    });
    console.log(`  ${name.padEnd(28)} ${JSON.stringify(await magnetState())}`);
  };

  const before = await edgeCount();
  await page.mouse.move(pair.from.x, pair.from.y);
  await page.mouse.down();
  const dx = pair.to.x - pair.from.x;
  const dy = pair.to.y - pair.from.y;
  const len = Math.hypot(dx, dy) || 1;
  /**
   * Short of the socket, in the magnet's OWN units — screen px converted from world, so every
   * stop means what its name says however the reach is tuned or the canvas zoomed.
   */
  const px = (world) => world * reach.zoom;
  for (const [name, gap] of [
    ['far', px(reach.range * 1.8)],
    ['awake', px(reach.range * 0.8)],
    ['recognised', px((reach.range + reach.fuse) / 2)],
    ['fused', px(reach.fuse * 0.5)],
  ]) {
    await page.mouse.move(pair.to.x - (dx / len) * gap, pair.to.y - (dy / len) * gap, { steps: 8 });
    await page.waitForTimeout(220);
    await shot(`${label}-${name}`);
  }
  /**
   * The release, well outside the nine-pixel hit test but inside the pull. A magnet that only
   * holds the wire once the pointer is already on the socket has done nothing.
   */
  const releaseGap = px(reach.range * 0.75);
  await page.mouse.move(pair.to.x - (dx / len) * releaseGap, pair.to.y - (dy / len) * releaseGap, { steps: 4 });
  await page.waitForTimeout(200);
  await page.mouse.up();
  await page.waitForTimeout(320);
  await shot(`${label}-released`);
  const after = await edgeCount();
  console.log(`  edges ${before} -> ${after} (released ${releaseGap.toFixed(0)}px short of the dot)`);
}

for (const appearance of ['light', 'dark']) {
  await page.evaluate((a) => window.__harness.setAppearance(a), appearance);
  await page.waitForTimeout(300);
  for (const [kind, pair] of [['accept', pairs.accept], ['refuse', pairs.refuse]]) {
    if (!pair) {
      console.log(`${appearance}/${kind}: no such pair in this scene`);
      continue;
    }
    console.log(`${appearance}/${kind}: ${pair.source} -> ${pair.target}`);
    await walk(pair, `${appearance}-${kind}`);
  }
}

if (logs.length) {
  console.log('\npage errors:');
  for (const l of logs) console.log('  ' + l);
}
await browser.close();
server.close();
