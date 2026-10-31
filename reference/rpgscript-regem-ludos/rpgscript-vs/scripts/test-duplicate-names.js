const assert = require('assert').strict;
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const { disableConsole } = require('../src/server/dist/logger');
const { setCommands } = require('../src/server/dist/generics');
const { lintFile } = require('../src/server/dist/rpgscript/lint');

disableConsole();
setCommands(['setStorage', 'playDialogue']);
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rpgscript-duplicates-'));
const file = path.join(root, 'main.rpgscript');
const other = path.join(root, 'nested', 'main.rpgscript');
const source = '  @shared\n+a=true\n#door\nload,shared\n';
const write = (file, contents) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, contents);
};
const warnings = (file, contents, buffers) =>
  lintFile(file, root, contents, buffers).diagnostics.filter(d => String(d.code).startsWith('duplicate-'));
const canonical = file => process.platform === 'win32' ? path.resolve(file).toLowerCase() : path.resolve(file);

try {
  write(file, source);
  write(other, '@shared\n#door\nload,shared\n');
  const duplicates = warnings(file, source);
  assert.deepEqual(duplicates.map(d => [d.code, d.severity, d.range.start.line]), [
    ['duplicate-script', 2, 0], ['duplicate-trigger', 2, 2],
  ]);
  assert.deepEqual(duplicates[0].range, {
    start: { line: 0, character: 3 }, end: { line: 0, character: 9 },
  });
  assert.equal(duplicates[0].relatedInformation[0].location.uri, pathToFileURL(canonical(other)).href);
  assert.match(duplicates[0].message, /nested[/\\]main\.rpgscript:1/);
  assert.equal(warnings(other, fs.readFileSync(other, 'utf8')).length, 2);

  // Every occurrence in the same document is flagged; script and trigger
  // namespaces are separate, and @this resolves to the preceding trigger.
  fs.unlinkSync(other);
  const local = '#door\n@this\n@door\n#door\n@this\n';
  assert.deepEqual(warnings(file, local).map(d => [d.code, d.range.start.line]), [
    ['duplicate-trigger', 0], ['duplicate-script', 1], ['duplicate-script', 2],
    ['duplicate-trigger', 3], ['duplicate-script', 4],
  ]);
  assert.deepEqual(warnings(file, '#door\n@this\n'), []);
  assert.deepEqual(warnings(file, '@shared\n// @shared\n/*\n@shared\n#door\n*/\n#door\n'), []);
  assert.equal(warnings(file, '@shared\nGuide: "/*"\n@shared\n').length, 2);
  assert.equal(warnings(file, '@shared\nGuide: "escaped \\"/*"\n@shared\n').length, 2);

  // Unsaved buffers replace disk contents rather than adding another definition.
  write(other, '@different\n');
  const buffers = new Map([[other, '@shared\n']]);
  assert.equal(warnings(file, source, buffers).length, 1);
  buffers.set(other, '@renamed\n');
  assert.equal(warnings(file, source, buffers).length, 0);
  buffers.set(other, '@shared\n');
  assert.equal(warnings(file, '@renamed\n', buffers).length, 0);
  const unsaved = path.join(root, 'new.rpgscript');
  assert.equal(warnings(unsaved, '@shared\n').length, 1);
  assert.equal(warnings(file, source, new Map([[unsaved, '@shared\n']])).length, 1);
  const outside = path.join(root, '..', 'outside.rpgscript');
  assert.equal(warnings(file, source, new Map([[outside, '@shared\n']])).length, 0);

  // Collect all headers before parsing, including those after malformed code.
  write(other, '@shared\n+broken\n#door\n');
  assert.equal(warnings(file, source).length, 2);
  fs.unlinkSync(other);
  assert.equal(warnings(file, source).length, 0);
  console.log('Duplicate names: recursive files, precise ranges, all occurrences, @this, namespaces, comments, unsaved edits, and error recovery passed.');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
