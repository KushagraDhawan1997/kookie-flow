/**
 * Phase-0 behavior suite — the safety net.
 *
 * These pin what the graph DOES, so an aggressive refactor or the v1->v2 migration cannot change
 * it silently. The brief's rule is "refactor the how freely; don't change what the graph does" —
 * this file is the executable form of "what the graph does".
 *
 * Everything here drives REAL pointer and keyboard events and then asserts on store state, not on
 * pixels. That is deliberate: the store is the observable contract a consumer sees through
 * onEntitiesChange, and it is stable under rendering changes in a way pixels are not. Pixel-level
 * claims live in the spikes, where they belong.
 *
 * Usage: node harness/behaviors.mjs        (exit 0 = green)
 */

import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { launch } from './browser.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, 'dist');

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
// ONE context, many pages: browser.newPage() creates a fresh context each time, which means a
// cold HTTP cache and a re-parse of the ~5MB fixture bundle for every behavior. Sharing the
// context keeps per-behavior page isolation while letting the bundle be cached once.
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });

let passed = 0;
const failures = [];

function check(name, condition, detail) {
  if (condition) {
    passed++;
    console.log(`  ok   ${name}`);
  } else {
    failures.push({ name, detail });
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

/** A fresh page per behavior: shared state between behaviors hides ordering bugs. */
/**
 * Run one named section, or skip it.
 *
 * The whole suite is about twelve minutes, which is the wrong shape for the thing it is most
 * needed for: falsifying a single law by breaking the code it guards and watching exactly that
 * law go red. `KUI_ONLY=<substring>` runs the sections whose name contains it. It is a developer
 * convenience with no effect on a plain run — CI sets nothing and every section runs — and the
 * summary says how many were skipped so a filtered run can never be mistaken for a full one.
 */
const ONLY = process.env.KUI_ONLY ?? '';
let skippedSections = 0;
let currentSection = '';

function head(name) {
  currentSection = name;
  if (ONLY && !name.toLowerCase().includes(ONLY.toLowerCase())) {
    skippedSections++;
    return;
  }
  console.log(`\n${name}`);
}

const skipping = () => Boolean(ONLY) && !currentSection.toLowerCase().includes(ONLY.toLowerCase());

async function withPage(query, fn) {
  if (skipping()) return [];

  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`http://127.0.0.1:${port}/index.html?${query}`);
  await page.waitForFunction(() => window.__harness !== undefined, { timeout: 60_000 });
  await page.evaluate(() => window.__harness.ready);
  await page.waitForTimeout(300);
  try {
    await fn(page, errors);
  } finally {
    await page.close();
  }
  return errors;
}

const state = (page) =>
  page.evaluate(() => {
    const s = window.__harness.store.getState();
    return {
      entities: s.entities.length,
      edges: s.edges.length,
      viewport: { ...s.viewport },
      selected: Array.from(s.selectedEntityIds ?? []),
      selectedEdges: Array.from(s.selectedEdgeIds ?? []),
      positions: Object.fromEntries(s.entities.map((e) => [e.id, { ...e.position }])),
    };
  });

/**
 * World -> screen. Taken from utils/geometry.ts worldToScreen, which is the authority:
 *
 *     screen = world * zoom + offset
 *
 * NOT `(world + offset) * zoom`, which is what CLAUDE.md's "Coordinate System" section says.
 * The two agree only when zoom === 1 and the offset is 0 — i.e. exactly at the default viewport,
 * where most tests sit. Using the wrong one passes there and fails the moment anything is panned
 * or zoomed, which is why the zoomed drag case below exists.
 */
/**
 * How far a drag law must start from a viewport edge to be a law about dragging.
 *
 * AUTO_SCROLL_EDGE_THRESHOLD is 50 screen pixels (core/constants.ts); inside that band a drag also
 * scrolls the viewport, which moves the entity further than the pointer travelled. A law measuring
 * pointer-to-entity parity has to run outside it.
 */
const EDGE_CLEARANCE = 60;

const screenOf = (st, id) => {
  const p = st.positions[id];
  const { x, y, zoom } = st.viewport;
  return { x: p.x * zoom + x, y: p.y * zoom + y };
};


/**
 * Click with a modifier genuinely held.
 *
 * `page.mouse.click(x, y, { modifiers: [...] })` SILENTLY IGNORES the option — Mouse.click takes
 * {button, clickCount, delay} and nothing else. Measured: every pointerdown/pointerup/click it
 * produced carried ctrlKey false, so a "ctrl-click" test using it is really testing a plain click.
 *
 * That cost a false bug report: the suite reported Flow's ctrl-click multi-select as broken when
 * the modifier had never been pressed. It also produced a false PASS — "shift-click does not add"
 * passed because shift was never applied either.
 *
 * Hence `assertModifierReaches` below: before trusting any modifier-dependent result, prove the
 * modifier actually arrives in the page. An instrument gets calibrated against a known answer
 * before its output counts as evidence.
 */
async function clickWith(page, x, y, key) {
  if (key) await page.keyboard.down(key);
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.up();
  if (key) await page.keyboard.up(key);
}

/** Prove the modifier reaches the page's events at all. */
async function assertModifierReaches(page, key, flag) {
  await page.evaluate(() => {
    window.__modProbe = [];
    window.addEventListener(
      'pointerdown',
      (e) => window.__modProbe.push({ ctrl: e.ctrlKey, shift: e.shiftKey, meta: e.metaKey }),
      true
    );
  });
  // Deliberately on the DOM swatch strip (fixed, bottom-left, z-index 10), NOT on the canvas:
  // the calibration must not disturb selection state that a later assertion depends on. The
  // listener is on window in capture phase, so it sees the event whatever the target is.
  await clickWith(page, 5, 795, key);
  await page.waitForTimeout(80);
  const seen = await page.evaluate(() => window.__modProbe ?? []);
  return seen.length > 0 && seen[seen.length - 1][flag] === true;
}

console.log('\nPhase-0 behaviors\n');

// ---------------------------------------------------------------- mount

console.log('mount');
await withPage('count=12&seed=1', async (page, errors) => {
  const st = await state(page);
  check('graph reaches the store', st.entities === 12 && st.edges === 9, `${st.entities}/${st.edges}`);
  check('viewport starts at origin, zoom 1', st.viewport.x === 0 && st.viewport.y === 0 && st.viewport.zoom === 1);
  check('nothing is selected on mount', st.selected.length === 0);
  check('mount raises no page error', errors.length === 0, errors[0]);
});

// ---------------------------------------------------------------- labels are GL

head('labels');
await withPage('count=12&seed=1', async (page) => {
    // Scoped to the flow's own container, not the whole document.
    //
    // The claim is "kookie-flow draws no label in the DOM", and an unscoped sweep answers a
    // different question: "is there any text-bearing leaf div on the page". Those agree only while
    // the fixture renders nothing but the canvas. Mounting the Toolbar — which is the point of the
    // next step, because toolbar.tsx has zero coverage from all 76 browser laws — puts real
    // design-system controls in the document, and the law would go red announcing that the DOM
    // label path came back. It would be wrong.
  const domText = await page.evaluate(() => {
    let n = 0;
    for (const el of document.querySelectorAll('[data-kookie-flow-container] div:not([data-kookie-flow-toolbar] *):not([data-kookie-flow-toolbar])')) {
      if (el.children.length === 0 && (el.textContent ?? '').trim().length > 0) n++;
    }
    return n;
  });
  // The DOM label path is deleted. A non-zero count means it came back.
  check('no label is a DOM element', domText === 0, `found ${domText}`);
});

// ---------------------------------------------------------------- pan

head('pan');
await withPage('count=12&seed=1', async (page) => {
  const before = await state(page);
  await page.mouse.move(600, 400);
  await page.mouse.down({ button: 'middle' });
  await page.mouse.move(700, 460, { steps: 8 });
  await page.mouse.up({ button: 'middle' });
  await page.waitForTimeout(200);
  const after = await state(page);

  check(
    'middle-drag moves the viewport',
    after.viewport.x !== before.viewport.x || after.viewport.y !== before.viewport.y,
    JSON.stringify(after.viewport)
  );
  check('panning does not change zoom', after.viewport.zoom === before.viewport.zoom);
  // The critical invariant: panning is a camera move, never a data edit.
  check(
    'panning does not move any entity in world space',
    JSON.stringify(after.positions) === JSON.stringify(before.positions)
  );
  check('panning selects nothing', after.selected.length === 0);
});

// ---------------------------------------------------------------- zoom

head('zoom');
await withPage('count=12&seed=1', async (page) => {
  const before = await state(page);
  await page.mouse.move(640, 400);
  await page.mouse.wheel(0, -240);
  await page.waitForTimeout(200);
  const zoomedIn = await state(page);
  check('wheel up zooms in', zoomedIn.viewport.zoom > before.viewport.zoom, `${zoomedIn.viewport.zoom}`);
  check(
    'zooming does not move any entity in world space',
    JSON.stringify(zoomedIn.positions) === JSON.stringify(before.positions)
  );

  for (let i = 0; i < 40; i++) await page.mouse.wheel(0, 240);
  await page.waitForTimeout(300);
  const zoomedOut = await state(page);
  check('zoom clamps at a positive minimum', zoomedOut.viewport.zoom > 0, `${zoomedOut.viewport.zoom}`);

  for (let i = 0; i < 80; i++) await page.mouse.wheel(0, -240);
  await page.waitForTimeout(300);
  const zoomedMax = await state(page);
  check('zoom clamps at a finite maximum', Number.isFinite(zoomedMax.viewport.zoom) && zoomedMax.viewport.zoom < 100, `${zoomedMax.viewport.zoom}`);
});

// ---------------------------------------------------------------- selection

head('selection');
await withPage('count=12&seed=1', async (page) => {
  const calibrated = await assertModifierReaches(page, 'Control', 'ctrl');
  check('INSTRUMENT: ctrl actually reaches the page', calibrated);
  if (!calibrated) return; // every result below would be meaningless

  const st = await state(page);
  const n0 = screenOf(st, 'n0');
  const n1 = screenOf(st, 'n1');

  await clickWith(page, n0.x + 40, n0.y + 30);
  await page.waitForTimeout(150);
  let s = await state(page);
  check('clicking a node selects it', s.selected.includes('n0'), JSON.stringify(s.selected));
  check('clicking a node selects only it', s.selected.length === 1, JSON.stringify(s.selected));

  // Ctrl/Cmd is the additive modifier, NOT Shift — kookie-flow.tsx:1889
  // (`const additive = e.ctrlKey || e.metaKey`). Shift is aspect-lock during resize. This
  // diverges from Figma/Illustrator/Finder; it is a choice, so the test pins the choice.
  await clickWith(page, n1.x + 40, n1.y + 30, 'Control');
  await page.waitForTimeout(150);
  s = await state(page);
  check(
    'ctrl-click adds without clearing',
    s.selected.includes('n0') && s.selected.includes('n1'),
    JSON.stringify(s.selected)
  );

  await clickWith(page, n0.x + 40, n0.y + 30);
  await page.waitForTimeout(150);
  s = await state(page);
  check(
    'plain click replaces the selection',
    s.selected.length === 1 && s.selected[0] === 'n0',
    JSON.stringify(s.selected)
  );

  const shiftCalibrated = await assertModifierReaches(page, 'Shift', 'shift');
  check('INSTRUMENT: shift actually reaches the page', shiftCalibrated);
  await clickWith(page, n0.x + 40, n0.y + 30);
  await page.waitForTimeout(120);
  await clickWith(page, n1.x + 40, n1.y + 30, 'Shift');
  await page.waitForTimeout(150);
  s = await state(page);
  check('shift-click does NOT add (shift is resize aspect-lock)', s.selected.length === 1, JSON.stringify(s.selected));

  await clickWith(page, 640, 780);
  await page.waitForTimeout(150);
  s = await state(page);
  check('clicking empty space clears the selection', s.selected.length === 0, JSON.stringify(s.selected));
});

// ---------------------------------------------------------------- drag

head('drag');
await withPage('count=12&seed=1', async (page) => {
  const before = await state(page);
  const n0 = screenOf(before, 'n0');

  // The press point is pushed clear of the viewport edges ON PURPOSE. `n0` sits near the top-left
  // of the graph, and the original press landed 39px from the top — inside the 50px band where
  // auto-scroll engages. So a law named "drag delta matches pointer travel" was measuring a
  // CORNER drag, and only passed because auto-scroll was broken: repairing it adds 1.5 world units
  // per engaged frame, which is inside the tolerance once and outside it twice. That is this
  // project's own degenerate-fixture rule — a law about the general case has to run on an input
  // where the general and special cases give different answers.
  await page.mouse.move(n0.x + 40, n0.y + 30 + EDGE_CLEARANCE);
  await page.mouse.down();
  await page.mouse.move(n0.x + 140, n0.y + 90 + EDGE_CLEARANCE, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(250);

  const after = await state(page);
  const d = {
    x: after.positions.n0.x - before.positions.n0.x,
    y: after.positions.n0.y - before.positions.n0.y,
  };
  check('dragging a node moves it', d.x !== 0 || d.y !== 0, JSON.stringify(d));
  check('drag delta matches pointer travel at zoom 1', Math.abs(d.x - 100) <= 2 && Math.abs(d.y - 60) <= 2, JSON.stringify(d));

  const others = Object.keys(before.positions).filter((k) => k !== 'n0');
  const moved = others.filter(
    (k) => before.positions[k].x !== after.positions[k].x || before.positions[k].y !== after.positions[k].y
  );
  check('dragging one unselected node moves no other node', moved.length === 0, moved.join(','));
});

// ---------------------------------------------------------------- multi-drag

head('multi-drag');
await withPage('count=12&seed=1', async (page) => {
  const st0 = await state(page);
  const n0 = screenOf(st0, 'n0');
  const n1 = screenOf(st0, 'n1');

  await clickWith(page, n0.x + 40, n0.y + 30);
  await page.waitForTimeout(120);
  await clickWith(page, n1.x + 40, n1.y + 30, 'Control');
  await page.waitForTimeout(150);

  const before = await state(page);
  if (before.selected.length !== 2) {
    check('multi-select precondition (two nodes selected)', false, JSON.stringify(before.selected));
  } else {
    await page.mouse.move(n0.x + 40, n0.y + 30);
    await page.mouse.down();
    await page.mouse.move(n0.x + 110, n0.y + 70, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(250);

    const after = await state(page);
    const d0 = {
      x: after.positions.n0.x - before.positions.n0.x,
      y: after.positions.n0.y - before.positions.n0.y,
    };
    const d1 = {
      x: after.positions.n1.x - before.positions.n1.x,
      y: after.positions.n1.y - before.positions.n1.y,
    };
    check('dragging a selected node moves every selected node', d1.x !== 0 || d1.y !== 0, JSON.stringify(d1));
    check(
      'every selected node moves by the SAME delta',
      Math.abs(d0.x - d1.x) < 0.01 && Math.abs(d0.y - d1.y) < 0.01,
      `${JSON.stringify(d0)} vs ${JSON.stringify(d1)}`
    );
  }
});

// ---------------------------------------------------------------- marquee

head('marquee');
await withPage('count=12&seed=1', async (page) => {
  // Drag a box on empty space that encloses the first row of nodes.
  await page.mouse.move(2, 2);
  await page.mouse.down();
  await page.mouse.move(700, 200, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(250);
  const s = await state(page);
  check('box-select selects the enclosed nodes', s.selected.length > 0, JSON.stringify(s.selected));
});

// ---------------------------------------------------------------- drag under zoom

head('drag under zoom');
await withPage('count=12&seed=1', async (page) => {
  // Zoom out, then drag. At zoom != 1 a pointer delta is NOT a world delta: the world moves by
  // pixels/zoom. A test that only ever runs at zoom 1 cannot tell a correct implementation from
  // one that forgot to divide, so this is the case that actually constrains the transform.
  await page.evaluate(() => window.__harness.store.getState().setViewport({ x: 60, y: 40, zoom: 0.5 }));
  await page.waitForTimeout(250);

  const before = await state(page);
  const n0 = screenOf(before, 'n0');

  await page.mouse.move(n0.x + 20, n0.y + 15);
  await page.mouse.down();
  await page.mouse.move(n0.x + 120, n0.y + 75, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(250);

  const after = await state(page);
  const d = {
    x: after.positions.n0.x - before.positions.n0.x,
    y: after.positions.n0.y - before.positions.n0.y,
  };
  check('the node moved at all', d.x !== 0 || d.y !== 0, JSON.stringify(d));
  // 100px of pointer travel at zoom 0.5 is 200 world units.
  check(
    'world delta is pointer delta / zoom',
    Math.abs(d.x - 200) <= 4 && Math.abs(d.y - 120) <= 4,
    `${JSON.stringify(d)} expected ~{x:200,y:120}`
  );
});

// ---------------------------------------------------------------- undo/redo via keyboard

head('keyboard');
await withPage('count=12&seed=1', async (page) => {
  const before = await state(page);
  const n0 = screenOf(before, 'n0');
  await page.mouse.move(n0.x + 40, n0.y + 30);
  await page.mouse.down();
  await page.mouse.move(n0.x + 140, n0.y + 30, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(200);
  const moved = await state(page);
  check('precondition: the node moved', moved.positions.n0.x !== before.positions.n0.x);

  // Select-all is the one shortcut the plugin layer is expected to own.
  await page.keyboard.press('Control+a');
  await page.waitForTimeout(200);
  const all = await state(page);
  check(
    'ctrl+a selects every entity',
    all.selected.length === all.entities,
    `${all.selected.length}/${all.entities}`
  );
});

// ---------------------------------------------------------------- sockets

head('sockets');

/**
 * A socket must be grabbable where it is PAINTED.
 *
 * The renderer, `getSocketPosition` and the store's socket index are three implementations of one
 * fact, and two of them were wrong. Measured on this scene before the repair: an output socket on
 * a width-less entity was indexed 40px left of its paint (the index defaulted to 200 where the
 * renderer uses DEFAULT_ENTITY_WIDTH), every socket jumped 12px the first time its entity moved
 * (the update path dropped the SOCKET_OFFSET its insert path applied), and a socket carrying an
 * explicit `position` was indexed at its row-layout Y instead of its fraction of the entity height
 * — 57.6px out on one of them. In each case pressing the visible dot did nothing at all.
 *
 * WHAT THIS PROVES, EXACTLY. All five copies of the arithmetic — the index, getSocketPosition,
 * the edges, the connection line and the socket renderer — now call one function, so this is no
 * longer a comparison between two independent implementations and it would NOT catch an error in
 * that function. The value laws in src/core/socket-index.test.ts are what cover the arithmetic,
 * stated against the constants. What only this can see is the whole path end to end: the value
 * reaching the GPU, the dot appearing at that place on screen, and a real pointer press landing on
 * it. The dots are found by COLOUR, with no help from the index, so nothing the index says can
 * make this pass.
 *
 * Keeping a known-duplicated implementation around so a test can compare against it was
 * considered and rejected: that is keeping the hazard as a fixture.
 */
await withPage('scene=shapes&preserveBuffer=1', async (page) => {
  // The shapes sit in one row ~2.3k wide. A 1280 viewport culls most of them, and a socket that
  // is off-screen is a socket this law silently does not check.
  await page.setViewportSize({ width: 2700, height: 800 });
  await page.waitForTimeout(200);

  // The backbuffer is only valid straight after a draw, and R3F renders on demand — a read taken
  // after an idle wait finds a cleared buffer, which reads as "the renderer drew nothing" over a
  // canvas showing seven nodes. Nudging the pointer forces a frame; the read runs inside a rAF so
  // it lands after that frame rather than before it.
  await page.mouse.move(1350, 400);
  await page.waitForTimeout(150);

  const dots = await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() =>
          resolve(
            (() => {
              const canvas = window.__harness.canvas();
              const gl = canvas.getContext('webgl2');
              const w = gl.drawingBufferWidth;
              const h = gl.drawingBufferHeight;
              const buf = new Uint8Array(w * h * 4);
              gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
              const dpr = w / canvas.clientWidth;

              // The socket palette, taken from the FROZEN table rather than from CSS.
              //
              // It used to resolve `var(--blue-10)` through the library's colour reader, on the
              // reasoning that a second copy of the theme is a second thing to go stale. That was
              // right until the palette left CSS: KookieUI v2 has none of these names, so
              // `resolveColorToRGB` returns null for all five, the wanted set empties, the scan
              // matches nothing, and this law goes red for a reason that has nothing to do with
              // what was painted.
              //
              // `frozenHue` is the source of truth on both sides of the swap — measured off v1,
              // and the only source after it. Its agreement with CSS is asserted separately,
              // while CSS still has an opinion.
              const appearance = window.__harness.themeTokens().appearance;
              const want = new Set(
                ['--blue-10', '--amber-10', '--purple-10', '--orange-10', '--cyan-10']
                  .map((t) => window.__harness.lib.frozenHue(t, appearance))
                  .filter(Boolean)
                  .map((hex) => window.__harness.lib.parseColorToRGB(hex))
                  .map(([r, g, b]) =>
                    `${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)}`
                  )
              );

              const at = (x, y) => {
                const i = (y * w + x) * 4;
                return `${buf[i]},${buf[i + 1]},${buf[i + 2]}`;
              };
              const seen = new Uint8Array(w * h);
              const blobs = [];
              for (let y = 0; y < h; y++) {
                for (let x = 0; x < w; x++) {
                  if (seen[y * w + x] || !want.has(at(x, y))) continue;
                  const stack = [[x, y]];
                  seen[y * w + x] = 1;
                  let sx = 0;
                  let sy = 0;
                  let n = 0;
                  while (stack.length) {
                    const [cx, cy] = stack.pop();
                    sx += cx;
                    sy += cy;
                    n++;
                    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                      const nx = cx + dx;
                      const ny = cy + dy;
                      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
                      if (seen[ny * w + nx] || !want.has(at(nx, ny))) continue;
                      seen[ny * w + nx] = 1;
                      stack.push([nx, ny]);
                    }
                  }
                  // readPixels is bottom-left origin; CSS is top-left.
                  blobs.push({ n, x: sx / n / dpr, y: (h - sy / n) / dpr });
                }
              }

              const st = window.__harness.store.getState();
              let sockets = 0;
              for (const e of st.entities) {
                sockets += (e.inputs?.length ?? 0) + (e.outputs?.length ?? 0);
              }
              return { blobs, sockets };
            })()
          )
        )
      )
  );

  /**
   * The freeze is faithful: every frozen hue equals what the mounted theme resolves.
   *
   * This is the whole proof that moving the palette out of CSS paints identical pixels, and it is
   * checkable only while a theme still defines these names. After the swap CSS returns null for
   * all of them, and the instrument line below says so out loud rather than letting the law pass
   * quietly on an empty comparison.
   */
  const system = await page.evaluate(() => {
    const el =
      document.querySelector('.radix-themes') ??
      document.querySelector('.kui-theme') ??
      document.documentElement;
    return getComputedStyle(el).getPropertyValue('--neutral-1').trim() !== '' ? 'v2' : 'v1';
  });

  const fidelity = await page.evaluate(() => {
    const appearance = window.__harness.themeTokens().appearance;
    const names = ['--blue-10', '--amber-10', '--purple-10', '--orange-10', '--cyan-10',
                   '--teal-10', '--pink-10', '--violet-10', '--gray-10'];
    return names.map((t) => {
      const css = window.__harness.lib.resolveColorToRGB(`var(${t})`);
      const frozen = window.__harness.lib.frozenHue(t, appearance);
      // An UNDEFINED custom property resolves to the probe's inherited colour, which is black —
      // not null. So "the theme does not define this" reads as rgb(0,0,0) and the first spelling
      // of this guard counted all nine as checkable and then failed on five of them. Black is the
      // tell, and none of the frozen hues is black.
      const undefinedInCss = !css || (css[0] === 0 && css[1] === 0 && css[2] === 0);
      if (undefinedInCss || !frozen) return { t, checkable: false };
      const f = window.__harness.lib.parseColorToRGB(frozen);
      return {
        t,
        checkable: true,
        near: css.every((c, i) => Math.abs(c - f[i]) < 0.004),
        css: css.map((c) => Math.round(c * 255)).join(','),
        frozen,
      };
    });
  });
  const checkable = fidelity.filter((f) => f.checkable);
  console.log(
    `  fidelity  ${checkable.length}/${fidelity.length} of the frozen hues are still defined by the theme`
  );
  /**
   * THE FROZEN VALUES ARE THE PALETTE, on both systems, and the fidelity check only tells us how
   * much of it the theme still has an opinion about.
   *
   * On v1 all nine resolve and all nine must agree — that agreement is what proves the freeze
   * captured what v1 painted. On v2 five of the nine are simply gone, and of the four that remain
   * (blue, amber, orange, green) NONE agrees: v2 generates its own OKLCH scale, so `--blue-10`
   * moved from `#0588f0` to `rgb(0,122,240)` and green from a muted forest to a near-fluorescent.
   *
   * That is why the resolver takes the frozen value FIRST rather than the theme's. A disagreement
   * here is expected on v2 and is not a failure; a disagreement on v1 means the freeze is wrong.
   */
  const drifted = checkable.filter((f) => !f.near);
  if (system === 'v1') {
    check(
      'INSTRUMENT: v1 defines every frozen hue, so the freeze is fully checkable',
      checkable.length === fidelity.length,
      `${checkable.length}/${fidelity.length}`
    );
    check(
      'every frozen hue equals what v1 resolves',
      drifted.length === 0,
      drifted.map((f) => `${f.t}: theme rgb(${f.css}) vs frozen ${f.frozen}`).join('; ')
    );
  } else {
    check(
      'v2 does not supply this palette, which is why it is frozen',
      checkable.length < fidelity.length,
      `${checkable.length}/${fidelity.length} still defined — if v2 ever ships all nine, revisit ` +
        `whether the freeze is still the right answer`
    );
  }

  // Vacuity guard. A scan that found nothing would let every press below pass by never running,
  // and the read HAS come back empty for a real reason (see the backbuffer note above).
  check(
    'INSTRUMENT: the scan finds a socket-coloured dot for every socket',
    dots.blobs.length >= dots.sockets,
    `${dots.blobs.length} blobs for ${dots.sockets} sockets`
  );

  const dead = [];
  for (const dot of dots.blobs) {
    await page.mouse.move(dot.x, dot.y);
    await page.mouse.down();
    await page.mouse.move(dot.x + 25, dot.y + 25, { steps: 3 });
    const draft = await page.evaluate(() => {
      const d = window.__harness.store.getState().connectionDraft;
      return d ? `${d.source.entityId}/${d.source.socketId}` : null;
    });
    await page.mouse.up();
    await page.waitForTimeout(30);
    if (!draft) dead.push(`${dot.x.toFixed(0)},${dot.y.toFixed(0)}`);
  }

  check(
    'pressing a painted socket starts a connection',
    dead.length === 0,
    dead.length ? `${dead.length}/${dots.blobs.length} painted dots did nothing: ${dead.join(' ')}` : undefined
  );
});

// ---------------------------------------------------------------- edges

head('edges');

/**
 * A bezier must end on the socket it names.
 *
 * `edges.tsx` re-derived socket Y with `max(1, out + in) * rowHeight` — a UNIFORM row height —
 * while `getEntitySocketLayout` handles stacked rows, multi-row widgets and explicit socket
 * heights. The two agree on every entity whose rows happen to be the same height, which is every
 * entity in a uniform fixture and none of the awkward ones.
 *
 * This reads the VERTICES THAT WERE DRAWN, not pixels. The pixel version of this measurement was
 * built first and thrown away: the usable scan column is outside the socket's painted disc and
 * close enough that the bezier is still near-horizontal, which is a window about one pixel wide,
 * and its readings were not reproducible between runs. Vertices are exact and have no window.
 *
 * Falsified against the pre-fix code: 10px off a stacked socket, 40px off a three-row widget,
 * 28px off a socket with an explicit height — every one of them landing on the row the uniform
 * formula predicted instead.
 */
await withPage('scene=shapes', async (page) => {
  await page.setViewportSize({ width: 2700, height: 800 });
  await page.waitForTimeout(250);

  const out = await page.evaluate(() => {
    const h = window.__harness;
    const verts = h.drawnVertices();
    const s = h.store.getState();

    const socketAt = (entityId, socketId, isInput) => {
      const e = s.entityMap.get(entityId);
      if (!e) return null;
      for (const q of s.socketQuadtree.queryPoint(e.position.x + 100, e.position.y + 100, 1400, [])) {
        if (q.entityId === entityId && q.socketId === socketId && q.isInput === isInput) return q;
      }
      return null;
    };

    const rows = [];
    for (const edge of s.edges) {
      for (const [entityId, socketId, isInput, side] of [
        [edge.source, edge.sourceSocket, false, 'source'],
        [edge.target, edge.targetSocket, true, 'target'],
      ]) {
        const sock = socketAt(entityId, socketId, isInput);
        if (!sock) continue;
        let best = Infinity;
        for (const v of verts) {
          const d = Math.hypot(v.x - sock.x, v.y - sock.y);
          if (d < best) best = d;
        }
        rows.push({ what: `${edge.id} ${side} ${entityId}/${socketId}`, dist: best });
      }
    }
    return { vertexCount: verts.length, edges: s.edges.length, rows };
  });

  // Vacuity guard. An empty scene graph would make every distance below vacuously fine, and the
  // capture DOES depend on a prototype patch landing before React mounts.
  check(
    'INSTRUMENT: the scene capture sees drawn geometry',
    out.vertexCount > 0 && out.rows.length === out.edges * 2,
    `${out.vertexCount} vertices, ${out.rows.length} endpoints for ${out.edges} edges`
  );

  const off = out.rows.filter((r) => r.dist > 0.5);
  check(
    'every edge endpoint lands on its socket',
    off.length === 0,
    off.length ? off.map((r) => `${r.what} ${r.dist.toFixed(1)}px`).join('  ') : undefined
  );
});

// ---------------------------------------------------------------- theme tokens

head('theme tokens');

/**
 * Every token the GL layer reads is actually defined by the theme.
 *
 * The reader takes a FALLBACK for anything it cannot find, and the whole fallback table is DARK.
 * A missing token therefore does not throw, does not warn, and does not look obviously wrong in
 * dark mode — it silently paints one dark value into a light UI, and the more tokens are missing
 * the more of the canvas is quietly hardcoded instead of themed.
 *
 * This is the v1 -> v2 tripwire. Today it passes: v1 defines everything the reader asks for. The
 * commit that swaps the design system will fail here and NAME each token that stopped resolving,
 * which is the difference between porting a theme and discovering six months later that half the
 * canvas never moved.
 */
await withPage('count=6', async (page) => {
  const census = await page.evaluate(() => window.__harness.tokenCensus());

  // Vacuity guard, as a DERIVATION. An empty census makes "nothing is missing" true and
  // meaningless — but so does a guard whose threshold is a number someone typed when the table
  // was a different size. This was `> 50`, calibrated against 99 tokens, and it failed on correct
  // code the day the 42 hue tokens moved into the graph's own frozen palette and left 40.
  //
  // The right question is whether the census covered everything the reader declares, which the
  // fixture now reports alongside the result.
  const censused = census.present.length + census.missing.length;
  check(
    'INSTRUMENT: the census covers every token the reader declares',
    censused === census.declared && censused > 0,
    `${censused} censused against ${census.declared} declared`
  );

  check(
    'every token the GL layer reads is defined by the theme',
    census.missing.length === 0,
    census.missing.length ? `${census.missing.length} fall back to a dark default: ${census.missing.join(' ')}` : undefined
  );
});

// ---------------------------------------------------------------- accessible names

head('accessible names');

/**
 * Every control a person can reach has a name.
 *
 * A screen-reader user could not operate this graph. Socket widgets announced as unnamed controls
 * or, worse, as DUPLICATES — three text sockets on one node all reading "Enter text…, edit text",
 * because the only thing distinguishing them was the placeholder. Six icon-only toolbar radios
 * announced as nothing at all.
 *
 * This reads the COMPUTED accessible name from a mounted DOM, not the attributes. An `aria-label`
 * that lands on a wrapper span instead of the control is exactly the failure mode here, and an
 * attribute check cannot see the difference — it is the same class of mistake as asserting a token
 * name instead of the colour it resolves to.
 *
 * ONE control is knowingly exempt and it is not fixable from this repository: kookie-ui hardcodes
 * the slider thumb's name (`Slider value: 0.5`) on the element that carries role="slider", so a
 * consumer aria-label lands on a wrapper carrying no role. A slider socket's only identity is its
 * group. The law states that rather than failing on correct code.
 */
await withPage('count=3&widgets=1', async (page) => {
  const named = await page.evaluate(() => {
    // The accessible name, computed the way a screen reader computes it — aria-label, then
    // aria-labelledby, then the label element, then the content.
    const nameOf = (el) => {
      const direct = el.getAttribute('aria-label');
      if (direct && direct.trim()) return direct.trim();
      const by = el.getAttribute('aria-labelledby');
      if (by) {
        const parts = by.split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? '');
        if (parts.join(' ').trim()) return parts.join(' ').trim();
      }
      if (el.id) {
        const lbl = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
        if (lbl?.textContent?.trim()) return lbl.textContent.trim();
      }
      const wrapping = el.closest('label');
      if (wrapping?.textContent?.trim()) return wrapping.textContent.trim();
      if (el.getAttribute('role') === 'radio' || el.tagName === 'BUTTON') {
        if (el.textContent?.trim()) return el.textContent.trim();
      }
      const title = el.getAttribute('title');
      return title && title.trim() ? title.trim() : '';
    };

    const SELECTOR = [
      'input:not([type="hidden"])',
      'textarea',
      'select',
      'button',
      '[role="radio"]',
      '[role="checkbox"]',
      '[role="combobox"]',
      '[role="slider"]',
      '[role="switch"]',
    ].join(',');

    const out = { total: 0, unnamed: [], sliders: 0 };
    for (const el of document.querySelectorAll(SELECTOR)) {
      // Skip anything hidden from assistive tech entirely — it is not a reachable control.
      if (el.closest('[aria-hidden="true"]')) continue;
      // The kookie-ui slider thumb names itself; counted, and excused, deliberately.
      if (el.getAttribute('role') === 'slider') { out.sliders++; continue; }
      out.total++;
      if (!nameOf(el)) {
        out.unnamed.push(`${el.tagName.toLowerCase()}${el.getAttribute('role') ? `[role=${el.getAttribute('role')}]` : ''}${el.type ? `[type=${el.type}]` : ''}`);
      }
    }
    return out;
  });

  // Vacuity guard. With widgets off, or a fixture that renders no controls, "nothing is unnamed"
  // is true and empty — and this fixture has to actually be rendering widgets for the socket half
  // of the law to mean anything.
  check(
    'INSTRUMENT: the sweep finds controls to check',
    named.total >= 3,
    `${named.total} reachable controls (+${named.sliders} self-naming sliders)`
  );

  check(
    'every reachable control has an accessible name',
    named.unnamed.length === 0,
    named.unnamed.length ? `${named.unnamed.length} unnamed: ${named.unnamed.join(' ')}` : undefined
  );

  // Duplicates are the half that made this unusable rather than merely unlabelled: three text
  // sockets on ONE node all announcing "Enter text…, edit text", because the placeholder was the
  // only thing distinguishing them.
  //
  // WITHIN A NODE, not across the screen. The first spelling of this compared every widget on the
  // page and failed on correct code — the fixture names each node's sockets "In 0", "In 1", so the
  // same name legitimately appears once per node. Two controls in different groups sharing a name
  // is ordinary; two in the SAME group sharing one is the defect.
  const dupes = await page.evaluate(() => {
    const perEntity = new Map();
    for (const el of document.querySelectorAll('input:not([type="hidden"]),textarea')) {
      if (el.closest('[aria-hidden="true"]')) continue;
      const name = el.getAttribute('aria-label');
      if (!name) continue;
      const entity = el.closest('[data-entity-id]')?.getAttribute('data-entity-id') ?? '(none)';
      if (!perEntity.has(entity)) perEntity.set(entity, new Map());
      const seen = perEntity.get(entity);
      seen.set(name, (seen.get(name) ?? 0) + 1);
    }
    const out = [];
    for (const [entity, seen] of perEntity) {
      for (const [name, count] of seen) if (count > 1) out.push(`${entity}: "${name}" x${count}`);
    }
    return out;
  });

  check(
    'no two widgets on one node announce the same name',
    dupes.length === 0,
    dupes.length ? dupes.join(', ') : undefined
  );
});

// ---------------------------------------------------------------- auto-scroll

head('auto-scroll');

/**
 * Dragging a node to the viewport edge scrolls the viewport.
 *
 * `runAutoScroll` opened with `if (!isDragging || ...)` where `isDragging` is React state captured
 * when the callback was created — which is before the drag-start render commits. So the FIRST
 * animation frame of every drag read false, set `active = false` and returned. Later frames worked,
 * because a committed render hands the pointermove handler a fresh closure; that is why this read
 * as intermittent rather than dead, and why it bites hardest on the gesture where the threshold
 * crossing, the entry into the edge band and the pointer stopping all land on one event.
 *
 * The law holds the pointer still inside the band, which is exactly that gesture.
 */
await withPage('count=12&seed=1', async (page) => {
  const before = await state(page);
  const n0 = screenOf(before, 'n0');

  // Press well clear of the edge, then drag INTO the top band and stop.
  await page.mouse.move(n0.x + 40, n0.y + 30 + EDGE_CLEARANCE);
  await page.mouse.down();
  await page.mouse.move(n0.x + 40, n0.y + 30 + EDGE_CLEARANCE - 40, { steps: 4 });
  await page.mouse.move(n0.x + 40, 20, { steps: 6 });
  // ...and hold. No further pointer events: whatever happens now is the rAF loop's own doing.
  await page.waitForTimeout(500);

  const during = await state(page);
  await page.mouse.up();

  check(
    'holding a drag at the viewport edge scrolls the viewport',
    during.viewport.y > before.viewport.y + 1,
    `viewport.y ${before.viewport.y} -> ${during.viewport.y}`
  );

  // The guard against over-fixing: auto-scroll must not run when nothing is being dragged.
  const idleBefore = await state(page);
  await page.mouse.move(n0.x + 40, 20);
  await page.waitForTimeout(400);
  const idleAfter = await state(page);
  check(
    'hovering the same edge with no drag scrolls nothing',
    idleAfter.viewport.y === idleBefore.viewport.y,
    `viewport.y ${idleBefore.viewport.y} -> ${idleAfter.viewport.y}`
  );
});

// ---------------------------------------------------------------- comments

head('comments');

/**
 * A comment shows the words it currently has.
 *
 * Comments are the last persistent-DOM surface in the package, and their content, background,
 * text colour and font size were all written by JSX that only re-ran when the NUMBER of comments
 * changed. Editing a comment through `onEntitiesChange` — the only route a consumer has — left the
 * div showing whatever it had at mount, for the life of the mount.
 *
 * The obvious repair is to re-render more often, and it is the wrong one: `entities.filter(...)`
 * allocates a fresh array on every store change and a drag republishes `entities` on every
 * pointermove, so a reference compare would re-render once per drag frame. The content moved into
 * the imperative path instead — the one that already runs per frame and already owns the
 * transform. So this law checks BOTH halves: the text follows, and the render count does not move.
 */
await withPage('scene=comments', async (page) => {
  const read = () =>
    page.evaluate(() =>
      Array.from(document.querySelectorAll('[data-entity-id]'))
        .filter((el) => el.dataset.bg !== undefined || el.textContent)
        .map((el) => ({
          id: el.dataset.entityId,
          text: el.textContent,
          bg: el.style.backgroundColor,
          fontSize: el.style.fontSize,
        }))
    );

  const before = await read();
  check(
    'INSTRUMENT: the comments render at all',
    before.length === 2 && before.some((c) => c.text === 'first note'),
    JSON.stringify(before)
  );

  // Edit through the store, the way a consumer's applyEntityChanges would.
  const commitsBefore = await page.evaluate(() => window.__harness.reactCommits().commits);
  await page.evaluate(() => {
    const s = window.__harness.store.getState();
    // `data`, not `update` — the change union has no `update` variant, and `applyEntityChanges`
    // ignores an unknown type SILENTLY. The first version of this law used `update` and reported
    // the comment as stale against a working fix, which is a law describing a code path that does
    // not exist.
    s.applyEntityChanges([
      {
        type: 'data',
        id: 'note-a',
        data: { content: 'edited', backgroundColor: '#B3E5FC', textColor: '#01579B', fontSize: 22 },
      },
    ]);
  });
  await page.waitForTimeout(250);

  const after = await read();
  const a = after.find((c) => c.id === 'note-a');

  check('a comment follows its content', a?.text === 'edited', JSON.stringify(a));
  check(
    'a comment follows its colour and size',
    a?.bg === 'rgb(179, 229, 252)' && a?.fontSize !== before.find((c) => c.id === 'note-a')?.fontSize,
    JSON.stringify(a)
  );

  // The other comment must be untouched — a fix that repaints everything would also pass the two
  // laws above.
  const b = after.find((c) => c.id === 'note-b');
  check('the other comment is unchanged', b?.text === 'second note', JSON.stringify(b));

  // ...and none of it cost a re-render, which is the constraint that ruled out the obvious repair.
  const commitsAfter = await page.evaluate(() => window.__harness.reactCommits().commits);
  check(
    'editing a comment costs no React commit',
    commitsAfter === commitsBefore,
    `${commitsBefore} -> ${commitsAfter}`
  );

  // Identity: swap one comment for another WITHOUT changing the count. A length-based detector
  // leaves the new one mounted blank, which is what the old code did.
  await page.evaluate(() => {
    const s = window.__harness.store.getState();
    s.applyEntityChanges([{ type: 'remove', id: 'note-b' }]);
    s.applyEntityChanges([
      {
        type: 'add',
        entity: {
          id: 'note-c',
          type: 'comment',
          position: { x: 340, y: 80 },
          width: 200,
          height: 120,
          data: { content: 'replacement', backgroundColor: '#FFCCBC', textColor: '#BF360C', fontSize: 14 },
        },
      },
    ]);
  });
  await page.waitForTimeout(400);

  const swapped = await read();
  const c = swapped.find((x) => x.id === 'note-c');
  check(
    'a comment swapped in at the same count paints',
    c?.text === 'replacement',
    JSON.stringify(swapped)
  );
});

// ---------------------------------------------------------------- keyboard scope

head('keyboard scope');

/**
 * The canvas answers keys only when the canvas has focus — and it does not lose its own keyboard
 * doing it.
 *
 * The keydown listener is on `window` and its only guard was a tagName test, so a host page
 * embedding <KookieFlow> lost five keys everywhere on the page. Focus starts on <body> on every
 * page load, so a bare `t` typed into nothing created a text entity and opened its editor;
 * Backspace pressed on a host button deleted the graph's selection; Ctrl+A selected the graph
 * rather than the page's text.
 *
 * The second half of this law is the half that makes the first safe. The editor UNMOUNTS its
 * textarea on exit, and removing a focused element resets `activeElement` to <body> — so gating on
 * focus without handing it back turns "press T, type, Escape" into a silently dead keyboard. That
 * strand only happens on the Escape path (a click-away exit refocuses the canvas by landing on
 * it), which is exactly why reading the pointer paths does not surface it.
 */
await withPage('count=6&seed=1', async (page) => {
  // A host-page control OUTSIDE the flow, focused. This is the shape a consumer embeds.
  await page.evaluate(() => {
    const b = document.createElement('button');
    b.id = 'host-button';
    b.textContent = 'host';
    document.body.appendChild(b);
    b.focus();
  });

  const before = await state(page);
  await page.evaluate(() => window.__harness.store.getState().selectEntity('n0'));

  await page.keyboard.press('Delete');
  await page.keyboard.press('Backspace');
  await page.waitForTimeout(150);
  const afterKeys = await state(page);

  check(
    'a host page keeps Delete',
    afterKeys.entities === before.entities,
    `${before.entities} -> ${afterKeys.entities} entities`
  );

  await page.keyboard.press('KeyT');
  await page.waitForTimeout(200);
  const afterT = await state(page);
  check(
    'a host page keeps a bare letter key',
    afterT.entities === before.entities,
    `${before.entities} -> ${afterT.entities} entities`
  );

  const focusHeld = await page.evaluate(() => document.activeElement?.id === 'host-button');
  check('focus stayed on the host control', focusHeld);

  // Now click into the canvas: the same keys must work.
  await page.mouse.click(640, 400);
  await page.waitForTimeout(150);
  await page.evaluate(() => window.__harness.store.getState().selectEntity('n0'));
  await page.keyboard.press('Delete');
  await page.waitForTimeout(200);
  const afterCanvas = await state(page);
  check(
    'the canvas still answers Delete when focused',
    afterCanvas.entities === before.entities - 1,
    `${before.entities} -> ${afterCanvas.entities} entities`
  );
});

await withPage('count=6&seed=1', async (page) => {
  // The strand: press T to create a text entity and enter its editor, type, then leave with
  // Escape — which unmounts the focused textarea — and check the canvas keyboard still works.
  await page.mouse.click(640, 400);
  await page.waitForTimeout(100);

  await page.keyboard.press('KeyT');
  await page.waitForTimeout(300);
  const editing = await page.evaluate(() => window.__harness.store.getState().editingEntityId);
  check('INSTRUMENT: pressing T opened a text editor', editing !== null, String(editing));

  await page.keyboard.type('hello');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);

  const afterEscape = await state(page);
  const stillEditing = await page.evaluate(() => window.__harness.store.getState().editingEntityId);
  check('Escape left the editor', stillEditing === null, String(stillEditing));

  // The keyboard has to still be alive. Select the text entity that was just made and delete it.
  await page.evaluate(() => {
    const s = window.__harness.store.getState();
    const text = s.entities.find((e) => e.type === 'text');
    if (text) s.selectEntity(text.id);
  });
  await page.keyboard.press('Delete');
  await page.waitForTimeout(250);
  const afterDelete = await state(page);

  check(
    'the canvas keyboard survives leaving a text edit with Escape',
    afterDelete.entities === afterEscape.entities - 1,
    `${afterEscape.entities} -> ${afterDelete.entities} entities`
  );
});

