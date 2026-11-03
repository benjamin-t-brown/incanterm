import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';

// Match whole camelCase/PascalCase words, not substrings ("character" is not "char").
const verbs = new Set(
  `accept activate add adopt advance alert allow animate announce append apply
  ask assert assign attach autoSave begin bind block break browse build call cancel capture
  can center change check choose clamp clear click clip clone close combine commit compare compile
  compose confirm connect constrain contain contains convert copy create cycle decode define delete
  detect diagnose discard dispatch display draw drop duplicate edit encode end ensure evaluate
  execute exists expand expect export extend fail fill filter find finish fit flatten flood
  flush focus forget format generate get give group handle has highlight hit import index
  input insert interpolate intersect is key list listen load log mark mask matches
  measure merge mount move navigate next on open paint parse paste persist pick place play
  preload prepare preview print prompt prune push put query read rebase redo redraw refresh
  relayout reload remember remove rename render reorder replace request require resize
  resolve restart restore reveal route run save schedule scroll select send set setup shape
  show shutdown split start stash step stop stroke style sync take throw toggle try undo
  update validate visit wait walk with wrap write zoom scan cleanup toast cache
  are report configure respond`.split(/\s+/),
);

function hasVerb(name) {
  const words = name
    .replace(/([a-z\d])([A-Z])/g, '$1 $2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1 $2')
    .split(/[^a-zA-Z]+/);
  return words.some((word) => verbs.has(word.toLowerCase()) || verbs.has(word));
}

const failures = [];
function scanFile(file) {
  const source = ts.createSourceFile(
    file,
    readFileSync(file, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );
  function visit(node) {
    let name;
    if (
      ts.isFunctionDeclaration(node) ||
      ts.isFunctionExpression(node) ||
      ts.isMethodDeclaration(node)
    )
      name = node.name;
    else if (
      (ts.isVariableDeclaration(node) || ts.isPropertyDeclaration(node)) &&
      node.initializer &&
      (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))
    )
      name = node.name;
    if (name && ts.isIdentifier(name) && !hasVerb(name.text)) {
      const line = source.getLineAndCharacterOfPosition(name.getStart(source)).line + 1;
      failures.push(`${file}:${line}: ${name.text} needs an action verb`);
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
}

function scanDirectory(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (entry.name !== 'dist' && entry.name !== 'node_modules')
        scanDirectory(join(dir, entry.name));
    } else if (/\.[cm]?[jt]sx?$/.test(entry.name)) scanFile(join(dir, entry.name));
  }
}

scanDirectory('src');
scanDirectory('scripts');
for (const file of ['vite.config.ts', 'vite.editor.config.ts', 'vitest.config.ts']) scanFile(file);
for (const failure of failures) console.error(failure);
if (failures.length) {
  console.error(`${failures.length} function names need a verb`);
  process.exitCode = 1;
}
