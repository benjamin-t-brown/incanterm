const assert = require('assert').strict;
const fs = require('fs');
const os = require('os');
const path = require('path');
const { disableConsole } = require('../src/server/dist/logger');
const { setCommands } = require('../src/server/dist/generics');
const { lintFile } = require('../src/server/dist/rpgscript/lint');

disableConsole();
setCommands(['callScript', 'playDialogue', 'showChoices', 'setStorage']);
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rpgscript-references-'));
const file = path.join(root, 'main.rpgscript');
const other = path.join(root, 'nested', 'main.rpgscript');
const write = (file, source) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, source);
};
const errors = (source, buffers) =>
  lintFile(file, root, source, buffers).diagnostics.filter(d => d.code === 'unknown-script');

try {
  const source = `@start
  +:missing(1, 2)
  +callScript("also_missing")
  +?is(flag):+:inline_missing()
  +?is(flag):{
    +:nested_missing()
  }
  Guide: "Dialogue"
  +setStorage(a, true)
  >arrow_missing
$
Continue:choice_missing
#entry
load,trigger_missing
action,?is(flag):conditional_missing
item,key,item_missing`;
  write(file, source);
  const diagnostics = errors(source);
  assert.deepEqual(diagnostics.map(d => d.range.start.line + 1), [2, 3, 4, 6, 10, 12, 14, 15, 16]);
  assert(diagnostics.every(d => d.severity === 1));
  assert.match(diagnostics[0].message, /"missing"/);
  assert.deepEqual(diagnostics[0].range, {
    start: { line: 1, character: 2 }, end: { line: 1, character: 17 },
  });

  const known = '@start\n+:remote()\n+callScript("forward")\n+:entry()\n@forward\n';
  write(other, '@remote\n#entry\nload,this\n@this\n');
  assert.deepEqual(errors(known), []);
  assert.deepEqual(errors(known, new Map([[other, '@renamed\n#entry\nload,this\n@this\n']]))
    .map(d => d.message), ['No script exists with name "remote".']);

  // The full set includes new unsaved files, but not buffers outside scriptsRoot.
  const unsaved = path.join(root, 'new.rpgscript');
  assert.deepEqual(errors('@start\n+:unsaved()', new Map([[unsaved, '@unsaved\n']])), []);
  assert.equal(errors('@start\n+:outside()', new Map([
    [path.join(root, '..', 'outside.rpgscript'), '@outside\n'],
  ])).length, 1);
  assert.equal(errors('@start\n+:renamed()').length, 1);

  // Calls in another document never become diagnostics on this document.
  write(other, '@remote\n+:foreign_missing()\n#trigger_only\n');
  assert.deepEqual(errors('@start\n+:remote()'), []);
  assert.equal(errors('@start\n+:trigger_only()').length, 1);
  assert.equal(errors('@start\n+:constructor()').length, 1);
  assert.deepEqual(errors('@start\n// +:commented()\nGuide: "+:not_a_call()"\n+value="callScript(not_a_call)"'), []);

  // A broken neighbor must not prevent checking the current document or hide
  // valid forward declarations. Commented-out declarations are not definitions.
  write(other, '@remote\n+broken\n@later\n// @commented\n/*\n@hidden\n*/\n');
  assert.deepEqual(errors('@start\n+:later()\n+:missing()\n+:commented()\n+:hidden()')
    .map(d => d.message), [
    'No script exists with name "missing".',
    'No script exists with name "commented".',
    'No script exists with name "hidden".',
  ]);
  assert.equal(errors('@start\n+:missing()\n+broken').length, 1);
  fs.unlinkSync(other);
  assert.equal(errors('@start\n+:remote()').length, 1);
  console.log('Unknown script diagnostics: shorthand, explicit calls, branches, triggers, choices, global/unsaved definitions, source ranges, and error recovery passed.');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