// ---------------------------------------------------------------- widgets

head('widgets');

/**
 * A widget follows the graph it is sitting on.
 *
 * The snapshot behind every socket widget was re-taken only when the NUMBER of entities or the SIZE
 * of the connected-socket set changed, so four ordinary things a consumer does produced nothing:
 * giving an entity a colour left its widgets on the default theme, adding a socket to an entity
 * that already had one added no widget, swapping the `widgetTypes` map kept the old components, and
 * connecting a socket did not disable the widget on it — the connected-set is rebuilt as a fresh
 * Set on every edge change and its size stays put when one connection replaces another.
 *
 * The value itself had the same shape of bug one level down: `useState(initialValue)` seeds once,
 * so a value changed anywhere but in the widget never reached the control.
 */
await withPage('count=4&seed=1&widgets=1', async (page) => {
  const countWidgets = () =>
    page.evaluate(() => document.querySelectorAll('[data-entity-id] input, [data-entity-id] textarea').length);

  const before = await countWidgets();
  check('INSTRUMENT: widgets render at all', before > 0, `${before} widgets`);

  // Adding a socket to an entity that ALREADY has sockets: the entity count does not move.
  await page.evaluate(() => {
    const s = window.__harness.store.getState();
    const first = s.entities[0];
    s.applyEntityChanges([
      {
        type: 'data',
        id: first.id,
        data: {},
      },
    ]);
    // Go through setEntities, which is the path a controlled consumer's prop takes.
    s.setEntities(
      s.entities.map((e) =>
        e.id === first.id
          ? { ...e, inputs: [...(e.inputs ?? []), { id: 'added', name: 'Added', type: 'string' }] }
          : e
      )
    );
  });
  await page.waitForTimeout(300);

  const after = await countWidgets();
  check(
    'adding a socket to an existing entity adds its widget',
    after === before + 1,
    `${before} -> ${after} widgets`
  );

  // A widget's value follows an external write.
  const wrote = await page.evaluate(async () => {
    const s = window.__harness.store.getState();
    const target = s.entities.find((e) => (e.inputs ?? []).some((i) => i.id === 'added'));
    if (!target) return null;
    s.setEntities(
      s.entities.map((e) =>
        e.id === target.id
          ? { ...e, data: { ...e.data, values: { ...(e.data?.values ?? {}), added: 'from outside' } } }
          : e
      )
    );
    return target.id;
  });
  await page.waitForTimeout(300);

  if (wrote) {
    const shows = await page.evaluate(
      (id) => {
        const scope = document.querySelector(`[data-entity-id="${id}"]`)?.parentElement;
        if (!scope) return null;
        return Array.from(scope.querySelectorAll('input,textarea')).map((el) => el.value);
      },
      wrote
    );
    check(
      'a widget value follows an external write',
      Array.isArray(shows) && shows.includes('from outside'),
      JSON.stringify(shows)
    );
  }
});

