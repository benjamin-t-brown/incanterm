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
for (const body of ['+a={a}+1', '+[b]=({a}+1)*2', '+^a=2**3', '+?is(true):+a={a} + 1']) {
  assert.deepEqual(lintFile(file, root, `@start\n${body}`).diagnostics, []);
}
assert.match(getStorageAssignmentHover('+a={a}+1', 2).value, /setStorage\(a, \{a\}\+1\)/);
assert(lintFile(file, root, '@start\n+a=[missing]+1').diagnostics.some(d => d.code === 'unknown-local'));
