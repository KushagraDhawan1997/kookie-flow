/** Browser laws for notes after moving their fill and text into WebGL. */
export async function gpuNoteChecks({ head, withPage, check, context, port, skipping }) {
  head('comments');
  const read = (page, x = 80, y = 80, width = 200, height = 120) =>
    page.evaluate(
      ({ x, y, width, height }) => {
        const h = window.__harness;
        const vp = h.store.getState().viewport;
        const sx = (n) => vp.x + n * vp.zoom,
          sy = (n) => vp.y + n * vp.zoom;
        const bg = h.readPixel(sx(x + width / 2), sy(y + height - 16));
        const canvas = h.canvas();
        const gl = canvas.getContext('webgl2');
        const dpr = canvas.width / canvas.clientWidth;
        const w = Math.round((width - 24) * vp.zoom * dpr),
          ht = Math.round(48 * vp.zoom * dpr);
        const pixels = new Uint8Array(w * ht * 4);
        gl.readPixels(
          Math.round(sx(x + 12) * dpr),
          Math.round(canvas.height - sy(y + 60) * dpr),
          w,
          ht,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          pixels
        );
        const lum = (rgb) =>
          rgb
            .slice(0, 3)
            .map((v) => v / 255)
            .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
            .reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
        let hash = 2166136261,
          ink = 0,
          minY = ht,
          maxY = -1,
          contrast = 1;
        const bgLum = lum(bg);
        for (let i = 0; i < pixels.length; i += 4) {
          for (let k = 0; k < 3; k++) hash = Math.imul(hash ^ pixels[i + k], 16777619);
          if (Math.max(...bg.slice(0, 3).map((v, k) => Math.abs(v - pixels[i + k]))) > 30) {
            ink++;
            const row = Math.floor(i / 4 / w);
            minY = Math.min(minY, row);
            maxY = Math.max(maxY, row);
            const fgLum = lum(Array.from(pixels.subarray(i, i + 3)));
            contrast = Math.max(
              contrast,
              (Math.max(bgLum, fgLum) + 0.05) / (Math.min(bgLum, fgLum) + 0.05)
            );
          }
        }
        const glyphs = h
          .drawnInstances()
          .filter(
            (p) =>
              p.kind.startsWith('glyphs') &&
              p.x > x &&
              p.x < x + width &&
              p.y > y &&
              p.y < y + height
          ).length;
        const bodies = h.drawnInstances().filter((p) => p.kind.startsWith('comments-')).length;
        return {
          bg,
          bgLum,
          contrast,
          hash,
          ink,
          inkHeight: maxY - minY + 1,
          glyphs,
          bodies,
          dom: document.querySelectorAll('[data-entity-id]').length,
        };
      },
      { x, y, width, height }
    );
  const near = (a, b) => a && b && a.slice(0, 3).every((v, i) => Math.abs(v - b[i]) <= 3);

  await withPage('scene=comments&preserveBuffer=1', async (page) => {
    const before = await read(page),
      otherBefore = await read(page, 340);
    check(
      'INSTRUMENT: two GPU note bodies and visible text',
      before.bodies === 2 && before.ink > 20 && before.glyphs > 6,
      JSON.stringify(before)
    );
    check('notes add no per-entity DOM', before.dom === 0, String(before.dom));
    const commitsBefore = await page.evaluate(() => window.__harness.reactCommits().commits);
    check(
      'INSTRUMENT: React commit counter observed mounting',
      commitsBefore > 0,
      String(commitsBefore)
    );
    await page.evaluate(() =>
      window.__harness.store
        .getState()
        .applyEntityChanges([
          {
            type: 'data',
            id: 'note-a',
            data: {
              content: 'edited',
              backgroundColor: '#B3E5FC',
              textColor: '#01579B',
              fontSize: 22,
            },
          },
        ])
    );
    await page.waitForTimeout(300);
    const after = await read(page),
      otherAfter = await read(page, 340);
    check(
      'a note edits its GPU glyphs',
      after.glyphs === 6 && after.hash !== before.hash,
      JSON.stringify(after)
    );
    check(
      'a note edits its GPU fill and font size',
      near(after.bg, [179, 229, 252]) && after.inkHeight > before.inkHeight,
      JSON.stringify({ before, after })
    );
    check(
      'editing one note leaves the other raster unchanged',
      otherAfter.hash === otherBefore.hash && near(otherAfter.bg, otherBefore.bg),
      JSON.stringify({ otherBefore, otherAfter })
    );
    const commitsAfter = await page.evaluate(() => window.__harness.reactCommits().commits);
    check(
      'editing a note costs no React commit',
      commitsBefore === commitsAfter,
      `${commitsBefore} -> ${commitsAfter}`
    );
    await page.evaluate(() =>
      window.__harness.store.getState().applyEntityChanges([
        { type: 'remove', id: 'note-b' },
        {
          type: 'add',
          entity: {
            id: 'note-c',
            type: 'comment',
            position: { x: 340, y: 80 },
            width: 200,
            height: 120,
            data: {
              content: 'replacement',
              backgroundColor: '#FFCCBC',
              textColor: '#BF360C',
              fontSize: 14,
            },
          },
        },
      ])
    );
    await page.waitForTimeout(300);
    const swapped = await read(page, 340);
    check(
      'a same-count replacement paints its GPU body and text',
      swapped.bodies === 2 && swapped.glyphs === 11 && near(swapped.bg, [255, 204, 188]),
      JSON.stringify(swapped)
    );
  });

  await withPage('scene=comments&preserveBuffer=1', async (page) => {
    const corner = () =>
      page.evaluate(() => {
        const h = window.__harness,
          v = h.store.getState().viewport;
        const fill = h.readPixel(v.x + 180 * v.zoom, v.y + 160 * v.zoom);
        let inset = -1;
        for (let i = 0; i < 40 * v.zoom; i++) {
          const p = h.readPixel(v.x + 80 * v.zoom + i, v.y + 82 * v.zoom);
          if (p.slice(0, 3).every((c, k) => Math.abs(c - fill[k]) < 4)) {
            inset = i;
            break;
          }
        }
        const cut = h.readPixel(v.x + 80 * v.zoom, v.y + 80 * v.zoom);
        return { inset, cut, fill, zoom: v.zoom };
      });
    const before = await corner();
    check(
      'a GPU note has a cut corner and a filled body',
      before.inset > 0 && !near(before.cut, before.fill),
      JSON.stringify(before)
    );
    await page.evaluate(() => {
      const s = window.__harness.store.getState();
      s.setViewport({ ...s.viewport, zoom: s.viewport.zoom * 2 });
    });
    await page.waitForTimeout(250);
    const zoomed = await corner();
    check(
      'the GPU corner scales with viewport zoom',
      zoomed.inset > before.inset && Math.abs(zoomed.inset - before.inset * 2) <= 3,
      JSON.stringify({ before, zoomed })
    );
    await page.evaluate(() => window.__harness.store.getState().selectEntity('note-a'));
    await page.waitForTimeout(250);
    const selected = await corner();
    const bodies = await page.evaluate(() =>
      window.__harness.drawnInstances().filter((p) => p.kind.startsWith('comments-'))
    );
    check(
      'selection moves one body into the foreground without duplicating it',
      bodies.length === 2 &&
        bodies.filter((p) => p.kind === 'comments-foreground').length === 1 &&
        near(selected.fill, zoomed.fill),
      JSON.stringify(bodies)
    );
  });

  for (const appearance of ['light', 'dark'])
    await withPage(`scene=comments&preserveBuffer=1&appearance=${appearance}`, async (page) => {
      await page.evaluate(() =>
        window.__harness.store.getState().applyEntityChanges([
          {
            type: 'add',
            entity: {
              id: 'note-plain',
              type: 'comment',
              position: { x: 80, y: 260 },
              width: 200,
              height: 100,
              data: { content: 'plain' },
            },
          },
          {
            type: 'add',
            entity: {
              id: 'note-green',
              type: 'comment',
              position: { x: 340, y: 260 },
              width: 200,
              height: 100,
              data: { content: 'green', color: 'green' },
            },
          },
        ])
      );
      await page.waitForTimeout(350);
      const plain = await read(page, 80, 260, 200, 100),
        green = await read(page, 340, 260, 200, 100);
      check(
        `INSTRUMENT: both ${appearance} notes have GPU text`,
        plain.ink > 20 && green.ink > 20,
        JSON.stringify({ plain, green })
      );
      check(
        `a plain note in ${appearance} has a ${appearance} fill`,
        appearance === 'light' ? plain.bgLum > 0.6 : plain.bgLum < 0.2,
        JSON.stringify(plain)
      );
      check(`GPU text is legible in ${appearance}`, plain.contrast >= 4.5, String(plain.contrast));
      check(
        `a green GPU note in ${appearance} has a different fill`,
        Math.max(...plain.bg.slice(0, 3).map((v, i) => Math.abs(v - green.bg[i]))) > 12,
        JSON.stringify({ plain, green })
      );
    });

  head('package composition');
  if (skipping()) return;
  const page = await context.newPage(),
    errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  try {
    await page.goto(`http://127.0.0.1:${port}/packages.html`);
    await page.getByText('Left: light', { exact: true }).waitFor();
    await page.getByText('Right: dark', { exact: true }).waitFor();
    check('two public-package editors resolve their own appearance', true);
    await page.getByRole('button', { name: 'Toggle inherited appearance' }).click();
    await page.getByText('Left: dark', { exact: true }).waitFor();
    check(
      'an ancestor theme update keeps the explicit sibling theme',
      (await page.getByText('Right: dark', { exact: true }).count()) === 1
    );
    const count = () =>
      page.evaluate(() => ({
        total: document.querySelectorAll('*').length,
        entities: document.querySelectorAll('[data-entity-id]').length,
        canvases: document.querySelectorAll('canvas').length,
      }));
    const before = await count();
    await page.getByRole('button', { name: 'Left: 10,000 notes', exact: true }).click();
    await page.getByText('Left nodes: 10000', { exact: true }).waitFor();
    await page.waitForTimeout(600);
    const after = await count();
    check(
      '10,000 notes retain a bounded DOM',
      after.entities === 0 && after.canvases === 2 && after.total <= before.total + 2,
      JSON.stringify({ before, after })
    );
    check(
      'two editors and 10,000 GPU notes raise no browser errors',
      errors.length === 0,
      JSON.stringify(errors)
    );
  } finally {
    await page.close();
  }
}