// ---------------------------------------------------------------- selection outlines

head('selection outlines');

/**
 * Selecting many entities paints their outlines at once, not in growing batches.
 *
 * The outline buffer learned how big it needed to be from a counter the writer CLAMPS at the
 * current capacity — so it could only ever discover "I need at least what I already have", grow by
 * half, and discover it again on the next frame. From the 32-slot minimum, a thousand selected
 * entities took about nine frames of 1.5x growth to converge, and each of those frames is a React
 * commit that remounts the mesh with a fresh all-zero instance buffer. What a person sees is the
 * accent outlines arriving in waves after a select-all.
 *
 * Counted in COMMITS rather than in frames: the ramp's cost is one React commit per growth step,
 * and commits are the thing this project's rules are actually about.
 */
await withPage('count=400&seed=1', async (page) => {
  await page.mouse.click(640, 400);
  await page.waitForTimeout(200);

  const before = await page.evaluate(() => window.__harness.reactCommits().commits);

  await page.keyboard.press('Control+a');
  await page.waitForTimeout(700);

  const after = await page.evaluate(() => window.__harness.reactCommits().commits);
  const selected = await page.evaluate(() => window.__harness.store.getState().selectedEntityIds.size);

  check('INSTRUMENT: select-all selected everything', selected === 400, `${selected} selected`);

  // One growth step is one commit. The ramp from 32 to 400 needs ceil(log1.5(400/32)) = 7 of them,
  // plus whatever else the gesture costs; the fix needs one. Six is comfortably between, and
  // measuring the gap rather than an exact number keeps this from being a law about React's
  // batching.
  check(
    'selecting 400 entities does not ramp the outline buffer',
    after - before < 6,
    `${after - before} commits for the whole gesture`
  );

  // ...and everything is actually outlined, which is the guard against "fixing" it by not growing.
  const drawn = await page.evaluate(() => {
    const verts = window.__harness.drawnVertices();
    return verts.length;
  });
  check('INSTRUMENT: geometry is still being drawn', drawn > 0, `${drawn} vertices`);
});

