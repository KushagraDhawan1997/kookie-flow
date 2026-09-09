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
async function withPage(query, fn) {
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

console.log('\nlabels');
await withPage('count=12&seed=1', async (page) => {
  const domText = await page.evaluate(() => {
    let n = 0;
    for (const el of document.querySelectorAll('div')) {
      if (el.children.length === 0 && (el.textContent ?? '').trim().length > 0) n++;
    }
    return n;
  });
  // The DOM label path is deleted. A non-zero count means it came back.
  check('no label is a DOM element', domText === 0, `found ${domText}`);
});

// ---------------------------------------------------------------- pan

console.log('\npan');
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

console.log('\nzoom');
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

console.log('\nselection');
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

console.log('\ndrag');
await withPage('count=12&seed=1', async (page) => {
  const before = await state(page);
  const n0 = screenOf(before, 'n0');

  await page.mouse.move(n0.x + 40, n0.y + 30);
  await page.mouse.down();
  await page.mouse.move(n0.x + 140, n0.y + 90, { steps: 10 });
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

console.log('\nmulti-drag');
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

console.log('\nmarquee');
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

console.log('\ndrag under zoom');
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

console.log('\nkeyboard');
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

console.log('\nsockets');

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

              // The socket palette, resolved through the library's own token reader rather than
              // restated here — a second copy of the theme is a second thing to go stale.
              const want = new Set(
                ['--blue-10', '--amber-10', '--purple-10', '--orange-10', '--cyan-10']
                  .map((t) => window.__harness.lib.resolveColorToRGB(`var(${t})`))
                  .filter(Boolean)
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

console.log('\nedges');

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

console.log('\ntheme tokens');

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

  // Vacuity guard. An empty census makes "nothing is missing" true and meaningless, and the list
  // is derived from the reader's own fallback table, which a refactor could rename out from under
  // this.
  check(
    'INSTRUMENT: the census covers the tokens the reader asks for',
    census.present.length + census.missing.length > 50,
    `${census.present.length + census.missing.length} tokens censused`
  );

  check(
    'every token the GL layer reads is defined by the theme',
    census.missing.length === 0,
    census.missing.length ? `${census.missing.length} fall back to a dark default: ${census.missing.join(' ')}` : undefined
  );
});

// ---------------------------------------------------------------- summary

console.log(`\n${passed} passed, ${failures.length} failed\n`);
if (failures.length) {
  for (const f of failures) console.log(`  FAIL ${f.name}${f.detail ? ` — ${f.detail}` : ''}`);
}

await context.close();
await browser.close();
server.close();
process.exit(failures.length ? 1 : 0);
