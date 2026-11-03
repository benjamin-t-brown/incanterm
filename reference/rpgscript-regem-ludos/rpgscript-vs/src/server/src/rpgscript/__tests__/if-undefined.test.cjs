const assert = require('node:assert/strict');
const path = require('node:path');
const { lintFile } = require('../../../dist/rpgscript/lint');
const { getStorageAssignmentHover } = require('../../../dist/rpgscript/hover');
const { setCommands } = require('../../../dist/generics');
const { disableConsole } = require('../../../dist/logger');

disableConsole();
setCommands(['setStorageIfUndefined', 'setStorage', 'setLocal']);
const root = path.resolve(__dirname);
const file = path.join(root, 'main.rpgscript');
for (const body of ['+^a=1', '+^tmp.flag=false', '+?is(true):+^a=1', '+^{key}=2']) {
  assert.deepEqual(lintFile(file, root, `@start\n${body}`).diagnostics, []);
}
assert(lintFile(file, root, '@start(a)\n+^[a]=1').diagnostics.some(d => d.message.includes('cannot target local variables')));
assert(lintFile(file, root, '@start(a)\n+setStorageIfUndefined([a], 1)').diagnostics.some(d => d.message.includes('cannot target local variables')));
assert.match(getStorageAssignmentHover('+^a=1', 2).value, /setStorageIfUndefined\(a, 1\)/);
assert.equal(getStorageAssignmentHover('+^[a]=1', 3), undefined);
