/** CPU-only evaluation work counts and elapsed time; no browser or GPU measurement. */
import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const source =
  process.env.KOOKIE_BENCH_SOURCE ?? fileURLToPath(new URL('../../src', import.meta.url));

const scratch = mkdtempSync(join(tmpdir(), 'kookie-scale-'));
try {
  const file = join(scratch, 'scale.mjs');
  await build({
    stdin: {
      contents: `
    import { Evaluator } from ${JSON.stringify(resolve(source, 'core/evaluation.ts'))};
    import { buildAdjacencyIndex } from ${JSON.stringify(resolve(source, 'core/graph.ts'))};
    for (const n of [100, 500, 1000, 2000, 10000, 50000]) {
      const nodes = new Map(); const edges = [];
      for (let i = 0; i < n; i++) {
        nodes.set(String(i), {id: String(i), type:'default', position:{x:0,y:0}, data:{}, inputs:[{id:'in',name:'in',type:'number'}], outputs:[{id:'out',name:'out',type:'number'}]});
        if (i) edges.push({id:'e'+i,source:String(i-1),target:String(i),sourceSocket:'out',targetSocket:'in'});
      }
      const index = buildAdjacencyIndex(edges);
      let lookups = 0, runs = 0;
      const evaluator = new Evaluator({getEntity: id => {lookups++;return nodes.get(id);}, entityIds: () => nodes.keys(), index: () => index, isMuted: () => false, evaluationMode: () => 'reactive', readInputValue: () => 0, onChange: () => {}});
      evaluator.setHandlers((_id, _type, inputs) => {runs++;return {out: Number(inputs.in) + 1};});
      const start = performance.now();
      await evaluator.evaluateAll();
      const elapsed = performance.now() - start;
      const lastOutput = evaluator.getSocketValue(String(n-1),'out');
      if (runs !== n || lastOutput !== n) throw new Error('Incorrect chain result at size ' + n);
      console.log(JSON.stringify({nodes:n, runs, entityLookups:lookups, milliseconds:Math.round(elapsed), lastOutput}));
      evaluator.dispose();
    }
  `,
      loader: 'ts',
      resolveDir: process.cwd(),
    },
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile: file,
    logLevel: 'silent',
  });
  const result = spawnSync(process.execPath, [file], { encoding: 'utf8', timeout: 60000 });
  process.stdout.write(result.stdout ?? '');
  process.stderr.write(result.stderr ?? '');
  if (result.error) console.log('child error:', result.error.code);
  process.exitCode = result.status ?? 1;
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
