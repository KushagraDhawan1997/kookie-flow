/**
 * Real v2 beside the GL controls, at the same device scale, so the look is judged against the
 * thing it copies rather than against a reading of its stylesheet.
 *
 * Builds spikes/reference/ into dist/, then writes dist/compare/{appearance}-{v2,gl}[-open].png.
 * Run after `node harness/build.mjs`.
 */

import { createServer } from 'node:http';
import { readFileSync, existsSync, mkdirSync, copyFileSync } from 'node:fs';
import { dirname, join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import { launch } from '../browser.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, '..', 'dist');
const outDir = join(dist, 'compare');
mkdirSync(outDir, { recursive: true });

await build({
  entryPoints: [join(here, 'reference', 'reference.tsx')],
  bundle: true,
  format: 'esm',
  target: 'chrome120',
  jsx: 'automatic',
  outfile: join(dist, 'reference.js'),
  define: { 'process.env.NODE_ENV': '"production"' },
  logLevel: 'warning',
});
copyFileSync(join(here, 'reference', 'reference.html'), join(dist, 'reference.html'));

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

const scale = Number(process.env.COMPARE_DPR ?? 3);
const CLIP_H = 560;
const browser = await launch(chromium);
const logs = [];
const newPage = async () => {
  const page = await browser.newPage({ viewport: { width: 640, height: 720 }, deviceScaleFactor: scale });
  page.on('pageerror', (e) => logs.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text().slice(0, 800)}`); });
  return page;
};

const only = process.env.COMPARE_ONLY; // 'v2' | 'gl'
for (const appearance of (process.env.COMPARE_APPEARANCE ?? 'light,dark').split(',')) {
  if (only !== 'gl') {
    for (const open of [false, true]) {
      const page = await newPage();
      await page.goto(`http://127.0.0.1:${port}/reference.html?appearance=${appearance}&open=${open ? 1 : 0}`);
      await page.waitForTimeout(900);
      const file = join(outDir, `${appearance}-v2${open ? '-open' : ''}.png`);
      await page.screenshot({ path: file, clip: { x: 0, y: 0, width: 480, height: CLIP_H } });
      // The numbers, so a comparison can be measured and not only eyeballed.
      const probe = await page.evaluate(() => {
        const pick = (el) => {
          if (!el) return null;
          const s = getComputedStyle(el);
          const r = el.getBoundingClientRect();
          return { w: r.width, h: r.height, radius: s.borderRadius, bg: s.backgroundColor, bgImage: s.backgroundImage.slice(0, 300), shadow: s.boxShadow.slice(0, 400), border: s.border, font: s.fontSize, color: s.color, padding: s.padding };
        };
        return {
          field: pick(document.querySelector('#field .kui-field')),
          trigger: pick(document.querySelector('#select .kui-select-trigger, #select button')),
          popup: pick(document.querySelector('.kui-floating-rows')),
          row: pick(document.querySelector('.kui-floating-rows .kui-row')),
          track: pick(document.querySelector('#slider [class*="track"]')),
          thumb: pick(document.querySelector('.kui-slider-thumb')),
          check: pick(document.querySelector('.kui-checkbox')),
          button: pick(document.querySelector('#toolbar button')),
        };
      });
      console.log(`${appearance} v2${open ? ' open' : ''}:`, JSON.stringify(probe, null, 1));
      console.log(`shot -> ${file}`);
      await page.close();
    }
  }
  if (only !== 'v2') {
    const page = await newPage();
    await page.goto(`http://127.0.0.1:${port}/index.html?scene=widgets&widgets=1&appearance=${appearance}`);
    await page.waitForFunction(() => window.__harness !== undefined, { timeout: 30_000 });
    await page.evaluate(() => window.__harness.ready);
    await page.evaluate((a) => window.__harness.setAppearance(a), appearance);
    await page.evaluate(() => {
      const s = window.__harness.store.getState();
      const e = s.entityMap.get('w');
      s.setViewport({ x: 24 - e.position.x, y: 24 - e.position.y, zoom: 1 });
    });
    await page.mouse.move(2, 2);
    await page.waitForTimeout(700);
    let file = join(outDir, `${appearance}-gl.png`);
    await page.screenshot({ path: file, clip: { x: 0, y: 0, width: 480, height: CLIP_H } });
    console.log(`shot -> ${file}`);
    const mode = await page.evaluate(() => window.__harness.widgetPoint('w', 'mode'));
    await page.mouse.click(mode.x, mode.y);
    await page.waitForTimeout(700);
    await page.mouse.move(2, 2);
    await page.waitForTimeout(300);
    file = join(outDir, `${appearance}-gl-open.png`);
    await page.screenshot({ path: file, clip: { x: 0, y: 0, width: 480, height: CLIP_H } });
    console.log(`shot -> ${file}`);

    /**
     * The keyboard's own ring. Nothing draws it but the widget layer, and nothing else in the
     * harness can see it: the controls it belongs to are the accessibility mirror's, clipped to a
     * pixel. Enter on the container steps into them; Down walks them.
     */
    await page.keyboard.press('Escape');
    await page.mouse.click(120, 40); // the node's header, which selects it without pressing a control
    await page.keyboard.press('Enter');
    await page.waitForTimeout(400);
    file = join(outDir, `${appearance}-gl-focus-mark.png`);
    await page.screenshot({ path: file, clip: { x: 0, y: 0, width: 480, height: CLIP_H } });
    console.log(`shot -> ${file}`);
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(400);
    file = join(outDir, `${appearance}-gl-focus-slider.png`);
    await page.screenshot({ path: file, clip: { x: 0, y: 0, width: 480, height: CLIP_H } });
    console.log(`shot -> ${file}`);
    for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(400);
    file = join(outDir, `${appearance}-gl-focus-select.png`);
    await page.screenshot({ path: file, clip: { x: 0, y: 0, width: 480, height: CLIP_H } });
    console.log(`shot -> ${file}`);
    await page.close();
  }
}

if (logs.length) {
  console.log('\npage errors / warnings:');
  for (const l of logs) console.log('  ' + l);
}
await browser.close();
server.close();
