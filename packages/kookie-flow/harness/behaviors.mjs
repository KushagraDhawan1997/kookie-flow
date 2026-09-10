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

  /**
   * The two driver facts, asserted at the only place they exist.
   *
   * Both of these have already shipped broken and neither cost a single failing test.
   *
   * The context was created with `depth: false` — a stale comment called it a Safari performance
   * choice — so DEPTH_BITS was 0 and every `depthTest: true` in the package did nothing. Ordering
   * fell back to `renderOrder`, which is per LAYER, so every widget in the scene painted above
   * every unselected node body and two overlapping nodes interleaved. entity-depth.test.ts still
   * passed: it asserts the arithmetic and never leaves JS.
   *
   * And a fragment shader once referenced an instanced attribute, which does not exist in a
   * fragment shader, so the program failed to link and every field, select and colour widget drew
   * nothing at all. three logs it and carries on with a null program — the mesh is still in the
   * scene graph, `drawnInstances` still reports its instances, and every count law stays green
   * while the screen is empty.
   */
  const facts = await page.evaluate(() => window.__harness.contextFacts());
  check(
    'the canvas asks for a depth buffer and gets one',
    facts.depth?.requested === true && facts.depth.bits > 0,
    JSON.stringify(facts.depth) + ' — with 0 bits every depthTest in the package is a no-op'
  );
  check(
    'every shader links',
    facts.linkFailures.length === 0,
    facts.linkFailures.map((f) => f.log.trim().split('\n')[0]).join(' | ')
  );
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
   * WHICH of the nine v2 still defines, named one by one — not how many.
   *
   * This used to fork on a `system` probe that asked whether `--neutral-1` resolved, answering
   * 'v1' when it did not. Under v2 that token is declared at `:root` and re-declared in both
   * appearance scopes, so the probe could only ever answer 'v2' — and the two laws inside the v1
   * arm ("v1 defines every frozen hue" and "every frozen hue equals what v1 resolves") stopped
   * executing entirely. They did not fail. They vanished, and a suite that prints one fewer `ok`
   * line reports exactly the same `0 failed` as one that prints them all. That is the shape this
   * file hunts for elsewhere and had a live instance of.
   *
   * What replaced it is stronger than the inequality it also replaces. `checkable.length <
   * fidelity.length` passed at 3/9 and would keep passing at 8/9 — it could not tell which hues
   * v2 dropped, so v2 re-adding `--purple-10` with a different value than the frozen one slid
   * straight under it. The partition is asserted by name: v2 either dropping or re-adding a hue
   * goes red, and the person who reads the failure is told which one moved.
   */
  const SUPPLIED_BY_V2 = ['--blue-10', '--amber-10', '--orange-10'];
  const supplied = checkable.map((f) => f.t).sort();
  check(
    'v2 supplies exactly three of the frozen hues, which is why the rest are frozen',
    supplied.join(',') === [...SUPPLIED_BY_V2].sort().join(','),
    `defined: ${supplied.join(', ') || '(none)'} — expected ${SUPPLIED_BY_V2.join(', ')}. ` +
      `A hue moving in or out of this set means v2's palette changed; decide whether the freeze ` +
      `is still the right answer before editing this list.`
  );

  /**
   * The three v2 DOES define do not agree with the freeze, and that is the finding, not a fault.
   *
   * v2 generates its own OKLCH scale, so `--blue-10` moved from `#0588f0` to `rgb(0,122,240)`.
   * That disagreement is exactly why `resolveColorToRGB` takes the frozen value FIRST rather than
   * the theme's. Asserting it here means the day v2's scale converges on the frozen one, someone
   * is told — rather than the fact sitting in a comment that says "NONE agrees" about four hues
   * while the list next to it names three.
   */
  const drifted = checkable.filter((f) => !f.near);
  check(
    'the hues v2 does define disagree with the freeze, so the freeze is doing the work',
    checkable.length > 0 && drifted.length === checkable.length,
    drifted.map((f) => `${f.t}: theme rgb(${f.css}) vs frozen ${f.frozen}`).join('; ') ||
      '(nothing checkable — the instrument above should have caught this)'
  );

  /**
   * WHERE EVERY SOCKET WAS DRAWN, against where the index says a press is answered.
   *
   * This replaces a blob-count guard that read `blobs.length >= sockets` — and that comparison was
   * never measuring what its name claimed. A flood fill counts CONNECTED COMPONENTS of
   * socket-coloured pixels, and a socket dot is not reliably one of those: a hollow ring crossed by
   * anything breaks into arcs, so one socket can yield four blobs of one to four pixels each, and
   * an occluded one yields none. Measured on the shapes scene: 17 sockets produced ten whole dots
   * plus six fragments, and the law reported 16 — a number arrived at by two errors cancelling.
   * It had been failing by one for as long as the scene has existed, and the fragments were why.
   *
   * Counting pixels was the wrong instrument for the question. `drawnInstances()` reports the
   * translation the GPU was actually handed for each socket, and `indexedSockets()` reports what
   * the quadtree will answer a press with. Comparing those two is exact, names the socket that
   * moved, and is the same shape as the widget paint-vs-press law.
   */
  const placement = await page.evaluate(() => {
    const drawn = window.__harness
      .drawnInstances()
      .filter((d) => d.kind === 'sockets' || d.kind === 'sockets-selected');
    const indexed = window.__harness.indexedSockets();
    const missing = indexed.filter(
      (s) => !drawn.some((d) => Math.hypot(d.x - s.x, d.y - s.y) < 1.5)
    );
    return {
      drawn: drawn.length,
      indexed: indexed.length,
      missing: missing.map((s) => `${s.entityId}/${s.socketId}@${Math.round(s.x)},${Math.round(s.y)}`),
    };
  });
  check(
    'INSTRUMENT: the scene indexes sockets to check',
    placement.indexed === dots.sockets && placement.indexed > 0,
    `${placement.indexed} indexed, ${dots.sockets} on the entities`
  );
  check(
    'every socket is drawn where pressing it is answered',
    placement.missing.length === 0,
    `${placement.missing.length} of ${placement.indexed} not drawn at their indexed point: ` +
      placement.missing.join(' ')
  );

  // Vacuity guard for the PRESS sweep below, which walks painted pixels. Blob count is not socket
  // count (see above), so this asks only that the scan found something to press.
  check(
    'INSTRUMENT: the scan finds socket-coloured pixels to press',
    dots.blobs.length > 0,
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
 * WHAT THIS SECTION COVERS AGAIN, AND HOW IT GOT BACK. The seven built-in socket widgets moved
 * from DOM controls into WebGL, which took them out of the accessibility tree entirely — a canvas
 * has no roles, no names and no keyboard focus for the things drawn inside it — and for a while
 * this docstring recorded that as an open gap with two candidate fixes and no decision. The fix
 * taken is the first of them: an off-screen focusable DOM mirror, bounded to the ONE node the
 * keyboard cursor is standing on (components/widget-a11y-mirror.tsx, decisions.md D7). So the
 * sweep covers four things now — the toolbar, a consumer-supplied widget, the input borrowed
 * during an edit, and the focused node's mirrored socket widgets.
 *
 * WHICH IS WHY THE PAGE IS FOCUSED AND ARROWED BELOW BEFORE ANYTHING IS COUNTED. A mirror only
 * exists once a node has the cursor on it. Without those two lines this law would still pass, on
 * the toolbar and the custom widget alone — `named.total >= 3` would be satisfied and the socket
 * half of the claim would be measuring nothing. The scene is `widgets`, whose six sockets are one
 * of each kind, rather than the random socket types a grid produces.
 *
 * ONE control is knowingly exempt and it is not fixable from this repository: kookie-ui hardcodes
 * the slider thumb's name (`Slider value: 0.5`) on the element that carries role="slider", so a
 * consumer aria-label lands on a wrapper carrying no role. A slider socket's only identity is its
 * group. The law states that rather than failing on correct code. It no longer applies to a SOCKET
 * slider: the mirror uses a real `input[type=range]`, which names itself from its own aria-label
 * and carries the role, the value and the keyboard model natively.
 */
await withPage('scene=widgets&widgets=1&customWidget=1', async (page) => {
  // Put the keyboard cursor on a node, which is what brings its mirror into existence.
  await page.evaluate(() => document.querySelector('[data-kookie-flow-container]').focus());
  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(250);

  const mirrored = await page.evaluate(
    () => document.querySelectorAll('[data-a11y-mirror]').length
  );
  check(
    'INSTRUMENT: the focused node put its widgets in the accessibility tree',
    mirrored > 0,
    `${mirrored} mirrored controls`
  );

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
//
// RE-KEYED ONTO THE SURVIVING DOM PATH. The seven built-in widgets draw in WebGL now and take
// their interaction there — see the `GL widgets` section, which covers them end to end. What is
// still DOM, and what these laws are now about, is a widget component the CONSUMER supplied: the
// library cannot draw a component it has never seen, and `plans/technical-decisions.md` names
// custom node content as the escape hatch that stays in the DOM.
//
// The bugs described above were about the SNAPSHOT behind the widget list, which the custom path
// shares line for line — so this still guards them, on the only widgets that can still show them.
await withPage('count=4&seed=1&widgets=1&customWidget=1', async (page) => {
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

  // The law below used to sit inside `if (wrote)` with no `else`. When the socket named 'added'
  // is not on any entity — a fixture edit, a setEntities that drops unknown sockets — the whole
  // law EVAPORATED: one fewer `ok` line, `failures` still empty, and the summary still `0 failed`.
  // Nothing in this runner compares the pass count against an expected total, so a suite that
  // quietly shrinks is indistinguishable from one that quietly passes.
  check('INSTRUMENT: the added socket reached an entity', wrote !== null, String(wrote));

  const shows = await page.evaluate(
    (id) => {
      if (!id) return null;
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
            // What the socket INDEX holds, which is the hit-test side. There used to be a second
            // loop above this one that called `window.__harness.socketRanges?.(e.id)` to count
            // painted dots — but no such method exists on the harness API, so the optional call
            // short-circuited to undefined on every iteration, the counter it fed was incremented
            // nowhere, and both were then `void`ed. A loop with a dead body, kept alive by `?.`,
            // inside a function whose name promised it counted paint.
            let indexed = 0;
            for (const e of s.entities) {
              for (const q of s.socketQuadtree.queryPoint(e.position.x + 100, e.position.y + 100, 1400, [])) {
                void q;
                indexed++;
              }
            }
            resolve({ indexed, hidden: s.hiddenEntityIds.size });
          })
        )
    );

  const before = await socketDots();
  check('INSTRUMENT: nothing is hidden to begin with', before.hidden === 0, JSON.stringify(before));
  // And the index has something in it, or the post-collapse comparison below is measuring a drop
  // from zero to zero.
  check('INSTRUMENT: the socket index is populated before collapsing', before.indexed > 0, JSON.stringify(before));

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
    // Matched by NAME, not by geometry type. This read `kind.startsWith('Circle')`, which worked
    // only while the socket meshes were anonymous and `drawnInstances` fell back to describing
    // their geometry — so naming them (which a placement law needed, to tell them apart from
    // whatever else is round) silently emptied this list and the law started reporting zero
    // sockets painted, which is the answer it wants to hear. A name is an identity; a geometry
    // type is a shape that anything may share.
    const socketPoints = window.__harness
      .drawnInstances()
      .filter((p) => p.kind === 'sockets' || p.kind === 'sockets-selected');
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
   * watching where that span lands tells us where the PACKAGE thinks the theme is.
   *
   * WATCHED DURING THE CALL, not looked for afterwards. The probes are ephemeral now — attached,
   * read and removed inside one synchronous call — because a probe left parented inside the
   * server-rendered `.kui-theme` element during a React hydration render makes React 19 throw a
   * mismatch on the leftover sibling, which is what the docs app was reporting. So a law that
   * queries the document after the call finds nothing and fails, which is what this one did the
   * moment the probes changed. Hooking `appendChild` still observes the package's own choice
   * rather than assuming it, so the law is as capable of failing as it was.
   */
  const agree = await page.evaluate(() => {
    const parents = [];
    const original = Element.prototype.appendChild;
    Element.prototype.appendChild = function patched(node) {
      const result = original.call(this, node);
      if (
        node instanceof HTMLElement &&
        node.tagName === 'SPAN' &&
        node.style.visibility === 'hidden' &&
        node.style.position === 'absolute'
      ) {
        parents.push(this);
      }
      return result;
    };
    try {
      // Force the package to build and parent its probe.
      window.__harness.lib.resolveColorToRGB('var(--accent-9)');
    } finally {
      Element.prototype.appendChild = original;
    }

    const pkg = parents.length ? parents[parents.length - 1] : null;
    const fixture = window.__harness.themeRoot();
    return {
      found: parents.length,
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
   * They are kept rather than deleted, and stated as v2's numbers rather than loosened. The claim
   * is still checkable and still specific: the palette has a known shape, and a drift in it is a
   * real change. What is NOT asserted here any more is the graph's geometry — that is the
   * reader's business and the two laws above own it, which is why the space shift shows up there
   * as unchanged while it shows up here as a different palette.
   *
   * THE PER-SYSTEM FORK IS GONE, and not because it was tidy. It asked whether `--neutral-1`
   * resolved and answered 'v1' when it did not — but v1 is no longer installable in this repo, so
   * the probe could only ever answer 'v2' and the v1 arm was unreachable code shaped like a law.
   * It also computed the check's own NAME from that value, so the name could not fail either.
   */
  const palette = { '--space-7': 32, '--space-6': 24 };
  for (const [name, want] of Object.entries(palette)) {
    check(
      `v2: ${name} is ${want}px`,
      v[name] === want,
      `${name}=${v[name]}`
    );
  }
  check('the label type step is 14px', v['--font-size-2'] === 14, `--font-size-2=${v['--font-size-2']}`);
  check('the line box is 24px', v['--line-height-3'] === 24, `--line-height-3=${v['--line-height-3']}`);

  /**
   * A node body's corner is a corner, and the two halves of the scale are not interchangeable.
   *
   * This law used to assert that `--radius-4` was bounded, because the body READ `--radius-4` and
   * every SDF site clamps `r = min(r, min(halfW, halfH))` — so at v2's `full` level, where the
   * control family is `calc(9999px * var(--scale))`, a node body became a stadium with no error and
   * no missing token. The fixture pinned `large` to keep that out of the suite.
   *
   * Both halves of that are gone. The body is on `--radius-surface-N`, which v2 holds at
   * 24/32/40/48 even at `full`, and the fixture now runs at `full` because that is the level the
   * design system defaults to and the docs app states. So the assertion inverts: the CONTROL token
   * being a capsule here is CORRECT and expected — a widget well is a pill at this level — and what
   * must stay bounded is the SURFACE token the body reads. Asserting the old way would now be
   * asserting that the fixture is not testing what ships.
   */
  check(
    'the node body reads a bounded SURFACE radius',
    v['--radius-surface-2'] > 0 && v['--radius-surface-2'] < 100,
    `--radius-surface-2=${v['--radius-surface-2']}`
  );
  check(
    'and the control family is a capsule at this level, which is the point of it',
    v['--radius-4'] > 1000,
    `--radius-4=${v['--radius-4']} — expected 9999 at radius="full"`
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

head('GL widgets');

/**
 * The seven built-in widgets draw in WebGL and take their interaction there.
 *
 * They were the last persistent DOM on a node — a real design-system control per socket per
 * visible entity, which at a thousand nodes is thousands of composited layers. That is the same
 * measured reason the DOM label path was deleted, and it is the governing rule of this migration:
 * everything persistent renders in GL, the DOM appears only transiently for one field during an
 * active edit, and then vanishes.
 *
 * What is checked here is the whole path, not the parts: instances reach the GPU, a press lands on
 * the widget rather than on the node under it, and the value the consumer receives is the one the
 * gesture asked for.
 */
await withPage('scene=widgets&widgets=1&preserveBuffer=1', async (page) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.waitForTimeout(400);

  // (a) DRAWN. The widget mesh is instanced, so `drawnVertices` cannot see it — `drawnInstances`
  //     is the half of the instrument written for exactly this.
  const drawn = await page.evaluate(
    () => new Promise((r) => requestAnimationFrame(() => r(window.__harness.drawnInstances())))
  );
  const widgetInstances = drawn.filter((d) => d.kind === 'widgets');

  /**
   * The EXACT count, derived from the store rather than guessed at.
   *
   * This was `>= 4` against a scene that is fully known and holds exactly six. At that threshold
   * the colour widget and the select could both stop being emitted and the law would still report
   * ok — and those two are the kinds with the most branching in the fragment shader and the two
   * that no press law below touches. A floor is the right shape for a scan whose yield varies;
   * this scene does not vary.
   */
  const expected = await page.evaluate(() => window.__harness.widgetSockets());
  check('INSTRUMENT: the scene has widgets to draw', expected.length > 0, `${expected.length} expected`);
  check(
    'every widget in the scene reaches the GPU as an instance',
    widgetInstances.length === expected.length,
    `${widgetInstances.length} drawn, ${expected.length} expected, of ${drawn.length} total instances`
  );

  /**
   * WHERE the shader was handed each quad, against where the geometry says it goes.
   *
   * Every press law below takes its point from `widgetPoint`, which calls `getWidgetBox` — and so
   * does `getWidgetAt`, the hit test. Both sides of every press law are therefore ONE
   * implementation, and agree by construction: sabotaging the geometry moves both and the suite
   * stays green. That is the defect socket-index.test.ts names in its own docstring, live here.
   *
   * The third implementation is the instance matrix widgets-gl writes, which no law reads. This
   * closes that loop: `drawnInstances` reports the translation the GPU received (Y negated back
   * into store space by the fixture), and a constant offset added to the instance write — the
   * socket-geometry defect verbatim, a control painted 40px from where pressing it works — now
   * fails here instead of passing everywhere.
   */
  const misplaced = expected.filter(
    (w) => !widgetInstances.some((d) => Math.hypot(d.x - w.x, d.y - w.y) < 2)
  );
  check(
    'every widget is drawn where it is pressed',
    misplaced.length === 0,
    misplaced.map((w) => `${w.entityId}/${w.socketId} expected (${Math.round(w.x)},${Math.round(w.y)})`).join('; ')
  );

  /**
   * (b) NOTHING IN THE DOM PAINTS. The built-ins draw no DOM at rest — the claim the whole layer
   *     exists to make, and the one a screenshot cannot check.
   *
   *     THE WORDING MOVED, and the move is the whole of what the accessibility mirror cost. This
   *     said "no built-in widget is a DOM element at rest", and that sentence was load-bearing for
   *     a migration whose rule was "everything persistent renders in GL". It is now "everything
   *     persistent PAINTS in GL": the accessibility tree is not paint, and a hidden focusable
   *     control per widget on ONE focused node is the price of a graph a screen reader can operate
   *     at all. What must not come back is the compositing — thousands of real controls over the
   *     canvas — and that is what the exclusion below still measures, backed by the three laws in
   *     the section beneath this one: a mirror element paints nothing, the mirror set is bounded
   *     at a thousand nodes, and it costs no React commit during a pan. Delete any of those three
   *     and this exclusion becomes a hole.
   */
  const domControls = await page.evaluate(() => {
    const root = document.querySelector('[data-kookie-flow-container]');
    return root.querySelectorAll(
      'input:not([data-a11y-mirror]), select:not([data-a11y-mirror]), textarea:not([data-a11y-mirror]), [role="slider"], [role="checkbox"]'
    ).length;
  });
  check('no built-in widget PAINTS in the DOM at rest', domControls === 0, `${domControls} found`);

  // (c) A CHECKBOX TOGGLES, with no DOM at any point in the gesture.
  const before = await page.evaluate(() => window.__harness.widgetValue('w', 'flag'));
  const at = await page.evaluate(() => window.__harness.widgetPoint('w', 'flag'));
  check('INSTRUMENT: the checkbox has a place on screen', at !== null, JSON.stringify(at));
  await page.mouse.click(at.x, at.y);
  await page.waitForTimeout(200);
  const after = await page.evaluate(() => window.__harness.widgetValue('w', 'flag'));
  check('pressing a checkbox toggles it', before !== after, `${before} -> ${after}`);

  const domDuring = await page.evaluate(() => {
    const root = document.querySelector('[data-kookie-flow-container]');
    // The mirror is excluded because pressing a widget moves the keyboard cursor onto its node,
    // which is the point: a pointer user and a screen-reader user end up in the same place. What
    // is measured here is unchanged — the GESTURE borrows nothing.
    return root.querySelectorAll(
      'input:not([data-a11y-mirror]), select:not([data-a11y-mirror]), textarea:not([data-a11y-mirror])'
    ).length;
  });
  check('toggling a checkbox borrows no DOM', domDuring === 0, `${domDuring} found`);

  // (d) A SLIDER DRAGS, and the node underneath does NOT move — the ordering this depends on.
  const nodeBefore = await page.evaluate(() => {
    const e = window.__harness.store.getState().entityMap.get('w');
    return { x: e.position.x, y: e.position.y };
  });
  const sliderAt = await page.evaluate(() => window.__harness.widgetPoint('w', 'amount'));
  check('INSTRUMENT: the slider has a place on screen', sliderAt !== null, JSON.stringify(sliderAt));
  await page.mouse.move(sliderAt.x - 40, sliderAt.y);
  await page.mouse.down();
  await page.mouse.move(sliderAt.x + 50, sliderAt.y, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(200);
  const sliderAfter = await page.evaluate(() => window.__harness.widgetValue('w', 'amount'));
  const nodeAfter = await page.evaluate(() => {
    const e = window.__harness.store.getState().entityMap.get('w');
    return { x: e.position.x, y: e.position.y };
  });
  check(
    'dragging a slider changes its value',
    typeof sliderAfter === 'number' && sliderAfter > 0.5,
    `value is ${sliderAfter}`
  );
  check(
    'dragging a slider does not drag the node under it',
    nodeAfter.x === nodeBefore.x && nodeAfter.y === nodeBefore.y,
    `${JSON.stringify(nodeBefore)} -> ${JSON.stringify(nodeAfter)}`
  );

  // (e) A TEXT FIELD BORROWS a real input, and gives it back.
  const textAt = await page.evaluate(() => window.__harness.widgetPoint('w', 'label'));
  await page.mouse.click(textAt.x, textAt.y);
  await page.waitForTimeout(200);
  const borrowed = await page.evaluate(() => {
    const el = document.activeElement;
    // Scoped to the flow: an input elsewhere on a consumer's page is not this library's business.
    const inputs = document.querySelectorAll(
      '[data-kookie-flow-container] input:not([data-a11y-mirror])'
    );
    return { tag: el ? el.tagName : null, count: inputs.length };
  });
  check(
    'pressing a text widget borrows a real input and focuses it',
    borrowed.tag === 'INPUT' && borrowed.count === 1,
    JSON.stringify(borrowed)
  );

  await page.keyboard.type('hello');
  await page.waitForTimeout(150);
  const typed = await page.evaluate(() => window.__harness.widgetValue('w', 'label'));
  check('typing reaches the value', String(typed).includes('hello'), String(typed));

  await page.keyboard.press('Escape');
  await page.waitForTimeout(250);
  const afterEdit = await page.evaluate(
    () =>
      document.querySelectorAll('[data-kookie-flow-container] input:not([data-a11y-mirror])')
        .length
  );
  check('the borrowed input vanishes when the edit ends', afterEdit === 0, `${afterEdit} remain`);

  /**
   * (f) A SELECT OPENS A LIST, and it opens it on the RELEASE.
   *
   * What this replaced: a press advanced to the next option and wrapped, so choosing the fourth of
   * five took four presses and the five were never on screen together. The list is the platform's
   * own `<select>`, borrowed through the same overlay the text field borrows an input through.
   *
   * The half of this that only a real browser can show is the TIMING. The borrowed select opens its
   * list as soon as it is mounted and focused, so mounting it on pointerdown puts the popup under a
   * button that is still held: the platform opens the list with the current option beneath the
   * cursor, the release picks that same option, and the list shuts again — a flash, and no change.
   * jsdom has no popup and cannot fail that way, so the claim is made here: nothing is borrowed
   * while the button is down, and the select exists by the time it comes up.
   */
  const selectAt = await page.evaluate(() => window.__harness.widgetPoint('w', 'mode'));
  check('INSTRUMENT: the select has a place on screen', selectAt !== null, JSON.stringify(selectAt));
  const selectBefore = await page.evaluate(() => window.__harness.widgetValue('w', 'mode'));

  const countSelects = () =>
    page.evaluate(
      () =>
        document.querySelectorAll('[data-kookie-flow-container] select:not([data-a11y-mirror])')
          .length
    );

  await page.mouse.move(selectAt.x, selectAt.y);
  await page.mouse.down();
  await page.waitForTimeout(150);
  const whileHeld = await countSelects();
  check('a select borrows nothing while the button is still down', whileHeld === 0, `${whileHeld} found`);

  await page.mouse.up();
  await page.waitForTimeout(250);
  const opened = await page.evaluate(() => {
    const el = document.querySelector('[data-kookie-flow-container] select:not([data-a11y-mirror])');
    if (!el) return null;
    return {
      focused: document.activeElement === el,
      options: [...el.options].map((o) => o.value),
      value: el.value,
    };
  });
  check(
    'releasing on a select borrows a real list, focused, holding every option',
    opened !== null &&
      opened.focused &&
      opened.value === 'one' &&
      opened.options.join(',') === 'one,two,three',
    JSON.stringify(opened)
  );

  /**
   * Picking the THIRD option, in one gesture. Under the old cycling press this needed two more
   * presses and could not skip; the count of presses is the whole point of the change.
   */
  await page.selectOption('[data-kookie-flow-container] select:not([data-a11y-mirror])', 'three');
  await page.waitForTimeout(250);
  const selectAfter = await page.evaluate(() => window.__harness.widgetValue('w', 'mode'));
  check(
    'picking from the list reaches the value in one gesture',
    selectAfter === 'three' && selectBefore !== 'three',
    `${selectBefore} -> ${selectAfter}`
  );
  const afterPick = await countSelects();
  check('the borrowed list vanishes once a choice is made', afterPick === 0, `${afterPick} remain`);
});

// ---------------------------------------------------------------- accessibility mirror

head('accessibility mirror');

/**
 * The widgets are reachable without a pointer, and the way back is bounded.
 *
 * WHAT THIS PINS. Moving the seven built-in widgets into WebGL took them out of the accessibility
 * tree entirely — a canvas has no roles, no names and no focusable children — so a screen-reader
 * or keyboard-only user went from being able to reach a socket widget to having nothing on a node
 * to reach at all. The answer is a visually-hidden DOM control per widget, and the answer's whole
 * risk is its SIZE: a mirror of every widget in the graph is thousands of focusable elements at a
 * thousand nodes, which is precisely the persistent per-node DOM the GL migration deleted, put
 * back through a side door.
 *
 * So the laws below are mostly about the bound, not about the feature. The mirror covers exactly
 * one node — the one the keyboard cursor is on — and these measure that at a thousand nodes,
 * measure that nothing it mounts paints, and measure that it costs no React commit while a node
 * is being dragged. The naming law in the "accessible names" section covers the other half: that
 * what it mounts actually announces itself.
 *
 * A NOTE ON THE WRONG FIX, because it is the easy one to reach for and it passes a careless law.
 * `display: none`, `visibility: hidden`, the `hidden` attribute and `aria-hidden` all make an
 * element stop painting — and all four remove it from the accessibility tree, which would leave
 * this whole file mounting controls nobody can reach. That is why the paint law below asserts the
 * computed style is NOT those two things as well as asserting the box is a pixel.
 */
await withPage('scene=widgets&widgets=1', async (page) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.waitForTimeout(300);

  const mirrors = () => page.evaluate(() => document.querySelectorAll('[data-a11y-mirror]').length);

  check('INSTRUMENT: nothing is mirrored before anything is focused', (await mirrors()) === 0);

  // The graph's ONE tab stop, then one arrow key. This is the whole keyboard entry path.
  await page.evaluate(() => document.querySelector('[data-kookie-flow-container]').focus());
  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(250);

  const cursor = await page.evaluate(() => window.__harness.store.getState().focusedEntityId);
  check('an arrow key moves the keyboard cursor onto a node', cursor === 'w', String(cursor));

  const mounted = await mirrors();
  check('the focused node mirrors its widgets', mounted === 6, `${mounted} controls`);

  /**
   * A MIRROR ELEMENT PAINTS NOTHING, and is still in the accessibility tree.
   *
   * Both halves in one check on purpose: each alone admits the wrong fix. A box test alone passes
   * for `display: none`, which is not reachable; a computed-style test alone passes for a
   * full-size transparent control, which is a composited surface over the canvas and the exact
   * cost the GL migration was measured to remove.
   */
  const paint = await page.evaluate(() =>
    [...document.querySelectorAll('[data-a11y-mirror]')].map((el) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return {
        name: el.getAttribute('aria-label'),
        w: Math.round(r.width),
        h: Math.round(r.height),
        display: cs.display,
        visibility: cs.visibility,
        hiddenFromAt: el.closest('[aria-hidden="true"]') !== null,
      };
    })
  );
  const painting = paint.filter((p) => p.w > 1 || p.h > 1);
  check(
    'a mirror element paints nothing',
    painting.length === 0,
    painting.map((p) => `${p.name} ${p.w}x${p.h}`).join(', ')
  );
  const gone = paint.filter(
    (p) => p.display === 'none' || p.visibility === 'hidden' || p.hiddenFromAt
  );
  check(
    'and is still reachable — not display:none, not visibility:hidden, not aria-hidden',
    gone.length === 0 && paint.length > 0,
    `${gone.length} of ${paint.length} removed from the accessibility tree`
  );

  /**
   * EXACTLY ONE TAB STOP. Every mirror control carries `tabIndex={-1}`, so Tab leaves the graph
   * rather than walking into a node's controls — which is what keeps the answer to "how does a
   * keyboard user reach a thousand nodes" from being "a thousand tab stops". Entry is Enter.
   */
  await page.evaluate(() => document.querySelector('[data-kookie-flow-container]').focus());
  await page.keyboard.press('Tab');
  await page.waitForTimeout(100);
  const left = await page.evaluate(() => {
    const root = document.querySelector('[data-kookie-flow-container]');
    return !root.contains(document.activeElement);
  });
  check('Tab leaves the graph rather than entering a node', left);

  /**
   * A KEYBOARD CHANGE REACHES THE STORE, through the same path a press does.
   *
   * Space on the checkbox mirror and an arrow on the range mirror. The second assertion is the one
   * that says the mirror is not a decoration: nothing is borrowed, no overlay mounts, the element
   * count does not move, and the value the consumer receives is the one the key asked for.
   */
  await page.evaluate(() => document.querySelector('[data-kookie-flow-container]').focus());
  await page.keyboard.press('Enter');
  await page.waitForTimeout(150);
  const entered = await page.evaluate(() => document.activeElement?.getAttribute('data-socket-id'));
  check('Enter steps into the focused node\'s controls', entered === 'flag', String(entered));

  const flagBefore = await page.evaluate(() => window.__harness.widgetValue('w', 'flag'));
  await page.keyboard.press('Space');
  await page.waitForTimeout(250);
  const flagAfter = await page.evaluate(() => window.__harness.widgetValue('w', 'flag'));
  check(
    'a keypress on the checkbox mirror reaches the value',
    flagBefore !== flagAfter && typeof flagAfter === 'boolean',
    `${flagBefore} -> ${flagAfter}`
  );

  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(150);
  const onSlider = await page.evaluate(() => document.activeElement?.getAttribute('data-socket-id'));
  check('Down moves to the next control in the group', onSlider === 'amount', String(onSlider));

  const amountBefore = await page.evaluate(() => window.__harness.widgetValue('w', 'amount'));
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(250);
  const amountAfter = await page.evaluate(() => window.__harness.widgetValue('w', 'amount'));
  check(
    'an arrow on the range mirror moves the value, as a number',
    typeof amountAfter === 'number' && amountAfter > amountBefore,
    `${amountBefore} -> ${amountAfter}`
  );

  const stillMirrors = await mirrors();
  check(
    'and nothing was borrowed to do it',
    stillMirrors === mounted,
    `${mounted} -> ${stillMirrors} controls`
  );

  // Escape hands focus back to the canvas, which is what makes the group escapable without Tab.
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  const back = await page.evaluate(
    () => document.activeElement === document.querySelector('[data-kookie-flow-container]')
  );
  check('Escape hands focus back to the canvas', back);
});

/**
 * THE BOUND, MEASURED WHERE IT MATTERS. A thousand nodes with widgets on every input socket.
 *
 * This is the law the whole design is shaped around. Mirroring every widget would put roughly
 * three thousand focusable elements on this page; mirroring the SELECTION would do the same the
 * moment anyone pressed Ctrl+A, which is why the store carries a single-valued `focusedEntityId`
 * rather than reusing `selectedEntityIds`. Sixteen is a ceiling with room for a node far larger
 * than this fixture's and no room at all for a second node's worth.
 */
await withPage('count=1000&widgets=1', async (page) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.waitForTimeout(400);

  await page.evaluate(() => document.querySelector('[data-kookie-flow-container]').focus());
  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(300);

  const focused = await page.evaluate(() => window.__harness.store.getState().focusedEntityId);
  check('INSTRUMENT: the cursor landed on a node', focused !== null, String(focused));

  const count = await page.evaluate(() => document.querySelectorAll('[data-a11y-mirror]').length);
  check('INSTRUMENT: the cursor mounted controls to count', count > 0, `${count} controls`);
  check('the mirror set does not scale with the graph', count <= 16, `${count} controls at 1000 nodes`);

  /**
   * AND IT COSTS NO REACT COMMIT WHILE A NODE MOVES.
   *
   * Measured across the middle of a drag, not across the whole gesture: starting and ending one
   * legitimately commits — `isDragging` is React state and always has been. What must not commit
   * is everything in between. The trap this guards is specific and was avoided deliberately: the
   * store republishes `entities` on every pointermove of a drag, so a mirror that subscribed to
   * `entities` to keep its values fresh would commit once per frame for the length of the gesture.
   * It subscribes to `topologyVersion` and `widgetValuesVersion` instead.
   */
  const at = await page.evaluate(() => {
    const s = window.__harness.store.getState();
    const e = s.entityMap.get(s.focusedEntityId);
    const canvas = document.querySelector('canvas');
    const rect = canvas.getBoundingClientRect();
    return {
      x: (e.position.x + 40) * s.viewport.zoom + s.viewport.x + rect.left,
      y: (e.position.y + 10) * s.viewport.zoom + s.viewport.y + rect.top,
    };
  });
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await page.mouse.move(at.x + 8, at.y + 8);
  await page.waitForTimeout(120);

  await page.evaluate(() => window.__harness.mark('mirror-drag'));
  const commitsBefore = await page.evaluate(() => window.__harness.reactCommits().commits);
  for (let i = 0; i < 24; i++) {
    await page.mouse.move(at.x + 8 + i * 3, at.y + 8 + (i % 5));
  }
  await page.waitForTimeout(150);
  const commitsAfter = await page.evaluate(() => window.__harness.reactCommits().commits);
  await page.mouse.up();

  check(
    'a mounted mirror costs no React commit while a node is dragged',
    commitsAfter === commitsBefore,
    `${commitsAfter - commitsBefore} commits over 24 pointermoves`
  );

  const stillThere = await page.evaluate(
    () => document.querySelectorAll('[data-a11y-mirror]').length
  );
  check('and the mirror is still mounted, so the measurement meant something', stillThere > 0, `${stillThere}`);
});

/**
 * A widget's VALUE is drawn, and it is drawn inside the widget.
 *
 * THE REGRESSION THIS PINS. The migration moved widget chrome into one instanced draw and deleted
 * the seven DOM controls that used to print their own values — and the promised replacement, the
 * glyphs contributed to the MSDF batcher, was never written. Every field on every node showed an
 * empty well, every select a chevron with no option beside it, every slider a bar with no number.
 * The section above passes in full with all of that broken: it counts widget INSTANCES and drives
 * presses, and a widget with no text is still one instance that still answers a press.
 *
 * The measurement is glyph instances whose world position lands inside the widget's own box, taken
 * from `widgetBox` — the same `getWidgetBox` the renderer draws from and the hit test presses. A
 * socket's NAME sits in the gutter to the left of that box and a header above it, so anything
 * counted here is value text and nothing else.
 */
await withPage('scene=widgets&widgets=1&preserveBuffer=1', async (page) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.waitForTimeout(400);

  /** Glyphs drawn inside one widget's box, on the next painted frame. */
  const glyphsIn = (socketId) =>
    page.evaluate(
      (sid) =>
        new Promise((r) =>
          requestAnimationFrame(() => {
            const box = window.__harness.widgetBox('w', sid);
            if (!box) return r(null);
            const inside = window.__harness
              .drawnInstances()
              .filter(
                (d) =>
                  d.kind.startsWith('glyphs') &&
                  d.x >= box.x &&
                  d.x <= box.x + box.width &&
                  d.y >= box.y &&
                  d.y <= box.y + box.height
              );
            r(inside.length);
          })
        ),
      socketId
    );

  check('INSTRUMENT: the text widget has a box on screen', (await glyphsIn('label')) !== null);

  // 'name' — four characters, four glyph instances. An exact count rather than a floor: the
  // scene is fully known, and a floor of one would stay green if a truncation bug cut every
  // value to its first letter.
  const field = await glyphsIn('label');
  check('a text widget draws its value', field === 4, `${field} glyphs for 'name'`);

  // 'one' — the select's current option, which the shader has no way to draw: it paints a well
  // and a chevron, and before this the chevron pointed at nothing.
  const select = await glyphsIn('mode');
  check('a select draws its current option', select === 3, `${select} glyphs for 'one'`);

  // 0.2 stepping by 0.01 reads '0.20': four characters, and the period is a real glyph in the
  // atlas. This is the law that would catch a readout formatted straight off the float, which
  // prints 0.30000000000000004 into a 60px space.
  const slider = await glyphsIn('amount');
  check('a slider draws its readout', slider === 4, `${slider} glyphs for '0.20'`);

  /**
   * The two kinds that deliberately print NOTHING, asserted rather than assumed.
   *
   * A checkbox's tick is its value and a colour swatch's fill is its value, so both would be
   * double-stating themselves — and 'true'/'false' beside every checkbox on every visible node is
   * a real slice of the glyph budget. Without these two lines, someone adding a value string to
   * every widget kind would break the decision and no law would notice.
   */
  const checkbox = await glyphsIn('flag');
  check('a checkbox draws no value text', checkbox === 0, `${checkbox} glyphs`);
  const colour = await glyphsIn('tint');
  check('a colour widget draws no value text', colour === 0, `${colour} glyphs`);

  /**
   * A VALUE CHANGE REPAINTS. This is the half the subscriptions exist for: a data-only change
   * bumps no version counter in the store, it only swaps the entities array — so before the text
   * layer subscribed to `entities` a value written by the consumer never reached the glyphs, and
   * the field went on showing whatever the last node drag had collected.
   */
  await page.evaluate(() => {
    const s = window.__harness.store.getState();
    s.setEntities(
      s.entities.map((e) =>
        e.id === 'w' ? { ...e, data: { ...e.data, values: { ...e.data.values, label: 'changed' } } } : e
      )
    );
  });
  await page.waitForTimeout(300);
  const rewritten = await glyphsIn('label');
  check(
    'a value written from outside reaches the glyphs',
    rewritten === 7,
    `${rewritten} glyphs for 'changed'`
  );

  /**
   * WHILE A FIELD IS OPEN, the borrowed input owns the box and the glyphs stand down.
   *
   * The input is opaque and sits on the same world box, so this is not about what is visible on a
   * still frame — it is about the two placing on different clocks (the overlay on its own RAF, the
   * glyphs on useFrame), which shows as text edging out from under the box on a pan mid-edit. The
   * store key is what both sides agree on, so the key and the glyph count are checked together.
   */
  const at = await page.evaluate(() => window.__harness.widgetPoint('w', 'label'));
  await page.mouse.click(at.x, at.y);
  await page.waitForTimeout(250);
  const openKey = await page.evaluate(() => window.__harness.store.getState().editingWidgetKey);
  check('opening a field records which widget is being edited', openKey === 'w:label', String(openKey));
  const duringEdit = await glyphsIn('label');
  check('the value stops printing under a borrowed input', duringEdit === 0, `${duringEdit} glyphs`);

  await page.keyboard.press('Escape');
  await page.waitForTimeout(250);
  const closedKey = await page.evaluate(() => window.__harness.store.getState().editingWidgetKey);
  check('closing the field clears the record', closedKey === null, String(closedKey));
  const afterEdit = await glyphsIn('label');
  check('the value prints again once the edit ends', afterEdit === 7, `${afterEdit} glyphs`);
});

/**
 * The value text stops before its chrome does.
 *
 * Two floors, and the ordering between them is the whole point: widgets stop drawing at 0.4 and
 * their values at 0.5, so there is no zoom at which a readout floats over a row with no well under
 * it. The higher floor is also the glyph budget's main lever — this feature adds text to every
 * widget on every visible node, and the zoomed-out frames are the ones with the most nodes on
 * screen and the least readable glyphs.
 */
await withPage('scene=widgets&widgets=1&preserveBuffer=1', async (page) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.waitForTimeout(400);

  const glyphCount = () =>
    page.evaluate(
      () =>
        new Promise((r) =>
          requestAnimationFrame(() => {
            const box = window.__harness.widgetBox('w', 'label');
            r(
              window.__harness
                .drawnInstances()
                .filter(
                  (d) =>
                    d.kind.startsWith('glyphs') &&
                    d.x >= box.x &&
                    d.x <= box.x + box.width &&
                    d.y >= box.y &&
                    d.y <= box.y + box.height
                ).length
            );
          })
        )
    );

  const setZoom = (zoom) =>
    page.evaluate((z) => {
      const s = window.__harness.store.getState();
      s.setViewport({ x: s.viewport.x, y: s.viewport.y, zoom: z });
    }, zoom);

  await setZoom(1);
  await page.waitForTimeout(250);
  check('INSTRUMENT: the value prints at full zoom', (await glyphCount()) > 0);

  await setZoom(0.45);
  await page.waitForTimeout(250);
  const below = await glyphCount();
  check('below the value floor the readout stops printing', below === 0, `${below} glyphs at 0.45`);

  // And the chrome is still there at that zoom, which is what makes the ordering meaningful
  // rather than two numbers that happen to agree.
  const chrome = await page.evaluate(
    () =>
      new Promise((r) =>
        requestAnimationFrame(() =>
          r(window.__harness.drawnInstances().filter((d) => d.kind === 'widgets').length)
        )
      )
  );
  check('the widget chrome is still drawn at that zoom', chrome > 0, `${chrome} instances`);

  await setZoom(1);
  await page.waitForTimeout(250);
  const back = await glyphCount();
  check('zooming back in brings the readout back', back > 0, `${back} glyphs`);
});

// ---------------------------------------------------------------- widget hover

head('widget hover');

/**
 * A widget says it is a control BEFORE it is pressed.
 *
 * What this replaced: nothing at all. A GL widget gave no sign it was interactive until it was
 * pressed — no hover, no cursor change — so a field, a slider and a painted strip of node chrome
 * were indistinguishable. The press worked; there was just no way to know it would.
 *
 * The claim has three parts and all three have to hold together, because any one of them alone
 * passes with the feature half-built: the STORE knows which widget is under the pointer, the GPU
 * is TOLD (a per-instance attribute, which is the step that quietly goes missing), and the cursor
 * changes. And the whole thing is bound by the first rule in CLAUDE.md — it must cost ZERO React
 * commits, which is why the cursor is an imperative style write rather than the `setState` the
 * resize handles next to it use.
 */
await withPage('scene=widgets&widgets=1&preserveBuffer=1', async (page) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.waitForTimeout(400);

  const cursor = () =>
    page.evaluate(() => document.querySelector('[data-kookie-flow-container]').style.cursor);
  const hovered = () =>
    page.evaluate(() => window.__harness.store.getState().hoveredWidget);
  const flagged = () =>
    page.evaluate(
      () => new Promise((r) => requestAnimationFrame(() => r(window.__harness.hoveredWidgetInstances())))
    );

  const slider = await page.evaluate(() => window.__harness.widgetPoint('w', 'amount'));
  const field = await page.evaluate(() => window.__harness.widgetPoint('w', 'label'));
  check('INSTRUMENT: the slider and the field both have a place on screen', slider !== null && field !== null);

  // The floor every claim below is read against. Over empty canvas nothing is hovered and the
  // cursor is whatever the canvas's own ternary decided — which is not 'pointer'.
  await page.mouse.move(1200, 800);
  await page.waitForTimeout(150);
  const restCursor = await cursor();
  check('INSTRUMENT: nothing is hovered over empty canvas', (await hovered()) === null, JSON.stringify(await hovered()));
  check('INSTRUMENT: the resting cursor is not already a pointer', restCursor !== 'pointer', restCursor);
  check('INSTRUMENT: no instance is flagged hovered at rest', (await flagged()).length === 0);

  // (a) THE STORE knows, and it knows exactly which widget.
  await page.mouse.move(slider.x, slider.y);
  await page.waitForTimeout(150);
  const onSlider = await hovered();
  check(
    'moving onto a widget records which widget it is',
    onSlider !== null && onSlider.entityId === 'w' && onSlider.socketId === 'amount',
    JSON.stringify(onSlider)
  );

  // (b) THE GPU is told — and told about the right instance. The position is compared against
  //     `widgetBox`, the geometry both the renderer and the hit test read, so a flag set on the
  //     wrong instance fails here rather than looking like a pass.
  const box = await page.evaluate(() => window.__harness.widgetBox('w', 'amount'));
  const lit = await flagged();
  const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  check(
    'the hovered widget, and only it, reaches the shader flagged',
    lit.length === 1 && Math.hypot(lit[0].x - centre.x, lit[0].y - centre.y) < 2,
    `${lit.length} flagged: ${JSON.stringify(lit)} vs ${JSON.stringify(centre)}`
  );

  // (c) THE CURSOR says it is pressable.
  check('the cursor over a widget is a pointer', (await cursor()) === 'pointer', await cursor());

  /**
   * (d) AND THE PIXELS ACTUALLY CHANGE.
   *
   * Everything above is CPU-side: the store field, the instance array as JavaScript sees it, an
   * element's style. All three are true and the screen is unchanged if the attribute is never
   * uploaded — a hover flag written into a buffer with no `needsUpdate` behind it appears only on
   * frames where some OTHER attribute happened to change, which is most of them during a drag and
   * none of them while a pointer moves over a still graph. That is the single most likely way to
   * ship this half-working, so it is measured where nothing but a real rasteriser can answer.
   *
   * The field is sampled rather than the slider: hover moves its whole well one step, where a
   * slider only moves a thin track and a grip, and a mean over the box is the honest instrument
   * for the first and a weak one for the second.
   */
  const wellMean = () =>
    page.evaluate(
      () =>
        new Promise((r) =>
          requestAnimationFrame(() => {
            const st = window.__harness.store.getState();
            const b = window.__harness.widgetBox('w', 'label');
            const c = document.querySelector('canvas');
            const gl = c.getContext('webgl2');
            const dpr = c.width / c.clientWidth;
            const rect = c.getBoundingClientRect();
            const buf = new Uint8Array(4);
            let n = 0, sum = 0;
            // Inset by three world units so the hairline and the antialiased corners are outside
            // the sample: what is being measured is the WELL.
            for (let wx = b.x + 3; wx < b.x + b.width - 3; wx += 2) {
              for (let wy = b.y + 3; wy < b.y + b.height - 3; wy += 2) {
                const sx = wx * st.viewport.zoom + st.viewport.x + rect.left;
                const sy = wy * st.viewport.zoom + st.viewport.y + rect.top;
                gl.readPixels(
                  Math.round(sx * dpr), Math.round(c.height - sy * dpr),
                  1, 1, gl.RGBA, gl.UNSIGNED_BYTE, buf
                );
                n++;
                sum += (buf[0] + buf[1] + buf[2]) / 3;
              }
            }
            r(n ? sum / n : null);
          })
        )
    );

  await page.mouse.move(1200, 800);
  await page.waitForTimeout(200);
  const restMean = await wellMean();
  await page.mouse.move(field.x, field.y);
  await page.waitForTimeout(200);
  const hoverMean = await wellMean();
  check(
    'hovering a widget changes what is on the screen',
    restMean !== null && hoverMean !== null && Math.abs(restMean - hoverMean) > 2,
    `well mean ${restMean} at rest, ${hoverMean} hovered`
  );

  // And it goes back exactly, rather than drifting a step per hover — which is what a mix against
  // the previous colour instead of the base colour would look like.
  await page.mouse.move(1200, 800);
  await page.waitForTimeout(200);
  const restAgain = await wellMean();
  check(
    'and unhovering puts the same pixels back',
    restAgain !== null && Math.abs(restAgain - restMean) < 0.5,
    `${restMean} -> ${hoverMean} -> ${restAgain}`
  );

  // Moving to a DIFFERENT widget on the same node moves the hover with it. The first spelling of
  // the dedupe compared entity ids only, which would have held the slider lit across this move.
  await page.mouse.move(field.x, field.y);
  await page.waitForTimeout(150);
  const onField = await hovered();
  check(
    'moving between two widgets on one node moves the hover',
    onField !== null && onField.socketId === 'label',
    JSON.stringify(onField)
  );

  /**
   * A MODE OUTRANKS THE WIDGET. Holding space arms the pan, and an armed pan owns the cursor: the
   * widget under the pointer is not the thing about to happen. The first spelling of the effect
   * put the pointer back unconditionally after any render that changed the base cursor, so space
   * held over a slider showed a pointer where the grab hand belongs.
   */
  await page.evaluate(() => document.querySelector('[data-kookie-flow-container]').focus());
  await page.keyboard.down('Space');
  await page.waitForTimeout(200);
  check('an armed pan takes the cursor back from the widget', (await cursor()) === 'grab', await cursor());
  await page.keyboard.up('Space');
  await page.waitForTimeout(200);
  check('and the widget gets it back when the mode ends', (await cursor()) === 'pointer', await cursor());

  /**
   * ZERO REACT COMMITS for the whole sweep, which is the rule that shaped every part of this.
   *
   * The sweep crosses several widgets and the gaps between them, so it is a dozen hover enters and
   * leaves. The obvious implementation — hover in React state, cursor from the style ternary — is
   * a commit per transition on a component this size, and would fail here by a wide margin.
   */
  await page.evaluate(() => window.__harness.mark('hover-sweep'));
  const commitsBefore = await page.evaluate(() => window.__harness.reactCommits().commits);
  for (let i = 0; i < 40; i++) {
    await page.mouse.move(slider.x + (i % 8) * 12, slider.y + Math.floor(i / 8) * 14);
  }
  await page.waitForTimeout(200);
  const commitsAfter = await page.evaluate(() => window.__harness.reactCommits().commits);
  check(
    'sweeping the pointer across a row of widgets costs no React commits',
    commitsAfter === commitsBefore,
    `${commitsAfter - commitsBefore} commits`
  );

  // Leaving the node clears all three, which is the half a hover feature usually gets wrong: a
  // control left lit after the pointer has gone reads as selected.
  await page.mouse.move(1200, 800);
  await page.waitForTimeout(150);
  check('moving off a widget clears the store', (await hovered()) === null, JSON.stringify(await hovered()));
  check('moving off a widget unflags every instance', (await flagged()).length === 0);
  check('moving off a widget restores the cursor', (await cursor()) === restCursor, await cursor());

  /**
   * BELOW THE PAINT FLOOR, nothing hovers. `MIN_WIDGET_ZOOM` is the zoom at which the renderer
   * stops drawing widget chrome, and a pointer cursor over a control nobody can see is the same
   * lie as a press that lands on one — the defect that constant was introduced for.
   */
  await page.evaluate(() => {
    const s = window.__harness.store.getState();
    s.setViewport({ x: s.viewport.x, y: s.viewport.y, zoom: 0.3 });
  });
  await page.waitForTimeout(250);
  const zoomedOut = await page.evaluate(() => window.__harness.widgetPoint('w', 'amount'));
  await page.mouse.move(zoomedOut.x, zoomedOut.y);
  await page.waitForTimeout(200);
  check(
    'below the zoom the chrome stops at, a widget does not hover',
    (await hovered()) === null,
    JSON.stringify(await hovered())
  );
  check('and the cursor stays as it was', (await cursor()) !== 'pointer', await cursor());
});

/**
 * The pointer LEAVING the canvas clears the hover, and a slider stays lit while it is dragged.
 *
 * Two cases the sweep above cannot reach. The canvas fills the window in this fixture, so leaving
 * it is driven through the event React itself synthesises `pointerleave` from — a `pointerout`
 * whose related target is outside the flow — rather than by moving a mouse that has nowhere to go.
 * And a drag is the one gesture with duration: the hover branch is skipped for its whole length,
 * so without the press setting the handle the grip goes cold exactly when it is being used.
 */
await withPage('scene=widgets&widgets=1&preserveBuffer=1', async (page) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.waitForTimeout(400);

  const hovered = () => page.evaluate(() => window.__harness.store.getState().hoveredWidget);
  const cursor = () =>
    page.evaluate(() => document.querySelector('[data-kookie-flow-container]').style.cursor);

  const slider = await page.evaluate(() => window.__harness.widgetPoint('w', 'amount'));
  await page.mouse.move(slider.x, slider.y);
  await page.waitForTimeout(150);
  check('INSTRUMENT: the slider is hovered before the pointer leaves', (await hovered()) !== null);

  await page.evaluate(() => {
    const el = document.querySelector('[data-kookie-flow-container]');
    el.dispatchEvent(
      new PointerEvent('pointerout', { bubbles: true, relatedTarget: document.body, pointerId: 1 })
    );
  });
  await page.waitForTimeout(150);
  check('the pointer leaving the canvas clears the hover', (await hovered()) === null, JSON.stringify(await hovered()));
  check('and takes the pointer cursor with it', (await cursor()) !== 'pointer', await cursor());

  // A slider stays lit for the length of the drag, including where the pointer travels off the
  // track — the value clamps, the pointer does not.
  await page.mouse.move(slider.x, slider.y);
  await page.mouse.down();
  await page.mouse.move(slider.x + 300, slider.y + 120, { steps: 6 });
  await page.waitForTimeout(120);
  const during = await hovered();
  check(
    'a slider stays lit while it is being dragged, wherever the pointer has gone',
    during !== null && during.socketId === 'amount',
    JSON.stringify(during)
  );

  // Released far from the widget: it goes cold, without waiting for a pointermove that may never
  // come if the person simply lets go and stops moving.
  await page.mouse.up();
  await page.waitForTimeout(150);
  check(
    'releasing away from the widget puts it out',
    (await hovered()) === null,
    JSON.stringify(await hovered())
  );
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