// ---------------------------------------------------------------- collapsed groups

head('collapsed groups');

/**
 * Collapsing a group takes its children's sockets and edges with it.
 *
 * The store deliberately keeps hidden entities out of the socket index, and the socket renderer
 * did not know about hidden entities at all — so a collapsed frame kept its children's socket dots
 * painted on top of it, and pressing one did nothing, because the paint and the hit test disagreed
 * about which sockets exist. Edges between two hidden children stayed drawn inside the frame.
 *
 * This is the half of the culling item that a person can actually see. The viewport half — not
 * drawing what is off-screen — is deliberately NOT here; see the finding for why it needs a
 * frame-time baseline before it is worth its hazards.
 */
await withPage('scene=group', async (page) => {
  await page.setViewportSize({ width: 1400, height: 800 });
  await page.waitForTimeout(200);

  const socketDots = async () =>
    page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => {
            const s = window.__harness.store.getState();
            let painted = 0;
            for (const e of s.entities) {
              const r = window.__harness.socketRanges?.(e.id);
              void r;
            }
            // Count what the socket index holds, which is the hit-test side.
            let indexed = 0;
            for (const e of s.entities) {
              for (const q of s.socketQuadtree.queryPoint(e.position.x + 100, e.position.y + 100, 1400, [])) {
                void q;
                indexed++;
              }
            }
            void painted;
            resolve({ indexed, hidden: s.hiddenEntityIds.size });
          })
        )
    );

  const before = await socketDots();
  check('INSTRUMENT: nothing is hidden to begin with', before.hidden === 0, JSON.stringify(before));

  // Collapse the frame, then read what is DRAWN — vertices, not attributes.
  await page.evaluate(() => {
    const s = window.__harness.store.getState();
    s.setEntities(s.entities.map((e) => (e.id === 'frame' ? { ...e, collapsed: true } : e)));
  });
  await page.waitForTimeout(400);

  const after = await page.evaluate(() => {
    const s = window.__harness.store.getState();
    const hidden = new Set(s.hiddenEntityIds);

    /**
     * The two halves are read with two different instruments, because they ARE two different
     * meshes and one instrument cannot see both.
     *
     * A socket is an INSTANCE — `drawnVertices` skips instanced meshes on purpose, since their
     * vertices are a unit quad — so sockets are read from `drawnInstances`. An edge is a ribbon,
     * an ordinary mesh, so it is read from `drawnVertices`.
     *
     * The law that stood here read only `drawnVertices` under a name about SOCKETS, so it could
     * never have seen a socket at all: it was measuring edges the whole time, and passing on
     * stale ribbon vertices past the draw range before that.
     */
    const socketPoints = window.__harness.drawnInstances().filter((p) => p.kind.startsWith('Circle'));
    const verts = window.__harness.drawnVertices();

    let paintedSockets = 0;
    let onHiddenRow = 0;
    const offenders = [];

    for (const id of hidden) {
      const e = s.entityMap.get(id);
      if (!e) continue;
      const nSockets = (e.inputs ?? []).length + (e.outputs ?? []).length;
      if (nSockets === 0) continue;

      // A socket instance belonging to this child sits within its own box's span. The window is
      // generous on purpose: the claim is "none of them is drawn", not "drawn at exactly here".
      for (const p of socketPoints) {
        if (
          p.x > e.position.x - 40 &&
          p.x < e.position.x + 260 &&
          p.y > e.position.y - 20 &&
          p.y < e.position.y + 40 * nSockets + 40
        ) {
          paintedSockets++;
        }
      }

      for (let i = 0; i < nSockets; i++) {
        const y = e.position.y + 30 + i * 40;
        for (const v of verts) {
          if (Math.abs(v.y - y) < 3 && Math.abs(v.x - e.position.x) < 300) {
            onHiddenRow++;
            offenders.push(v.kind);
          }
        }
      }
    }
    return {
      hidden: hidden.size,
      paintedSockets,
      totalSockets: socketPoints.length,
      onHiddenRow,
      kinds: [...new Set(offenders)],
    };
  });

  check('INSTRUMENT: collapsing hid the children', after.hidden >= 2, JSON.stringify(after));
  check(
    'INSTRUMENT: sockets are being drawn at all',
    after.totalSockets > 0,
    JSON.stringify(after)
  );
  check(
    'a collapsed group paints no sockets for its children',
    after.paintedSockets === 0,
    `${after.paintedSockets} socket instances drawn inside a hidden child's box`
  );
  check(
    'a collapsed group draws no edge across its hidden children',
    after.onHiddenRow === 0,
    `${after.onHiddenRow} drawn vertices sit on a hidden child's socket row, from ${after.kinds.join(' + ')}`
  );

  // Expanding brings them back — the guard against fixing this by never drawing sockets again.
  await page.evaluate(() => {
    const s = window.__harness.store.getState();
    s.setEntities(s.entities.map((e) => (e.id === 'frame' ? { ...e, collapsed: false } : e)));
  });
  await page.waitForTimeout(400);
  const restored = await page.evaluate(() => {
    const s = window.__harness.store.getState();
    return { hidden: s.hiddenEntityIds.size, verts: window.__harness.drawnVertices().length };
  });
  check(
    'expanding brings the children back',
    restored.hidden === 0 && restored.verts > 0,
    JSON.stringify(restored)
  );
});

