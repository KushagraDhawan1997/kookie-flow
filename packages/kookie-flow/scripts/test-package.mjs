/** Install the actual tarball into an isolated consumer, then exercise every export and its types. */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const temp = mkdtempSync(join(tmpdir(), 'kookie-consumer-'));
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const run = (file, args, cwd = temp) =>
  execFileSync(file, args, {
    cwd,
    env: { ...process.env, npm_config_cache: join(temp, '.npm-cache') },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 180_000,
  });
try {
  const packed = JSON.parse(
    run(npm, ['pack', '--json', '--ignore-scripts', '--pack-destination', temp], process.cwd())
  )[0];
  const files = new Set(packed.files.map((file) => file.path));
  for (const file of [
    'LICENSE',
    'fonts/Inter-LICENSE.txt',
    'dist/index.js',
    'dist/index.cjs',
    'dist/index.d.ts',
    'dist/index.d.cts',
  ])
    assert.ok(files.has(file), `Missing package file: ${file}`);
  assert.ok(![...files].some((file) => file.startsWith('audit/') || file.startsWith('harness/')));
  const dependencies = Object.fromEntries(
    Object.keys(pkg.peerDependencies).map((name) => [
      name,
      name === '@kookie-ui/react'
        ? `file:${resolve('../../vendor/kookie-ui-react-0.0.0.tgz')}`
        : pkg.devDependencies[name].replace(/^[~^]/, ''),
    ])
  );
  dependencies[pkg.name] = `file:${join(temp, packed.filename)}`;
  dependencies['@types/react'] = pkg.devDependencies['@types/react'].replace(/^[~^]/, '');
  dependencies['@types/three'] = pkg.devDependencies['@types/three'].replace(/^[~^]/, '');
  writeFileSync(
    join(temp, 'package.json'),
    JSON.stringify({ private: true, type: 'module', dependencies })
  );
  run(npm, [
    'install',
    '--ignore-scripts',
    '--no-audit',
    '--no-fund',
    '--package-lock=false',
    '--cache',
    join(temp, '.npm-cache'),
  ]);
  for (const [mode, extension] of [
    ['esm', 'mjs'],
    ['cjs', 'cjs'],
  ]) {
    const code =
      mode === 'esm'
        ? `import * as flow from '${pkg.name}'; import * as layout from '${pkg.name}/layout'; import * as plugins from '${pkg.name}/plugins';`
        : `const flow=require('${pkg.name}'),layout=require('${pkg.name}/layout'),plugins=require('${pkg.name}/plugins');`;
    writeFileSync(
      join(temp, `smoke.${extension}`),
      `${code}
      if(!flow.KookieFlow || !Object.keys(plugins).length) throw new Error('Missing exports');
      flow.parseFlowObject({entities:[],edges:[],viewport:{x:0,y:0,zoom:1}});
      if(layout.layoutGraph([{id:'a',width:100,height:100}],[]).positions.size!==1) throw new Error('Layout failed');
      console.log('${mode}: root, layout, plugins passed');`
    );
    console.log(run(process.execPath, [`smoke.${extension}`]).trim());
  }
  const consumer = `import { KookieFlow, parseFlowObject, type Entity } from '${pkg.name}';
    import { layoutGraph } from '${pkg.name}/layout'; import * as plugins from '${pkg.name}/plugins';
    const nodes: Entity[] = []; const doc = parseFlowObject({entities:nodes,edges:[],viewport:{x:0,y:0,zoom:1}});
    export const api = {KookieFlow,layoutGraph,plugins,doc};`;
  for (const extension of ['mts', 'cts'])
    writeFileSync(join(temp, `consumer.${extension}`), consumer);
  writeFileSync(
    join(temp, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        noEmit: true,
        strict: true,
        skipLibCheck: true,
        target: 'ES2022',
        module: 'NodeNext',
        moduleResolution: 'NodeNext',
        jsx: 'react-jsx',
      },
      include: ['consumer.mts', 'consumer.cts'],
    })
  );
  run(process.execPath, [
    resolve('node_modules/typescript/bin/tsc'),
    '-p',
    join(temp, 'tsconfig.json'),
  ]);
  await build({
    absWorkingDir: temp,
    entryPoints: ['consumer.mts'],
    bundle: true,
    platform: 'browser',
    format: 'esm',
    write: false,
    logLevel: 'silent',
  });
  console.log(
    `Packed consumer passed: ${packed.filename}, ${packed.size} bytes; ESM/CJS imports, both declaration formats, browser bundle, licenses.`
  );
} catch (error) {
  if (error.stdout) console.error(error.stdout.toString());
  if (error.stderr) console.error(error.stderr.toString());
  throw error;
} finally {
  rmSync(temp, { recursive: true, force: true });
}
