const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { lintFile } = require('../src/server/dist/rpgscript/lint');
const { setCommands } = require('../src/server/dist/generics');
const { getStorageAssignmentHover } = require('../src/server/dist/rpgscript/hover');
const { disableConsole } = require('../src/server/dist/logger');

disableConsole();
setCommands(['callScript', 'log', 'setLocal', 'setStorage', 'playDialogue', 'showChoices']);
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rpgscript-arguments-'));
const file = path.join(root, 'main.rpgscript');
const other = path.join(root, 'other.rpgscript');
const lint = (source, buffers) => lintFile(file, root, source, buffers);
try {
  const source = `@test_args
  +:test_args_2("a, b", "42")
@test_args_2(arg1, arg2)
  +log("Args [arg1] [arg2]")
  +[arg1]=[arg2]
  +?is([arg1]):+log("[arg2]")`;
  const result = lint(source);
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(result.parser.getScripts().test_args_2.parameters, ['arg1', 'arg2']);
  assert.deepEqual(result.parser.getScripts().test_args.blocks[0].commands[0].args, ['test_args_2', 'a, b', '42']);
  assert.deepEqual(lint('@start()\n+:empty()\n@empty()').diagnostics, []);
  assert.deepEqual(lint(source.replace('[arg1] [arg2]', '{arg1} {arg2}')).diagnostics.map(d => d.code), ['local-global-confusion', 'local-global-confusion']);
  assert.deepEqual(lint('@a(value)\n@b\n+log("[value]")\n+[missing]=1').diagnostics.map(d => d.code), ['unknown-local', 'unknown-local']);
  assert.deepEqual(lint('@a\n+setLocal(missing, 1)').diagnostics.map(d => d.code), ['unknown-local']);
  assert.deepEqual(lint('@a\n+log("{unknown_global}")').diagnostics, []);
  for (const header of ['@bad(a, a)', '@bad(a,)', '@bad(1)', '@bad(a']) {
    assert(lint(header).diagnostics.some(d => d.severity === 1), header);
  }
  fs.writeFileSync(other, '@remote(a, b)\n');
  assert.deepEqual(lint('@start\n+:remote(1, 2)').diagnostics, []);
  const mismatch = lint('@start\n+:remote(1)').diagnostics;
  assert.equal(mismatch[0].code, 'script-argument-count');
  assert.match(mismatch[0].message, /expects 2 argument\(s\), got 1/);
  assert.deepEqual(lint('@start\n+:remote(1)', new Map([[other, '@remote(a)']])).diagnostics, []);
  for (const caller of ['#entry\nload,remote', '@start\n$\nNext:remote', '@start\n+log("Next")\n>remote']) {
    assert(lint(caller).diagnostics.some(d => d.code === 'script-argument-count'), caller);
  }
  assert.match(getStorageAssignmentHover('  +[arg1]=[arg2]', 5).value, /setLocal\(arg1, \[arg2\]\)/);
  console.log('Script arguments: signatures, typed calls, locals, arity, cross-file/unsaved declarations, triggers, choices, and hovers passed.');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
