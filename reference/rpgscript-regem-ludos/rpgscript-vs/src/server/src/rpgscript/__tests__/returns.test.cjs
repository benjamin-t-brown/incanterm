const assert = require('node:assert/strict');
const path = require('node:path');
const { lintFile } = require('../../../dist/rpgscript/lint');
const { setCommands } = require('../../../dist/generics');
const { disableConsole } = require('../../../dist/logger');

disableConsole();
setCommands(['callScript', 'callScriptResult', 'returnValue', 'setStorageIfUndefined', 'setStorage', 'setLocal']);
const root = path.resolve(__dirname);
const file = path.join(root, 'main.rpgscript');
const source = '@testReturn1\n+[local]<+:testReturn2();\n+result=[local]\n@testReturn2\n+^a=1\n+a={a}+1\n<{a}';
assert.deepEqual(lintFile(file, root, source).diagnostics, []);
assert(lintFile(file, root, '@start\n+[local]<+:missing();').diagnostics.some(d => d.code === 'unknown-script'));
assert(lintFile(file, root, '@start\n+[local]<+:child();\n@child(arg)\n<[arg]').diagnostics.some(d => d.code === 'script-argument-count'));
assert(lintFile(file, root, '@start\n<[missing]').diagnostics.some(d => d.code === 'unknown-local'));
