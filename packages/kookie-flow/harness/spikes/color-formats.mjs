/**
 * Does the library resolve every colour format it claims to?
 *
 * This exists because `parseColorToRGB` carried a comment saying it "handles oklch, hsl, hwb, lab,
 * lch, and all other CSS color formats" and it did not. Chrome returns modern colour functions from
 * getComputedStyle UNCHANGED, so the regexes matched nothing and it fell through to a hardcoded
 * mid-grey — silently, because the console.warn sits on a branch that path never reaches.
 *
 * v1's tokens are hex, so nothing was broken. v2's tokens are OKLCH: pointed at v2 unchanged, every
 * node, socket and edge would have rendered [0.5, 0.5, 0.5].
 *
 * It tests the SHIPPED functions through the harness's `lib` handle, not a copy of them, and it
 * checks against the browser's own answer rather than numbers I typed in — a table of expected
 * values written by the same person who wrote the parser proves nothing.
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
const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
await page.goto(`http://127.0.0.1:${port}/index.html?count=4&seed=1`);
await page.waitForFunction(() => window.__harness !== undefined, { timeout: 60_000 });
await page.evaluate(() => window.__harness.ready);

const result = await page.evaluate(() => {
  /**
   * Ground truth: paint the colour on a real canvas and read the pixel back. This is independent
   * of every code path under test — a different mechanism, so agreement means something.
   */
  const truth = (value) => {
    const c = document.createElement('canvas');
    c.width = c.height = 4;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#000';
    ctx.fillStyle = value;
    if (ctx.fillStyle === '#000' && value !== '#000' && value !== 'black') return null; // rejected
    ctx.fillRect(0, 0, 4, 4);
    const d = ctx.getImageData(1, 1, 1, 1).data;
    return [d[0], d[1], d[2]];
  };

  // A theme token has to be read from inside the theme, so resolve it to a literal first.
  const themeEl =
    document.querySelector('.radix-themes') ?? document.querySelector('.kui-theme');
  const rawAccent = themeEl ? getComputedStyle(themeEl).getPropertyValue('--accent-9').trim() : null;

  const cases = [
    { name: 'hex', value: '#808080' },
    { name: 'hex short', value: '#f0a' },
    { name: 'rgb()', value: 'rgb(10, 200, 30)' },
    { name: 'hsl()', value: 'hsl(120 100% 25%)' },
    { name: 'oklch() red-ish', value: 'oklch(0.628 0.2577 29.23)' },
    { name: 'oklch() blue-ish', value: 'oklch(0.6 0.2 250)' },
    { name: 'lab()', value: 'lab(50% 40 -30)' },
    { name: 'color(srgb)', value: 'color(srgb 0.2 0.4 0.6)' },
    { name: 'color(display-p3)', value: 'color(display-p3 1 0 0)' },
  ];
  if (rawAccent) cases.push({ name: '--accent-9 (raw value)', value: rawAccent });

  const out = cases.map((c) => {
    let lib = null;
    try {
      lib = window.__harness.lib.parseColorToRGB(c.value);
    } catch (e) {
      lib = 'THREW: ' + e.message;
    }
    return {
      name: c.name,
      value: c.value,
      lib: Array.isArray(lib) ? lib.map((v) => Math.round(v * 255)) : lib,
      truth: truth(c.value),
    };
  });

  // The var() case can only be answered from inside the theme scope.
  let varCase = null;
  try {
    const v = window.__harness.lib.resolveColorToRGB('var(--accent-9)');
    varCase = { lib: v ? v.map((x) => Math.round(x * 255)) : null, truth: truth(rawAccent) };
  } catch (e) {
    varCase = { lib: 'THREW: ' + e.message, truth: null };
  }

  // Alpha must survive the color-mix wrapper.
  const alpha = window.__harness.lib.parseColorToRGBA('rgba(20, 40, 60, 0.25)');

  return { out, varCase, alpha, rawAccent };
});

console.log('\ncolour format support — library vs an independent canvas readback\n');
console.log('case                      library         canvas truth    ');
let failures = 0;
const GREY = [128, 128, 128];

for (const r of result.out) {
  const libS = Array.isArray(r.lib) ? r.lib.join(',') : String(r.lib);
  const truthS = r.truth ? r.truth.join(',') : '(rejected)';
  let verdict = '';
  if (!Array.isArray(r.lib) || !r.truth) {
    verdict = '  ?';
  } else {
    const near = r.lib.every((v, i) => Math.abs(v - r.truth[i]) <= 1);
    const isFallbackGrey = r.lib.every((v, i) => v === GREY[i]) && !r.truth.every((v, i) => v === GREY[i]);
    if (near) verdict = '  ok';
    else {
      verdict = isFallbackGrey ? '  FAIL (fell back to mid-grey)' : '  FAIL';
      failures++;
    }
  }
  console.log(`${r.name.padEnd(25)} ${libS.padEnd(15)} ${truthS.padEnd(15)}${verdict}`);
}

console.log('');
const vc = result.varCase;
const vLib = Array.isArray(vc.lib) ? vc.lib.join(',') : String(vc.lib);
const vTruth = vc.truth ? vc.truth.join(',') : '?';
const varOk = Array.isArray(vc.lib) && vc.truth && vc.lib.every((v, i) => Math.abs(v - vc.truth[i]) <= 1);
if (!varOk) failures++;
console.log(`var(--accent-9) via public resolveColorToRGB: ${vLib}  (theme truth ${vTruth})  ${varOk ? 'ok' : 'FAIL'}`);

const alphaOk = Math.abs(result.alpha[3] - 0.25) < 0.01;
if (!alphaOk) failures++;
console.log(`alpha survives the wrapper: rgba(...,0.25) -> a=${result.alpha[3]}  ${alphaOk ? 'ok' : 'FAIL'}`);

console.log(`\n${failures} failing\n`);

await browser.close();
server.close();
process.exit(failures ? 1 : 0);
