/** CPU-only store benchmark; not a GPU or browser frame-rate measurement. */
import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const source =
  process.env.KOOKIE_BENCH_SOURCE ?? fileURLToPath(new URL('../../../kookie-flow-core/src/', import.meta.url));
const scratch = mkdtempSync(join(tmpdir(), 'kookie-store-bench-'));
try {
  const file = join(scratch, 'bench.mjs');
  await build({
    stdin: {
      contents: `export {createFlowStore} from ${JSON.stringify(resolve(source, 'core/store.ts'))};`,
      resolveDir: process.cwd(),
    },
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile: file,
    logLevel: 'silent',
  });
  const { createFlowStore } = await import(file);
  for (const count of [1000, 10000, 50000]) {
    const columns = Math.ceil(Math.sqrt(count));
    const entities = Array.from({ length: count }, (_, i) => ({
      id: 'n' + i,
      type: 'default',
      data: {},
      position: { x: (i % columns) * 300, y: Math.floor(i / columns) * 200 },
      width: 240,
      height: 100,
      inputs: [{ id: 'in', name: 'in', type: 'number' }],
      outputs: [{ id: 'out', name: 'out', type: 'number' }],
    }));
    const start = performance.now();
    const store = createFlowStore({ entities });
    const mountMs = performance.now() - start;
    const update = [{ id: 'n0', position: { x: 0, y: 0 } }];
    for (let i = 0; i < 100; i++) {
      update[0].position = { x: i % 20, y: 0 };
      store.getState().updateEntityPositions(update);
    }
    let arrays = 0;
    const off = store.subscribe(
      (s) => s.entities,
      () => arrays++
    );
    const samples = [];
    for (let i = 0; i < 500; i++) {
      update[0].position = { x: i % 20, y: 0 };
      const before = performance.now();
      store.getState().updateEntityPositions(update);
      samples.push(performance.now() - before);
    }
    samples.sort((a, b) => a - b);
    console.log(
      JSON.stringify({
        nodes: count,
        mountMs: +mountMs.toFixed(2),
        moveMedianMs: +samples[250].toFixed(4),
        moveP95Ms: +samples[475].toFixed(4),
        moves: 500,
        entityArrayNotifications: arrays,
        arraySlotsCopied: arrays * count,
        originalPosition: entities[0].position,
      })
    );
    off();
    store.getState().disposeEvaluation();
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
