/** Keep package ownership enforceable, including type-only dependencies. */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, resolve, relative, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const names = ['core', 'webgl', 'react'];
const owners = new Map(names.map((name) => ['@kushagradhawan/kookie-flow-' + name, name]));
const allowed = { core: new Set(), webgl: new Set(['core']), react: new Set(['core', 'webgl']) };
const files = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? e.name === 'test'
        ? []
        : files(join(dir, e.name))
      : /\.tsx?$/.test(e.name) && !e.name.includes('.test.')
        ? [join(dir, e.name)]
        : []
  );
let checked = 0;
for (const name of names) {
  const dir = join(root, 'packages/kookie-flow-' + name);
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  for (const file of files(join(dir, 'src'))) {
    const source = ts.createSourceFile(
      file,
      readFileSync(file, 'utf8'),
      ts.ScriptTarget.Latest,
      true
    );
    const imports = [];
    function walk(node) {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier)
        imports.push(node.moduleSpecifier.text);
      if (
        ts.isCallExpression(node) &&
        node.expression.kind === ts.SyntaxKind.ImportKeyword &&
        ts.isStringLiteral(node.arguments[0])
      )
        imports.push(node.arguments[0].text);
      ts.forEachChild(node, walk);
    }
    walk(source);
    for (const specifier of imports) {
      const label = relative(root, file) + ' → ' + specifier;
      if (specifier.startsWith('.')) {
        const target = resolve(dirname(file), specifier);
        assert.ok(
          target.startsWith(join(dir, 'src') + '/'),
          'Cross-package relative import: ' + label
        );
        assert.ok(
          [target, target + '.ts', target + '.tsx', join(target, 'index.ts')].some(existsSync),
          'Missing import: ' + label
        );
        continue;
      }
      const dependency = specifier.startsWith('@')
        ? specifier.split('/').slice(0, 2).join('/')
        : specifier.split('/')[0];
      const owner = owners.get(dependency);
      if (owner) assert.ok(owner === name || allowed[name].has(owner), 'Package cycle: ' + label);
      if (name === 'core')
        assert.ok(
          specifier === 'zustand/vanilla' || specifier === 'zustand/middleware',
          'Core must not load a UI or browser package: ' + label
        );
      assert.ok(
        pkg.dependencies?.[dependency] || pkg.peerDependencies?.[dependency] || owner === name,
        'Undeclared runtime dependency: ' + label
      );
    }
    checked++;
  }
}
console.log(`Package boundaries passed: ${checked} production modules; core → webgl → react.`);
