/**
 * Does a theme change reach WebGL, and does anything survive it?
 *
 * Three audit findings interlock here, and the first masks the other two:
 *
 *  1. The token reader's MutationObserver filtered on five `data-*` attributes and not on `class`.
 *     Kookie UI v1 carries light/dark in className and `detectAppearance` reads `classList`, so a
 *     dark-mode toggle repainted every DOM control and left every GL colour at the previous
 *     appearance's values. Nothing downstream ever ran.
 *  2. A theme change reconstructs both entity InstancedMeshes, and nothing re-initialises them or
 *     sets the dirty flag — so the nodes can vanish.
 *  3. The socket foreground mesh's shared instanceMatrix aliasing is destroyed by the same
 *     reconstruction, so selected sockets can disappear permanently.
 *
 * Fixing (1) is what makes (2) and (3) reachable at all. This measures all three at once: the
 * pixels must MOVE (the change arrived) and the nodes must still be THERE (it did not break them).
 *
 * Also the migration's go/no-go instrument: the same shape answers "did v2's tokens reach GL".
 *
 * THE INSTRUMENT IS A ROUND TRIP, not a single flip. Comparing ink across light -> dark cannot
 * separate "the geometry is gone" from "the colours legitimately changed", and a threshold tuned
 * to tell them apart is fitted to noise. Flipping light -> dark -> light cancels the colour
 * difference: what is left is whether the same geometry is still being drawn. A null control
 * (sample twice with the same waits and no flip) proves the measurement itself is stable before
 * any of it counts.
 *
 * That distinction was not academic. A single-flip ink check with a 10% threshold passed with the
 * socket fix DELIBERATELY SABOTAGED, and the round trip is what exposed a third regression — the
 * selection outline came back as a partial rectangle and never recovered.
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
const page = await browser.newPage({ viewport: { width: 800, height: 500 } });
await page.goto(`http://127.0.0.1:${port}/index.html?count=6&seed=1&grid=0&preserveBuffer=1`);
await page.waitForFunction(() => window.__harness !== undefined, { timeout: 60_000 });
await page.evaluate(() => window.__harness.ready);

// Select an entity BEFORE measuring. The socket renderer splits into two instanced meshes by an
// `aLayer` attribute, and `layer = isSelected ? 1 : 0` — so the FOREGROUND mesh draws nothing at
// all unless something is selected. Without this the spike cannot see the aliasing regression it
// exists to catch: sabotaging the fix left it green.
await page.evaluate(() => window.__harness.store.getState().selectEntity('n0', false));
await page.waitForTimeout(1400);

/** Sample the node-body region: ink count plus a mean colour, both read off the GL buffer. */
const sample = () =>
  page.evaluate(() => {
    const c = document.querySelector('canvas');
    const gl = c.getContext('webgl2');
    const dpr = c.width / c.clientWidth;
    const buf = new Uint8Array(4);
    let ink = 0,
      total = 0,
      r = 0,
      g = 0,
      b = 0;
    for (let x = 20; x < 190; x += 10) {
      for (let y = 20; y < 120; y += 10) {
        gl.readPixels(Math.round(x * dpr), Math.round(c.height - y * dpr), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, buf);
        total++;
        if (buf[3] > 10) {
          ink++;
          r += buf[0];
          g += buf[1];
          b += buf[2];
        }
      }
    }
    // A second, wider sweep over the whole canvas. The node-body window above cannot see
    // sockets, edges or text, and the socket meshes have their own reconstruction hazard —
    // the fg mesh aliases the bg mesh's instanceMatrix, and a rebuild silently breaks it.
    let wideInk = 0,
      wideTotal = 0;
    for (let x = 4; x < c.clientWidth; x += 7) {
      for (let y = 4; y < c.clientHeight; y += 7) {
        gl.readPixels(Math.round(x * dpr), Math.round(c.height - y * dpr), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, buf);
        wideTotal++;
        if (buf[3] > 10) wideInk++;
      }
    }

    return {
      ink,
      total,
      wideInk,
      wideTotal,
      mean: ink ? [Math.round(r / ink), Math.round(g / ink), Math.round(b / ink)] : null,
      themeClass: document.querySelector('.radix-themes')?.className ?? null,
    };
  });

const setAppearance = async (from, to) => {
  await page.evaluate(
    ([f, t]) => {
      const el = document.querySelector('.radix-themes');
      el.classList.remove(f);
      el.classList.add(t);
    },
    [from, to]
  );
  await page.waitForTimeout(1500);
};

const before = await sample();

// Null control: same wait, no flip. If this drifts, nothing below it means anything.
await page.waitForTimeout(1500);
const control = await sample();

await setAppearance('light', 'dark');
const after = await sample();

await setAppearance('dark', 'light');
const roundTrip = await sample();

await page.screenshot({ path: join(dist, 'theme-flip-after.png') });

console.log('\ntheme flip: light -> dark\n');
console.log(`before  class="${before.themeClass}"  nodeInk=${before.ink}/${before.total}  canvasInk=${before.wideInk}/${before.wideTotal}  mean=${before.mean}`);
console.log(`after   class="${after.themeClass}"  nodeInk=${after.ink}/${after.total}  canvasInk=${after.wideInk}/${after.wideTotal}  mean=${after.mean}`);

let failures = 0;

const moved =
  before.mean && after.mean && before.mean.some((v, i) => Math.abs(v - after.mean[i]) > 8);
if (!moved) failures++;
console.log(`\nGL colour moved with the theme:      ${moved ? 'ok' : 'FAIL — the change never reached WebGL'}`);

// The nodes must still be drawn. A theme change that reconstructs the meshes without
// re-initialising them empties the instance buffers and the nodes vanish.
const survived = after.ink >= before.ink * 0.9;
if (!survived) failures++;
console.log(`nodes survived the reconstruction:   ${survived ? 'ok' : `FAIL — ink ${before.ink} -> ${after.ink}`}`);

// The instrument has to be shown stable before its output counts.
const stable = control.wideInk === before.wideInk && control.ink === before.ink;
if (!stable) failures++;
console.log(`INSTRUMENT: stable with no flip:     ${stable ? 'ok' : `FAIL — drifted ${before.wideInk} -> ${control.wideInk} with no change`}`);

// The real invariant: flip away and back, and the same geometry must be drawn. Colour
// differences cancel, so this needs no threshold.
const recovered = roundTrip.wideInk === before.wideInk && roundTrip.ink === before.ink;
if (!recovered) failures++;
console.log(
  `geometry survives a round trip:      ${recovered ? 'ok' : `FAIL — canvas ink ${before.wideInk} -> ${roundTrip.wideInk} after light->dark->light`}`
);

console.log(`\n${failures} failing\n`);

await browser.close();
server.close();
process.exit(failures ? 1 : 0);
