/** Bound the historical overlapping-frame explosion in a disposable 192 MB process. */
import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
const temp = mkdtempSync(join(tmpdir(), 'kookie-spatial-'));
try {
  const file = join(temp, 'stress.mjs');
  await build({
    stdin: {
      contents: `import {Quadtree} from './src/core/spatial.ts';
    const tree = new Quadtree({x:0,y:0,width:1,height:1});
    const count = Number(process.argv[2]);
    const nodes = Array.from({length:count},(_,i)=>({id:String(i),type:'frame',data:{},position:{x:0,y:0},width:10000,height:10000}));
    tree.rebuild(nodes);
    let cells=0,refs=0; function walk(t){if(!t)return;cells++;refs+=t.entries.length;for(const k of ['nw','ne','sw','se'])walk(t[k]);} walk(tree);
    const found=tree.queryRange({x:0,y:0,width:10000,height:10000}).length;
    console.log(JSON.stringify({count,cells,refs,found,heapMB:process.memoryUsage().heapUsed/1048576}));`,
      resolveDir: process.cwd(),
      loader: 'ts',
    },
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile: file,
    logLevel: 'silent',
  });
  for (const count of [9, 1000, 10000]) {
    const run = spawnSync(process.execPath, ['--max-old-space-size=192', file, String(count)], {
      encoding: 'utf8',
      timeout: 10_000,
      maxBuffer: 1024 * 1024,
    });
    assert.equal(
      run.status,
      0,
      `Child failed: ${run.error ?? run.signal}\n${run.stderr.slice(-1000)}`
    );
    const result = JSON.parse(run.stdout);
    console.log(result);
    assert.equal(result.found, count);
    assert.equal(result.refs, count);
    assert.ok(result.cells <= 5, 'Overlapping rectangles must stay in their common ancestor');
  }
} finally {
  rmSync(temp, { recursive: true, force: true });
}
