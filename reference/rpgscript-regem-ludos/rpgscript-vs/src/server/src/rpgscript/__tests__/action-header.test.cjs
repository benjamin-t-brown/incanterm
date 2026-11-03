const assert = require('node:assert/strict');
const path = require('node:path');
const { lintFile } = require('../../../dist/rpgscript/lint');
const { setCommands } = require('../../../dist/generics');
const { disableConsole } = require('../../../dist/logger');

disableConsole();
setCommands(['callScript', 'log', 'playDialogue']);
const root = path.resolve(__dirname);
const file = path.join(root, 'main.rpgscript');
const source = '@start\n+:poster()\n#@poster\nGuide: "Smile!"';
const result = lintFile(file, root, source);
assert.deepEqual(result.diagnostics, []);
assert.equal(result.parser.getScripts().poster.lineNum, 3);
for (const declaration of ['@poster', '#poster', '#@poster']) {
  const result = lintFile(file, root, `${source}\n${declaration}`);
  assert(result.diagnostics.some(d => String(d.code).startsWith('duplicate-')));
}
assert(lintFile(file, root, '#@poster(value)').diagnostics.some(d => d.severity === 1));
console.log('Action headers: declarations, references, locations, and duplicates passed.');
