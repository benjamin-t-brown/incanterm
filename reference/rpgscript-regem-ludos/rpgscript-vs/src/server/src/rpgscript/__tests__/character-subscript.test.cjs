const assert = require('node:assert/strict');
const path = require('node:path');
const { lintFile } = require('../../../dist/rpgscript/lint');
const { setCommands } = require('../../../dist/generics');
const { disableConsole } = require('../../../dist/logger');

disableConsole();
setCommands(['callChSubscript', 'log']);
const root = path.resolve(__dirname);
const file = path.join(root, 'main.rpgscript');
assert.deepEqual(lintFile(file, root, '@start\n+callChSubscript(Ralgo, move)\n@move(ch)\n+log("[ch]")').diagnostics, []);
assert(lintFile(file, root, '@start\n+callChSubscript(Ralgo, missing)').diagnostics.some(d => d.code === 'unknown-script'));
assert(lintFile(file, root, '@start\n+callChSubscript(Ralgo, move)\n@move').diagnostics.some(d => d.code === 'script-argument-count'));
