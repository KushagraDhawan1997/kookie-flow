/** Validate tarballs in consumers that cannot resolve back into the monorepo. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const temp = mkdtempSync(join(tmpdir(), 'kookie-packages-'));
const artifactRoot = process.env.KOOKIE_PACKAGE_ARTIFACTS;
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const pnpm = process.env.KOOKIE_PNPM_BIN ?? (process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm');
const run = (bin, args, cwd) =>
  execFileSync(bin, args, {
    cwd,
    encoding: 'utf8',
    timeout: 240000,
    env: { ...process.env, NODE_OPTIONS: '', npm_config_cache: join(temp, '.npm-cache') },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
const write = (file, text) => writeFileSync(file, text);
const json = (file, value) => write(file, JSON.stringify(value, null, 2));
try {
  const tarballs = {};
  const manifests = {};
  const stagingRoot = join(temp, 'stage');
  mkdirSync(stagingRoot);
  cpSync(join(root, '.pnpmfile.mjs'), join(stagingRoot, '.pnpmfile.mjs'));
  json(join(stagingRoot, 'package.json'), { private: true, packageManager: 'pnpm@12.4.1' });
  write(join(stagingRoot, 'pnpm-workspace.yaml'), "packages:\n  - 'packages/*'\n");
  for (const part of ['core', 'webgl', 'react', 'legacy']) {
    const folder = part === 'legacy' ? 'kookie-flow' : 'kookie-flow-' + part;
    const source = join(root, 'packages', folder);
    const stage = join(stagingRoot, 'packages', folder);
    mkdirSync(stage, { recursive: true });
    cpSync(join(source, 'package.json'), join(stage, 'package.json'));
    cpSync(artifactRoot ? join(artifactRoot, part) : join(source, 'dist'), join(stage, 'dist'), {
      recursive: true,
    });
    cpSync(join(source, 'LICENSE'), join(stage, 'LICENSE'));
    for (const file of ['README.md', 'PRODUCTION.md'])
      if (existsSync(join(source, file))) cpSync(join(source, file), join(stage, file));
    if (part === 'webgl') cpSync(join(source, 'fonts'), join(stage, 'fonts'), { recursive: true });
  }
  for (const part of ['core', 'webgl', 'react', 'legacy']) {
    const folder = part === 'legacy' ? 'kookie-flow' : 'kookie-flow-' + part;
    const stage = join(stagingRoot, 'packages', folder);
    const manifest = JSON.parse(readFileSync(join(stage, 'package.json'), 'utf8'));
    for (const [name, range] of Object.entries({
      ...manifest.dependencies,
      ...manifest.devDependencies,
    })) {
      if (!range.startsWith('workspace:')) continue;
      const target = join(stage, 'node_modules', name);
      mkdirSync(dirname(target), { recursive: true });
      symlinkSync(join(stagingRoot, 'packages', name.split('/')[1]), target, 'dir');
    }
    const archive = join(temp, part + '.tgz');
    // Real pnpm packing: the same workspace expansion and beforePacking hook used at release.
    run(pnpm, ['pack', '--ignore-scripts', '--out', archive], stage);
    const pkg = JSON.parse(run('tar', ['-xOf', archive, 'package/package.json'], temp));
    const files = new Set(
      run('tar', ['-tzf', archive], temp)
        .trim()
        .split('\n')
        .map((f) => f.replace(/^package\//, ''))
    );
    assert.ok(!JSON.stringify(pkg.exports).includes('kookie-flow-source'));
    assert.ok(!JSON.stringify(pkg.dependencies).includes('workspace:'));
    assert.ok(files.has('LICENSE'));
    for (const [entry, condition] of Object.entries(pkg.exports))
      for (const mode of ['import', 'require']) {
        assert.ok(
          files.has(condition[mode].default.slice(2)),
          `${pkg.name}${entry}: missing ${mode} implementation`
        );
        assert.ok(
          files.has(condition[mode].types.slice(2)),
          `${pkg.name}${entry}: missing ${mode} declarations`
        );
      }
    if (part === 'webgl') assert.ok(files.has('fonts/Inter-LICENSE.txt'));
    assert.ok(
      ![...files].some((f) => /(?:^|\/)(?:harness|audit)\//.test(f) || f.includes('.test.'))
    );
    tarballs[pkg.name] = 'file:' + archive;
    manifests[part] = pkg;
    console.log(`${pkg.name}: ${statSync(archive).size} bytes, every export and license present`);
  }
  const core = join(temp, 'core-consumer');
  mkdirSync(core);
  json(join(core, 'package.json'), {
    private: true,
    type: 'module',
    dependencies: {
      '@kushagradhawan/kookie-flow-core': tarballs['@kushagradhawan/kookie-flow-core'],
      '@types/node': '26.5.1',
    },
  });
  run(
    npm,
    ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false'],
    core
  );
  assert.ok(!existsSync(join(core, 'node_modules/react')), 'Core consumer pulled in React');
  assert.ok(!existsSync(join(core, 'node_modules/three')), 'Core consumer pulled in Three');
  const exercise = `const store = core.createFlowStore({entities:[{id:'a',type:'default',position:{x:0,y:0},data:{}}]});
    store.getState().fitView({},800,600);
    if(!Number.isFinite(store.getState().viewport.zoom)) throw Error('Invalid fit');
    core.parseFlowObject(store.getState().toObject());
    store.getState().disposeEvaluation();`;
  write(
    join(core, 'smoke.mjs'),
    `import * as core from '@kushagradhawan/kookie-flow-core';\n${exercise}`
  );
  write(
    join(core, 'smoke.cjs'),
    `const core=require('@kushagradhawan/kookie-flow-core');\n${exercise}`
  );
  run(process.execPath, ['smoke.mjs'], core);
  run(process.execPath, ['smoke.cjs'], core);
  const consumer = `import {createFlowStore, type Entity} from '@kushagradhawan/kookie-flow-core';
    const entities: Entity[] = []; const store = createFlowStore({entities}); store.getState().fitView({},800,600);`;
  for (const ext of ['mts', 'cts']) write(join(core, 'consumer.' + ext), consumer);
  json(join(core, 'tsconfig.json'), {
    compilerOptions: {
      target: 'ES2022',
      lib: ['ES2022'],
      types: ['node'],
      module: 'NodeNext',
      moduleResolution: 'NodeNext',
      noEmit: true,
      strict: true,
      skipLibCheck: false,
    },
    include: ['consumer.mts', 'consumer.cts'],
  });
  run(
    process.execPath,
    [join(root, 'node_modules/typescript/bin/tsc'), '-p', join(core, 'tsconfig.json')],
    core
  );
  console.log(
    'Core consumer passed: ESM/CJS, both declaration formats, no DOM/React/Three dependencies.'
  );
  const app = join(temp, 'react-consumer');
  mkdirSync(app);
  const legacyDev = JSON.parse(
    readFileSync(join(root, 'packages/kookie-flow/package.json'))
  ).devDependencies;
  const dependencies = {
    ...tarballs,
    '@kushagradhawan/kookie-ui-react':
      'file:' + join(root, 'vendor/kushagradhawan-kookie-ui-react-0.0.0-flow.1.tgz'),
  };
  for (const peer of Object.keys(manifests.webgl.peerDependencies))
    if (!(peer in dependencies)) dependencies[peer] = legacyDev[peer].replace(/^[~^]/, '');
  dependencies['@types/react'] = legacyDev['@types/react'].replace(/^[~^]/, '');
  dependencies['@types/three'] = legacyDev['@types/three'].replace(/^[~^]/, '');
  json(join(app, 'package.json'), { private: true, type: 'module', dependencies });
  run(npm, ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false'], app);
  for (const mode of ['mjs', 'cjs']) {
    const load =
      mode === 'mjs'
        ? `import * as flow from '@kushagradhawan/kookie-flow-react'; import * as old from '@kushagradhawan/kookie-flow'; import * as gl from '@kushagradhawan/kookie-flow-webgl'; import * as plugins from '@kushagradhawan/kookie-flow/plugins';`
        : `const flow=require('@kushagradhawan/kookie-flow-react'),old=require('@kushagradhawan/kookie-flow'),gl=require('@kushagradhawan/kookie-flow-webgl'),plugins=require('@kushagradhawan/kookie-flow/plugins');`;
    write(
      join(app, 'smoke.' + mode),
      `${load}\nif(flow.KookieFlow !== old.KookieFlow || gl.KookieFlow !== flow.KookieFlow || old.FlowProvider !== gl.FlowProvider) throw Error('Duplicate implementations'); if (!flow.useGraph || !plugins.useClipboard) throw Error('Missing exports');`
    );
    run(process.execPath, ['smoke.' + mode], app);
  }
  const source = `import {KookieFlow,useGraph,type Entity} from '@kushagradhawan/kookie-flow-react';
    import {KookieFlow as Legacy} from '@kushagradhawan/kookie-flow';
    import {layoutGraph} from '@kushagradhawan/kookie-flow-core/layout';
    const entities: Entity[] = []; export {KookieFlow,Legacy,useGraph,layoutGraph,entities};`;
  for (const ext of ['mts', 'cts']) write(join(app, 'consumer.' + ext), source);
  json(join(app, 'tsconfig.json'), {
    compilerOptions: {
      target: 'ES2022',
      module: 'NodeNext',
      moduleResolution: 'NodeNext',
      noEmit: true,
      strict: true,
      skipLibCheck: true,
      jsx: 'react-jsx',
    },
    include: ['consumer.mts', 'consumer.cts'],
  });
  run(
    process.execPath,
    [join(root, 'node_modules/typescript/bin/tsc'), '-p', join(app, 'tsconfig.json')],
    app
  );
  const { build } = await import(
    join(root, 'packages/kookie-flow/node_modules/esbuild/lib/main.js')
  );
  await build({
    absWorkingDir: app,
    entryPoints: ['consumer.mts'],
    bundle: true,
    platform: 'browser',
    format: 'esm',
    write: false,
    logLevel: 'silent',
  });
  console.log(
    'React consumer passed: ESM/CJS, declarations, browser bundle and shared implementation identity.'
  );
} catch (error) {
  if (error.stdout) console.error(String(error.stdout));
  if (error.stderr) console.error(String(error.stderr));
  throw error;
} finally {
  rmSync(temp, { recursive: true, force: true });
}
