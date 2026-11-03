const assert = require('node:assert/strict');
const path = require('node:path');
const { lintFile } = require('../../../dist/rpgscript/lint');
const { setCommands } = require('../../../dist/generics');
const { disableConsole } = require('../../../dist/logger');

disableConsole();
setCommands(['setLocal', 'setStorage', 'log', 'callScript']);
const root = path.resolve(__dirname);
const file = path.join(root, 'main.rpgscript');
for (const body of ['+[a]=1', '+setLocal(a, 1)', '+setLocal("a", 1)', '+?is(true):+[a]=1']) {
  assert.deepEqual(lintFile(file, root, `@testReturn\n${body}\n+log("[a]")\n@start\n+:testReturn()`).diagnostics, []);
}
assert.deepEqual(lintFile(file, root, '#@action\n+[a]=1\n+log("[a]")').diagnostics, []);
assert(lintFile(file, root, '@first\n+[a]=1\n@second\n+log("[a]")').diagnostics.some(d => d.code === 'unknown-local'));
assert(lintFile(file, root, '@first\n+log("+[a]=1")').diagnostics.some(d => d.code === 'unknown-local'));
