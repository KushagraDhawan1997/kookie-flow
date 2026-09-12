/**
 * A look at the GL controls: the glass wells, the list, the picker, in both appearances.
 *
 * Not a law — a way to SEE the shader. Writes screenshots to harness/dist/glass/ and prints
 * their paths. Run after `pnpm run harness:build`.
 */

import { createServer } from 'node:http';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { launch } from '../browser.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, '..', 'dist');
const outDir = join(dist, 'glass');

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
const page = await browser.newPage({ viewport: { width: 900, height: 960 }, deviceScaleFactor: 2 });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { errors.push(`[${m.type()}] ${m.text().slice(0, 1500)}`); });

await page.goto(`http://127.0.0.1:${port}/index.html?scene=widgets&widgets=1`);
await page.waitForFunction(() => window.__harness !== undefined, { timeout: 30_000 });
await page.evaluate(() => window.__harness.ready);
await page.waitForTimeout(300);

const zoom = Number(process.env.GLASS_ZOOM ?? 2);
await page.evaluate((z) => {
  const s = window.__harness.store.getState();
  const e = s.entityMap.get('w');
  s.setViewport({ x: 60 - e.position.x * z, y: 20 - e.position.y * z, zoom: z });
}, zoom);
await page.waitForTimeout(400);

const shot = async (name) => {
  const file = join(outDir, `${name}.png`);
  await page.screenshot({ path: file });
  console.log(`shot -> ${file}`);
};

const point = (socket) => page.evaluate((id) => window.__harness.widgetPoint('w', id), socket);

for (const appearance of ['light', 'dark']) {
  await page.evaluate((a) => window.__harness.setAppearance(a), appearance);
  await page.waitForTimeout(400);
  await page.mouse.move(5, 5);
  await page.waitForTimeout(200);
  await shot(`${appearance}-rest`);

  // Hover the slider, mid-fade and settled.
  const amount = await point('amount');
  await page.mouse.move(amount.x, amount.y);
  await page.waitForTimeout(60);
  await shot(`${appearance}-hover-mid`);
  await page.waitForTimeout(300);
  await shot(`${appearance}-hover`);

  // Tick the checkbox, mid-draw and settled.
  const flag = await point('flag');
  await page.mouse.move(flag.x, flag.y);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(90);
  await shot(`${appearance}-tick-mid`);
  await page.waitForTimeout(400);
  await shot(`${appearance}-tick`);

  // Open the list.
  const mode = await point('mode');
  await page.mouse.move(mode.x, mode.y);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(60);
  await shot(`${appearance}-list-opening`);
  await page.waitForTimeout(400);
  const row = await page.evaluate(() => window.__harness.popoverRowPoint(1));
  if (row) await page.mouse.move(row.x, row.y);
  await page.waitForTimeout(250);
  await shot(`${appearance}-list`);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);

  // Open the picker and drag in the square.
  const tint = await point('tint');
  await page.mouse.move(tint.x, tint.y);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(400);
  await shot(`${appearance}-picker`);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);

  // Untick so the next appearance starts where this one did.
  await page.mouse.move(flag.x, flag.y);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(400);
}

if (errors.length) {
  console.log('\npage errors / warnings:');
  for (const e of errors) console.log('  ' + e);
}

await browser.close();
server.close();
