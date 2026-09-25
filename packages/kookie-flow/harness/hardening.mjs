/** Regression checks against the real renderer, alongside the existing behavior suite. */
export async function hardeningChecks({ head, withPage, check, context, port, skipping }) {
  head('production hardening: movement, cancellation, capacity');
  await withPage('nodes=12', async (page, errors) => {
    await page.evaluate(() => {
      const state = window.__harness.store.getState();
      const ids = [...new Set(state.edges.flatMap((edge) => [edge.source, edge.target]))].slice(
        0,
        2
      );
      for (const id of ids) {
        const entity = state.entityMap.get(id);
        state.updateEntityPositions([
          { id, position: { x: entity.position.x + 50, y: entity.position.y + 50 } },
        ]);
      }
    });
    await page.waitForTimeout(400);
    const partial = await page.evaluate(() => window.__harness.drawnVertices());
    await page.evaluate(() => {
      const state = window.__harness.store.getState();
      state.setEdges([...state.edges]);
    });
    await page.waitForTimeout(400);
    const full = await page.evaluate(() => window.__harness.drawnVertices());
    check(
      'batched movement equals a full geometry rebuild',
      partial.length > 0 &&
        partial.length === full.length &&
        partial.every(
          (v, i) =>
            v.kind === full[i].kind &&
            Math.abs(v.x - full[i].x) < 0.001 &&
            Math.abs(v.y - full[i].y) < 0.001
        )
    );
    const cancelled = await page.evaluate(() => {
      const h = window.__harness,
        state = h.store.getState();
      const edge = state.edges.find((e) => e.sourceSocket && e.targetSocket);
      const before = h.connections().length;
      state.startConnectionDraft(
        { entityId: edge.source, socketId: edge.sourceSocket, isInput: false },
        { x: 0, y: 0 }
      );
      state.setHoveredSocketId({
        entityId: edge.target,
        socketId: edge.targetSocket,
        isInput: true,
      });
      document
        .querySelector('[aria-label="Flow graph"]')
        .dispatchEvent(new PointerEvent('pointercancel', { bubbles: true, pointerId: 71 }));
      return {
        added: h.connections().length - before,
        cleared: h.store.getState().connectionDraft === null,
      };
    });
    check(
      'pointercancel retires a valid draft without creating a wire',
      cancelled.added === 0 && cancelled.cleared,
      JSON.stringify(cancelled)
    );
    const samples = [];
    for (const count of [32, 128, 512, 1024]) {
      await page.evaluate((n) => {
        const state = window.__harness.store.getState();
        const template =
          state.entities.find((e) => e.inputs?.length && e.outputs?.length) ?? state.entities[0];
        state.setEdges([]);
        state.setEntities(
          Array.from({ length: n }, (_, i) => ({
            ...template,
            id: `capacity-${i}`,
            // All visible, without 1,024 full-size cards overdrawn in the same 140px square.
            // Capacity is an instance-count test; massive fragment overdraw tests something else.
            width: 24,
            height: 16,
            data: { label: 'A' },
            inputs: [{ id: 'in', name: '', type: 'number', position: 0.5 }],
            outputs: [{ id: 'out', name: '', type: 'number', position: 0.5 }],
            position: { x: 60 + (i % 32) * 34, y: 80 + Math.floor(i / 32) * 20 },
          }))
        );
      }, count);
      // R3F disposes superseded objects at idle priority. Allow frames and an idle turn
      // to run before observing lifetimes, with a bounded wait even on software GL.
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() =>
        requestAnimationFrame(() => requestIdleCallback(resolve, { timeout: 2000 })))));
      await page.waitForTimeout(900);
      samples.push(
        await page.evaluate(() => {
          const l = window.__harness.glLifetimes();
          return l.buffersCreated - l.buffersDeleted;
        })
      );
    }
    check(
      'capacity growth disposes superseded GPU attributes',
      samples[0] > 0 && samples.every((n) => n === samples[0]),
      JSON.stringify(samples)
    );
    check(
      'hardening interactions produce no browser errors',
      errors.length === 0,
      errors.join('\n')
    );
  });
  head('production hardening: controlled contracts');
  if (!skipping()) {
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(String(error)));
    try {
      await page.goto(`http://127.0.0.1:${port}/contracts.html`);
      await page.getByRole('button', { name: 'Read state', exact: true }).click();
      const read = async () => JSON.parse(await page.locator('#props-result').textContent());
      check('controlled edge starts compatible', (await read()).edges[0].invalid === false);
      await page.getByRole('button', { name: 'Change target to string', exact: true }).click();
      await page.getByRole('button', { name: 'Read state', exact: true }).click();
      check(
        'socket schema change refreshes edge validity',
        (await read()).edges[0].invalid === true
      );
      await page.getByRole('button', { name: 'Zoom in past maximum', exact: true }).click();
      check('imperative zoom honors maximum', (await read()).viewport.zoom === 1);
      await page.getByRole('button', { name: 'Zoom out past minimum', exact: true }).click();
      check('imperative zoom honors minimum', (await read()).viewport.zoom === 0.5);
      await page
        .getByRole('button', { name: 'Fit with conflicting zoom bounds', exact: true })
        .click();
      check(
        'fitView reconciles conflicting options inside component limits',
        (await read()).viewport.zoom === 1
      );
      const beforeHiddenFit = (await read()).viewport;
      await page.getByRole('button', { name: 'Fit hidden canvas', exact: true }).click();
      check(
        'fitView on a hidden React canvas preserves the camera without throwing',
        JSON.stringify((await read()).viewport) === JSON.stringify(beforeHiddenFit) && errors.length === 0,
        errors.join('\n')
      );
      await page.getByRole('button', { name: 'Preserve imperative edges', exact: true }).click();
      check(
        'schema sync preserves the live edge document',
        (await read()).edges.map((edge) => edge.id).join() === 'imperative'
      );
      check(
        'controlled contracts produce no browser errors',
        errors.length === 0,
        errors.join('\n')
      );
    } finally {
      await page.close();
    }
  }
}
