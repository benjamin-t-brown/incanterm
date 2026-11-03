const assert = require('node:assert/strict');
const path = require('node:path');
const { lintFile } = require('../../../dist/rpgscript/lint');
const { setCommands } = require('../../../dist/generics');
const { disableConsole } = require('../../../dist/logger');

disableConsole();
setCommands(['log']);
const root = path.resolve(__dirname);
const file = path.join(root, 'main.rpgscript');
for (const binding of ['timer,clock,1000', 'timer,clock', 'timer,this,250']) {
  assert.deepEqual(lintFile(file, root, `#clock\n${binding}\n@clock\n+log("Tick!")`).diagnostics, []);
}
for (const interval of ['0', '-1', 'NaN', 'Infinity', '', '100,200,300']) {
  assert(lintFile(file, root, `#clock\ntimer,clock,${interval}\n@clock`).diagnostics
    .some(d => d.message.includes('Timer interval')));
}
assert(lintFile(file, root, '#clock\ntimer,missing,1000').diagnostics
  .some(d => d.code === 'unknown-script'));
assert.deepEqual(lintFile(file, root, '#clock\ntimer,tick,Ralgo,2000\n@tick(ch)\n+log("[ch]")').diagnostics, []);
assert(lintFile(file, root, '#clock\ntimer,tick,Ralgo,2000\n@tick').diagnostics.some(d => d.code === 'script-argument-count'));
assert(lintFile(file, root, '#clock\ntimer,tick,,2000\n@tick(ch)').diagnostics.some(d => d.message.includes('character name or ID')));