// ---------------------------------------------------------------- GL text

head('GL text');

/**
 * The suite's only text law until now asserted a label is ABSENT from the DOM — which is exactly
 * as true when the GL text is frozen, ghosted, or gone entirely. Nothing anywhere read a glyph.
 *
 * That matters right now for two reasons. The glyph matrices are written straight into the mesh's
 * own instance array, and the ways that goes wrong are all "text vanishes or draws garbage". And
 * the entry-pooling item that is deliberately NOT being taken defeats the `entries ===
 * lastEntriesRef.current` change detector, whose failure is text freezing at whatever it said on
 * the first frame — invisible while idle, wrong from the first frame of a drag.
 *
 * So the subject is a DRAG, not a pan: panning moves the camera and leaves every glyph where it
 * was in world space, so a frozen renderer and a working one agree. Dragging a labelled node is
 * where they differ.
 */
await withPage('count=12&seed=1', async (page) => {
  const glyphs = () =>
    page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() =>
            requestAnimationFrame(() => resolve(window.__harness.glyphs()))
          )
        )
    );

  const drawn = (g) => g.filter((m) => m.count > 0);

  const g0 = await glyphs();
  check(
    'INSTRUMENT: the scene has MSDF glyph meshes drawing glyphs',
    drawn(g0).length > 0 && drawn(g0).every((m) => Number.isFinite(m.x) && Number.isFinite(m.y)),
    JSON.stringify(g0)
  );

  const before = await state(page);
  const n0 = screenOf(before, 'n0');

  await page.evaluate(() => window.__harness.mark('drag'));
  await page.mouse.move(n0.x + 40, n0.y + 30 + EDGE_CLEARANCE);
  await page.mouse.down();
  await page.mouse.move(n0.x + 140, n0.y + 30 + EDGE_CLEARANCE, { steps: 10 });

  // Read WHILE the pointer is still down. A frozen renderer that repopulates once on mouseup
  // would pass a law that only looks at the end.
  const gMid = await glyphs();
  const copies = await page.evaluate(() => window.__harness.bulkCopies());

  await page.mouse.up();
  await page.waitForTimeout(200);

  const after = await state(page);
  const moved = after.positions.n0.x - before.positions.n0.x;
  check('precondition: the drag actually moved the node', Math.abs(moved - 100) <= 2, String(moved));

  // The first glyph of SOME mesh must have travelled with the node. Which mesh holds n0's label
  // depends on weight and collection order, so the law asks whether any of them followed rather
  // than naming one — and the tolerance is against the node's own measured delta, not a constant.
  // Compared BY INDEX, so the mesh list has to be the same list. It is — which weight meshes
  // exist depends on whether bold text is on screen, and a drag does not change that — but an
  // unasserted premise is how a law comes to compare two different meshes and call it movement.
  check(
    'INSTRUMENT: the same glyph meshes are present before and during the drag',
    gMid.length === g0.length && gMid.length > 0,
    `${g0.length} -> ${gMid.length}`
  );

  const followed = gMid.some((m, i) => {
    const was = g0[i];
    return was && m.count > 0 && Number.isFinite(was.x) && Math.abs(m.x - was.x) > 20;
  });
  check(
    'GL text follows a drag rather than freezing',
    followed,
    `before=${JSON.stringify(g0)} during=${JSON.stringify(gMid)}`
  );
  check(
    'GL text is still drawn during the drag',
    drawn(gMid).length > 0,
    JSON.stringify(gMid)
  );

  /**
   * No bulk glyph copy during the gesture.
   *
   * Each weight used to fill an intermediate matrix buffer and then copy the whole live prefix
   * into the mesh's own array — 64 bytes per visible glyph per weight, every dirty frame, and a
   * `subarray` view to do it with. A heap sampler cannot see that (the memcpy allocates nothing,
   * the view is ~100 bytes), so the copies are counted instead of the bytes.
   *
   * The only `subarray` sites left in `src/` are the edge buffers' growth path, which does not run
   * while dragging one node on a fixed graph — so zero is the honest expectation, and putting
   * either copy back makes this a per-frame count.
   */
  check('no bulk Float32Array copy during a drag', copies === 0, `copies=${copies}`);
});

