/**
 * Re-measure the hue palette kookie-flow froze out of CSS.
 *
 * `src/core/palette.ts` holds the values KookieUI v1 resolved in a real browser at the moment of
 * the freeze. This is the instrument that produced them, kept so the table can be re-derived
 * rather than hand-edited — the values are measurements, and a measurement nobody can repeat is
 * a number somebody made up.
 *
 * Run: `node harness/spikes/palette-freeze.mjs`
 *
 * It prints the table and reports which entries differ between appearances. Step 9 is
 * mode-invariant in Radix for every family but grey; step 10 is not, for any of them, because it
 * is the hover step and hover moves toward the foreground in light and away from it in dark.
 *
 * Values are read through `color-mix(in srgb, … 100%, transparent 0%)` rather than off
 * `getComputedStyle().color` directly — the same wrapper `readProbe` uses, for the same reason:
 * Chrome returns modern colour functions as themselves, and v1's P3 declarations would come back
 * unparsed.
 */
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { launch } from '../browser.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, '..', 'dist');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const server = createServer((req, res) => {
  const url = (req.url ?? '/').split('?')[0];
  try {
    const b = readFileSync(join(dist, url === '/' ? 'index.html' : url));
    res.writeHead(200, { 'content-type': MIME[extname(url)] ?? 'application/octet-stream' });
    res.end(b);
  } catch {
    res.writeHead(404);
    res.end();
  }
}).listen(0);
const port = server.address().port;

const FAMILIES = ['gray','gold','bronze','brown','yellow','amber','orange','tomato','red','ruby','crimson','pink','plum','purple','violet','iris','indigo','blue','cyan','teal','jade','green','grass','lime','mint','sky'];

const browser = await launch(chromium);
const ctx = await browser.newContext({ viewport: { width: 900, height: 600 } });
const out = {};
for (const mode of ['light', 'dark']) {
  const page = await ctx.newPage();
  await page.goto(`http://127.0.0.1:${port}/index.html?count=2&seed=1&appearance=${mode}`);
  await page.waitForFunction(() => window.__harness !== undefined, { timeout: 60_000 });
  await page.evaluate(() => window.__harness.ready);
  await page.waitForTimeout(300);
  out[mode] = await page.evaluate((fams) => {
    const el = window.__harness.themeRoot();
    const host = document.querySelector('.radix-themes') ?? document.querySelector('.kui-theme') ?? document.documentElement;
    void el;
    const probe = document.createElement('span');
    probe.style.cssText = 'position:absolute;visibility:hidden';
    host.appendChild(probe);
    const r = {};
    for (const f of fams) {
      for (const step of [9, 10]) {
        const name = `--${f}-${step}`;
        probe.style.color = `color-mix(in srgb, var(${name}) 100%, transparent 0%)`;
        // Parsed by the LIBRARY's own reader, not by a regex written here.
        //
        // The naive `/[\d.]+/g` sweep is a trap this repo has already been bitten by: it takes the
        // "3" out of `color(display-p3 …)` as the red channel. `color(srgb …)` has no digit in its
        // space name, so a `slice(1)` written to compensate silently drops a real channel instead.
        // The shipped parser knows both shapes, and using it means the spike measures the code
        // that will read these values rather than a copy of it.
        const c = getComputedStyle(probe).color;
        const rgb = window.__harness.lib.parseColorToRGB(c);
        r[name] = rgb
          ? '#' + rgb.map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('')
          : null;
      }
    }
    probe.remove();
    return r;
  }, FAMILIES);
  await page.close();
}

let invariant = 0;
const lines = [];
for (const name of Object.keys(out.light)) {
  const l = out.light[name];
  const d = out.dark[name];
  if (l === d) {
    invariant++;
    lines.push(`  '${name}': '${l}',`);
  } else {
    lines.push(`  '${name}': { light: '${l}', dark: '${d}' },`);
  }
}
console.log(`${Object.keys(out.light).length} tokens, ${invariant} mode-invariant\n`);
console.log(lines.join('\n'));

await ctx.close();
await browser.close();
server.close();