// ---------------------------------------------------------------- GPU teardown

head('GPU teardown');

/**
 * A rebuilt material is torn down, and what that does NOT prove is stated rather than implied.
 *
 * A theme change rebuilds nearly every material in the package — the memos are keyed on resolved
 * token colours — which makes it the cheapest way to drive the rebuild path over and over.
 *
 * THE FIRST VERSION OF THIS LAW COULD NOT FAIL, and the measurement is worth keeping because it
 * is the reason the law has the shape it has. It asserted that eight further flips leak no GPU
 * PROGRAMS. Deleting all 23 dispose effects moves that number by exactly zero: every ShaderMaterial
 * of a kind in this package has a byte-identical shader body, so three's program cache hands back
 * the same program however many materials are built, and `createProgram` never fires again. A
 * program counter cannot see a material leak in this codebase.
 *
 * So the material half is proven by counting the teardown calls instead. That is weaker and is
 * labelled as such: it shows the dispose RAN, not that the driver let go. Measured, over eight
 * flips: 8 disposals without the effects (R3F frees almost nothing on its own), 88 with them.
 *
 * WHAT THIS LAW DOES NOT COVER, said out loud rather than left for a reader to assume:
 *
 *  - The GEOMETRY half. Geometries are `[]`-memoised, so a theme flip never rebuilds one and the
 *    count is 0 both with and without the effects. Those effects fire on UNMOUNT, which this
 *    section does not drive.
 *  - The buffer leak below. It is real, it is PRE-EXISTING, and disposing materials does not
 *    touch it — see the finding printed with it.
 */
await withPage('count=12&seed=1', async (page) => {
  // Through the fixture's own helper rather than a class swap written here. v2 keys appearance on
  // `data-appearance`, not on a class — measured, adding `dark` to a `.kui-theme` div changes
  // nothing — and `document.querySelector('.radix-themes')` returns null under v2, which throws a
  // TypeError inside page.evaluate and CRASHES the run rather than failing a law.
  const setAppearance = async (_from, to) => {
    await page.evaluate((t) => window.__harness.setAppearance(t), to);
    await page.waitForTimeout(400);
  };

  const lifetimes = () => page.evaluate(() => window.__harness.glLifetimes());
  const disposals = () => page.evaluate(() => window.__harness.disposals());
  const liveOf = (l) => ({
    programs: l.programsCreated - l.programsDeleted,
    buffers: l.buffersCreated - l.buffersDeleted,
  });

  // Warm-up: one full round trip, so every material has compiled in both appearances and the
  // first-flip cost is out of the way. A total measured against a constant would be a law about
  // warm-up rather than about teardown.
  await setAppearance('light', 'dark');
  await setAppearance('dark', 'light');
  const warm = liveOf(await lifetimes());
  const disposedWarm = await disposals();

  check(
    'INSTRUMENT: the driver counters are actually counting',
    warm.programs > 0 && warm.buffers > 0,
    JSON.stringify(warm)
  );

  const FLIPS = 8;
  for (let i = 0; i < FLIPS / 2; i++) {
    await setAppearance('light', 'dark');
    await setAppearance('dark', 'light');
  }
  const after = liveOf(await lifetimes());
  const disposedAfter = await disposals();

  const dMat = disposedAfter.material - disposedWarm.material;
  const dGeo = disposedAfter.geometry - disposedWarm.geometry;
  const dBuf = after.buffers - warm.buffers;
  const dProg = after.programs - warm.programs;

  // Printed on every run, not only on failure: a threshold whose inputs are invisible is one
  // nobody can re-derive later.
  console.log(`  measured  materials disposed +${dMat}, geometries +${dGeo}`);
  console.log(`  measured  programs +${dProg}, buffers ${warm.buffers} -> ${after.buffers} (+${dBuf})`);

  // The threshold is set from measurement in BOTH directions: 8 without the dispose effects,
  // 88 with. Two per flip is comfortably above the floor and comfortably below the ceiling, so
  // this fails on a teardown that stops running without failing on one that runs a little less.
  check(
    `each theme flip tears down the materials it replaced`,
    dMat >= FLIPS * 2,
    `${dMat} materials disposed over ${FLIPS} flips (8 with the effects deleted, 88 with them)`
  );

  /**
   * PRE-EXISTING AND NOT FIXED HERE. Recorded with its number so the next person starts from a
   * measurement rather than from scratch.
   *
   * Eight theme flips leak about 128 GL buffers, roughly 16 per flip, and that number is
   * IDENTICAL with all 23 dispose effects present and with all of them deleted — so it is not a
   * material or geometry leak and C25's fix does not touch it. The likely cause is R3F
   * reconstructing every instanced mesh when `args` changes (a rebuilt material is a new `args`
   * entry), which mints a fresh `instanceMatrix` and a fresh set of `InstancedBufferAttribute`s
   * while nothing frees the old mesh's. Not fixed here because the repair — keeping the material
   * out of `args` — changes when the buffer-init callback ref re-runs, and that callback ref IS
   * the C24 fix that makes a theme change reach WebGL at all. It needs its own item.
   *
   * Asserted as a CEILING that today's behaviour passes, so it cannot get worse unnoticed, and
   * NOT as zero, which would be a red law nobody can act on.
   */
  check(
    'the known per-flip buffer leak does not get worse',
    dBuf <= FLIPS * 20,
    `${dBuf} buffers over ${FLIPS} flips (about ${Math.round(dBuf / FLIPS)} per flip; ~16 is the recorded pre-existing rate)`
  );
});

head('theme plumbing');

/**
 * The two things the token census cannot see, and both of them are what a design-system swap gets
 * wrong.
 *
 * THE HOST. The census asks "is this token defined". Under v1 that question had teeth, because v1
 * scoped its tokens to `.radix-themes` and a probe outside it resolved nothing at all. v2 declares
 * at `:root` and re-declares inside the Theme's own `[data-appearance]` scope, so a probe on
 * `<html>` resolves EVERY token successfully — at the root appearance rather than the Theme's.
 * Measured: the present/missing split over all 99 tokens is identical at `<html>` and inside the
 * Theme, so the census's own verdict is blind to the difference. The only defence is asserting
 * WHICH NODE is being read.
 *
 * THE VALUES. `--space-N` in v1 is `--space-(N+1)` in v2 — every name the reader asks for exists
 * in both, so a socket row goes 40px to 32px and a widget 32px to 24px with the census green and
 * nothing else in the repo reading a space value at all. Same shape for radius: v2's default level
 * is `full`, where `--radius-4` is 9999px and every SDF site clamps the corner, so a node body
 * becomes a stadium with no error anywhere.
 *
 * These run on v1 today. That is the point — they are written BEFORE the swap so they can fail
 * during it.
 */
await withPage('count=12&seed=1', async (page) => {
  const root = await page.evaluate(() => window.__harness.themeRoot());

  check(
    'the token host is the theme element, not the document',
    !root.isDocumentElement && root.tag !== 'BODY',
    JSON.stringify(root)
  );

  /**
   * The package resolves the host independently of the fixture, and this asserts they AGREE.
   *
   * THE FIRST SPELLING OF THIS LAW COULD NOT FAIL, and its own sabotage caught it: it created a
   * span, appended it to the fixture's answer, and then checked the span's parent was the fixture's
   * answer — true by construction, and it stayed green while the fixture was sabotaged to return
   * `document.documentElement`. Comparing a mechanism against itself is not an agreement law.
   *
   * The package's answer is reachable only through its behaviour: `getColorProbe` (src/utils/
   * color.ts) parents a hidden span to whatever IT resolved, so forcing a colour resolution and
   * then finding that span tells us where the PACKAGE thinks the theme is.
   */
  const agree = await page.evaluate(() => {
    // Force the package to build and parent its probe.
    window.__harness.lib.resolveColorToRGB('var(--accent-9)');
    const spans = [...document.querySelectorAll('span')].filter(
      (el) => el.style.visibility === 'hidden' && el.style.position === 'absolute'
    );
    const pkg = spans.length ? spans[spans.length - 1].parentElement : null;
    const fixture = window.__harness.themeRoot();
    return {
      found: spans.length,
      same:
        pkg !== null &&
        pkg.tagName === fixture.tag &&
        (pkg.className || '') === fixture.className &&
        (pkg === document.documentElement) === fixture.isDocumentElement,
      pkg: pkg ? `${pkg.tagName}.${pkg.className}` : null,
      fixture: `${fixture.tag}.${fixture.className}`,
    };
  });
  check('INSTRUMENT: the package built a probe to locate', agree.found > 0, JSON.stringify(agree));
  check('the fixture and the package resolve the same host', agree.same, JSON.stringify(agree));

  const v = await page.evaluate(() => window.__harness.tokenValues());
  console.log(`  measured  ${Object.entries(v).map(([k, n]) => `${k}=${n}`).join('  ')}`);

  /**
   * What the READER resolved, which is a different question from what the CSS says.
   *
   * The space scale is off by one index between v1 and v2 — v1's N is v2's N+1 — and every name
   * exists on both systems, so the raw-CSS assertions above are about the design system while
   * THIS is about the graph. The reader identifies which system is mounted and shifts the index,
   * so a socket row is 40px and a widget 32px on either side of the swap. Those two numbers are
   * the whole point of the shift; if they move, every node in the graph shrank by a fifth.
   */
  const resolved = await page.evaluate(() => {
    const t = window.__harness.themeTokens();
    return { s6: t['--space-6'], s7: t['--space-7'], s3: t['--space-3'] };
  });
  console.log(`  resolved  socket-row=${resolved.s7} widget=${resolved.s6} gap=${resolved.s3}`);
  check(
    'the reader resolves the socket row at 40px on either design system',
    resolved.s7 === 40,
    `reader says ${resolved.s7} (v1 --space-7 and v2 --space-8 are both 40)`
  );
  check(
    'the reader resolves the widget height at 32px on either design system',
    resolved.s6 === 32,
    `reader says ${resolved.s6}`
  );

  /**
   * The RAW palette, per design system.
   *
   * These were written against v1's numbers before the swap so they would FAIL during it, and they
   * did — exactly here: v2's `--space-7` is 32 where v1's is 40, and `--space-6` is 24 where v1's
   * is 32. Both names exist on both systems, so nothing else in the repo could have seen it.
   *
   * They are kept rather than deleted, and made per-system rather than loosened. The claim is
   * still checkable and still specific: each palette has its own known shape, and a drift in
   * either one is a real change. What is NOT asserted here any more is the graph's geometry —
   * that is the reader's business and the two laws above own it, which is why the space shift
   * shows up there as unchanged while it shows up here as a different palette.
   */
  // `themeRoot()` on the harness API returns a DESCRIPTOR, not the element — the element cannot
  // cross the page boundary. Resolved inline, the same three-arm chain the fixture and the package
  // both use.
  const system = await page.evaluate(() => {
    const el =
      document.querySelector('.radix-themes') ??
      document.querySelector('.kui-theme') ??
      document.documentElement;
    // `--neutral-1` is v2's and exists in no v1 build; v1's greys were `--gray-*`.
    return getComputedStyle(el).getPropertyValue('--neutral-1').trim() !== '' ? 'v2' : 'v1';
  });
  const palette = system === 'v2'
    ? { '--space-7': 32, '--space-6': 24 }
    : { '--space-7': 40, '--space-6': 32 };
  for (const [name, want] of Object.entries(palette)) {
    check(
      `${system}: ${name} is ${want}px`,
      v[name] === want,
      `${name}=${v[name]} on ${system}`
    );
  }
  check('the label type step is 14px', v['--font-size-2'] === 14, `--font-size-2=${v['--font-size-2']}`);
  check('the line box is 24px', v['--line-height-3'] === 24, `--line-height-3=${v['--line-height-3']}`);

  /**
   * A node body's corner is a corner.
   *
   * v2's DEFAULT radius level is `full`, where `--radius-1..5` are all `calc(9999px * var(--scale))`
   * — and every SDF site clamps `r = min(r, min(halfW, halfH))`, so a node body becomes a stadium
   * with no error, no missing token and nothing in the suite to notice. The fixture pins `large`
   * so the swap stays a PORT; moving the node body onto `--radius-surface-N`, which is capsule-proof
   * by construction at every level, is a design step of its own and is not being smuggled in here.
   */
  check(
    'the node body radius token is a corner, not a capsule',
    v['--radius-4'] > 0 && v['--radius-4'] < 100,
    `--radius-4=${v['--radius-4']} — v2's default level is \`full\`, where this is 9999`
  );
});

head('token read validity');

/**
 * A legal theme setting must not make the GL layer STOP LISTENING.
 *
 * `areTokensValid` decides whether a DOM read succeeded, and every later read is discarded when it
 * says no — so a false negative does not paint one wrong frame, it freezes the graph at whatever
 * it read first and ignores every theme change after that, silently and for the life of the page.
 *
 * The sentinel used to be `--space-3 > 0 && --radius-4 > 0`, and a radius is a DESIGNER'S CHOICE,
 * not evidence about whether a read worked. `<Theme radius="none">` is an ordinary setting on both
 * design systems — v1 multiplies its whole radius scale by `--radius-factor: 0` at that level
 * (measured: the reader receives `calc(12px * 1 * 0)` and parses 0), v2 emits `--radius-4: 0px`
 * outright — so this has been live since the sentinel was written and is not a v2 hazard at all.
 * The partner is a type step now, which no legal configuration zeroes.
 *
 * THE FIRST VERSION OF THIS LAW ASSERTED THE WRONG THING and its sabotage caught it. It claimed a
 * dark canvas, on the reasoning that the reader keeps its entirely-dark FALLBACK table. Measured,
 * that is not what happens: the FIRST read lands before the Theme has stamped `data-radius`, is
 * accepted, and the tokens freeze there — light and correct-looking. So the law asserted a
 * symptom the defect does not produce, and passed identically with the bug restored. What the
 * defect actually costs is the NEXT change, which is what this drives.
 *
 * It also carries the suite's first painted-colour assertions. `readPixel` had ZERO callers among
 * all 84 laws before this, so every colour claim in the repo was unmeasured.
 */
await withPage('count=6&seed=1&appearance=light&radius=none&preserveBuffer=1', async (page) => {
  await page.waitForTimeout(500);

  const sample = () =>
    page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => {
            const c = document.querySelector('canvas');
            const ctx = c.getContext('webgl2');
            const dpr = c.width / c.clientWidth;
            const buf = new Uint8Array(4);
            let ink = 0, r = 0, g = 0, b = 0;
            for (let x = 20; x < 190; x += 6) {
              for (let y = 20; y < 120; y += 6) {
                ctx.readPixels(
                  Math.round(x * dpr), Math.round(c.height - y * dpr),
                  1, 1, ctx.RGBA, ctx.UNSIGNED_BYTE, buf
                );
                if (buf[3] > 10) { ink++; r += buf[0]; g += buf[1]; b += buf[2]; }
              }
            }
            resolve({ ink, mean: ink ? (r + g + b) / (3 * ink) : null });
          })
        )
    );

  const light = await sample();
  check('INSTRUMENT: node pixels are drawn at radius="none"', light.ink > 20, JSON.stringify(light));
  check(
    'a light theme paints light node bodies at radius="none"',
    light.mean !== null && light.mean > 128,
    `mean channel ${light.mean} over ${light.ink} node pixels`
  );

  // The one that catches the sentinel. Under the radius gate every read after the first is
  // discarded, so this flip reaches the DOM and never reaches the GL layer.
  await page.evaluate(() => window.__harness.setAppearance('dark'));
  await page.waitForTimeout(700);
  const dark = await sample();

  check(
    'a theme change still reaches the GL layer at radius="none"',
    dark.mean !== null && light.mean !== null && light.mean - dark.mean > 60,
    `light ${light.mean} -> dark ${dark.mean} (the graph freezes at its first read when the ` +
      `validity sentinel rides a token the designer is allowed to zero)`
  );
});

head('toolbar');

/**
 * The toolbar had ZERO coverage from every law in this suite, and it is the file with the largest
 * v1 -> v2 API break in the package.
 *
 * `harness/fixture/app.tsx` mounted only `<KookieFlow>`, which renders no toolbar, and no unit
 * test imports `toolbar.tsx` — so 923 lines holding a Card, two Selects, three SegmentedControls,
 * six icon segments, a TextField and a component that does not exist in v2 (`ToggleIconButton`)
 * were checked by nothing at all. This baseline is taken ON v1, deliberately and before the swap:
 * a baseline taken afterwards cannot tell a correct port from a plausible one.
 */
await withPage('scene=toolbar&toolbar=1', async (page) => {
  await page.setViewportSize({ width: 1400, height: 800 });
  await page.waitForTimeout(300);

  const show = async (id) => {
    await page.evaluate((i) => window.__harness.store.getState().selectEntity(i, false), id);
    await page.waitForTimeout(400);
  };

  await show('txt');

  const shown = await page.evaluate(() => {
    const el = document.querySelector('[data-kookie-flow-toolbar]');
    if (!el) return { mounted: false };
    return {
      mounted: true,
      visible: getComputedStyle(el).visibility === 'visible',
      controls: el.querySelectorAll('button, input, [role="combobox"], [role="radio"], [role="slider"]').length,
    };
  });
  check('INSTRUMENT: the toolbar mounts', shown.mounted, JSON.stringify(shown));
  check('selecting a text entity shows the toolbar', shown.visible, JSON.stringify(shown));
  check('the text toolbar renders its controls', shown.controls >= 8, JSON.stringify(shown));

  /**
   * Every reachable control announces a name.
   *
   * The same claim the widgets sweep makes, on a surface built almost entirely from icon-only
   * buttons and icon segments — where a missing label is invisible by eye and total to a screen
   * reader. It is also the assertion most likely to break in the swap: v2 refuses `iconOnly` on a
   * segment, so every one of those six call sites is being rewritten.
   */
  const names = await page.evaluate(() => {
    const root = document.querySelector('[data-kookie-flow-toolbar]');
    const out = [];
    for (const el of root.querySelectorAll('button, input, [role="combobox"], [role="radio"], [role="slider"], [role="switch"]')) {
      if (el.closest('[aria-hidden="true"]')) continue;
      const label =
        el.getAttribute('aria-label') ||
        (el.getAttribute('aria-labelledby')
          ? [...document.querySelectorAll(`#${CSS.escape(el.getAttribute('aria-labelledby'))}`)]
              .map((n) => n.textContent)
              .join(' ')
          : '') ||
        (el.labels && el.labels.length ? [...el.labels].map((l) => l.textContent).join(' ') : '') ||
        (el.textContent ?? '').trim() ||
        el.getAttribute('title') ||
        '';
      out.push({ tag: el.tagName, role: el.getAttribute('role'), name: label.trim() });
    }
    return out;
  });
  const unnamed = names.filter((n) => !n.name);
  check('INSTRUMENT: the toolbar sweep finds controls', names.length >= 8, `${names.length} controls`);
  check(
    'every toolbar control has an accessible name',
    unnamed.length === 0,
    unnamed.map((n) => `${n.tag}${n.role ? `[${n.role}]` : ''}`).join(', ')
  );

  /**
   * A Select's closed trigger shows its LABEL, not its value.
   *
   * The font-weight select carries value "400" with the label "Regular" and the font-family select
   * "system-ui" with "System". v2 resolves a closed trigger's text from an `items` map on the root
   * and NEVER from the chosen row — its own prop doc says "without it the trigger paints the raw
   * value string forever" — so both of these regress silently unless the swap adds `items`. There
   * is no compile error for it, which is why it needs a law rather than a note.
   */
  const triggers = await page.evaluate(() => {
    const root = document.querySelector('[data-kookie-flow-toolbar]');
    return [...root.querySelectorAll('[role="combobox"], select, button[aria-haspopup="listbox"]')].map(
      (el) => (el.textContent ?? '').trim()
    );
  });
  check('INSTRUMENT: the toolbar has select triggers', triggers.length >= 1, JSON.stringify(triggers));
  check(
    'a select trigger shows a label, not a raw value',
    triggers.every((t) => t !== '400' && t !== 'system-ui' && t !== ''),
    JSON.stringify(triggers)
  );

  // The other two entity types reach the rest of the built-in registry.
  /**
   * Counted by ACCESSIBLE NAME, not by element.
   *
   * Counts are measured, never guessed — the first spelling asserted `>= 3` for the comment
   * toolbar from its three-entry widget list and measured 2, because a colour widget renders as
   * one control and not one per swatch. But the second spelling counted raw elements, and that
   * turned out to be a law about the design system's internals rather than about the toolbar:
   * v2's `SegmentedItem` renders TWO elements where v1's rendered one, so the image toolbar went
   * from 4 elements to 7 across the swap while offering the same four controls — Fill, Cover,
   * Contain, and the aspect lock.
   *
   * A name is what a person operates and what a screen reader announces, and it survives a
   * component library replacing its markup. Pinned per type, so the swap still fails if a control
   * actually disappears.
   */
  for (const [id, expected] of [['img', 4], ['note', 2]]) {
    await show(id);
    const n = await page.evaluate(() => {
      const el = document.querySelector('[data-kookie-flow-toolbar]');
      const named = new Set();
      for (const c of el.querySelectorAll('button, input, [role="combobox"], [role="radio"], [role="switch"]')) {
        const n = (c.getAttribute('aria-label') || (c.textContent ?? '').trim()).trim();
        if (n) named.add(n);
      }
      return {
        visible: getComputedStyle(el).visibility === 'visible',
        controls: el.querySelectorAll('button, input, [role="combobox"], [role="radio"]').length,
        named: named.size,
        names: [...named],
      };
    });
    check(
      `the ${id} toolbar shows, with the controls v1 offered`,
      n.visible && n.named === expected,
      `${n.named} named controls [${n.names.join(', ')}] in ${n.controls} elements ` +
        `(v1 baseline: ${expected} named)`
    );
  }
});

// ---------------------------------------------------------------- summary

console.log(
  `\n${passed} passed, ${failures.length} failed` +
    (skippedSections ? ` — ${skippedSections} SECTIONS SKIPPED by KUI_ONLY=${ONLY}` : '') +
    '\n'
);
if (failures.length) {
  for (const f of failures) console.log(`  FAIL ${f.name}${f.detail ? ` — ${f.detail}` : ''}`);
}

await context.close();
await browser.close();
server.close();
process.exit(failures.length ? 1 : 0);
