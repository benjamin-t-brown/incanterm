const assert = require('assert').strict;
const fs = require('fs');
const os = require('os');
const path = require('path');
const { localScopeDiagnostics } = require('../src/server/dist/rpgscript/local-scope');
const { lintFile } = require('../src/server/dist/rpgscript/lint');
const { setCommands } = require('../src/server/dist/generics');
const { disableConsole } = require('../src/server/dist/logger');

const file = 'locals.rpgscript';
const source = '@testArgs2(arg1, arg2)\n  +log("Args {arg1} {arg2}")';
const diagnostics = localScopeDiagnostics(file, source);
assert.equal(diagnostics.length, 2);
assert(diagnostics.every(d => d.severity === 2 && d.code === 'local-global-confusion'));
assert.equal(diagnostics[0].message, '"arg1" is a local parameter. Did you mean [arg1]?');
assert.equal(diagnostics[1].message, '"arg2" is a local parameter. Did you mean [arg2]?');
assert.deepEqual(diagnostics[0].range, {
  start: { line: 1, character: 13 }, end: { line: 1, character: 19 },
});
assert.deepEqual(diagnostics[1].range, {
  start: { line: 1, character: 20 }, end: { line: 1, character: 26 },
});
assert.deepEqual(localScopeDiagnostics(file, source.replaceAll('{arg1}', '[arg1]').replaceAll('{arg2}', '[arg2]')), []);
assert.deepEqual(localScopeDiagnostics(file, '@test(arg1)\n+log("{global} {vars.arg1} {Arg1}")'), []);
assert.deepEqual(localScopeDiagnostics(file, '@first(arg1)\n@second\n+log("{arg1}")\n#trigger\nload,{arg1}'), []);
assert.deepEqual(localScopeDiagnostics(file, '@first(arg1)\n#trigger\nload,{arg1}'), []);
assert.equal(localScopeDiagnostics(file, '@first(arg1)\n@second(arg2)\n+log("{arg1} {arg2}")').length, 1);
assert.equal(localScopeDiagnostics(file, '@this(arg1)\n+?is({arg1}):{\n+{arg1}=2\n}').length, 2);
assert.deepEqual(localScopeDiagnostics(file, '@first(arg1)\n@broken(arg1\n+log("{arg1}")'), []);

const commented = `@test(arg1, arg2)
// {arg1}
/* {arg2}
@fake(other)
{arg1}
*/
  +log("{arg1}") // {arg2}
  Guide: "http://example.com/{arg2}"
  +log("Args {arg1} {arg2})`;
const warnings = localScopeDiagnostics(file, commented);
assert.deepEqual(warnings.map(d => d.range.start.line), [6, 7, 8, 8]);

const bare = '@test(arg1)\n  +?is(arg1):{\n+log("good")\n}';
const bareWarnings = localScopeDiagnostics(file, bare);
assert.equal(bareWarnings.length, 1);
assert.equal(bareWarnings[0].severity, 2);
assert.equal(bareWarnings[0].code, 'local-global-confusion');
assert.match(bareWarnings[0].message, /Did you mean \[arg1\]\?/);
assert.deepEqual(bareWarnings[0].range, {
  start: { line: 1, character: 7 }, end: { line: 1, character: 11 },
});
assert.deepEqual(localScopeDiagnostics(file, bare.replace('is(arg1)', 'is([arg1])')), []);
const nested = '@test(arg1, arg2)\n+?all(is(arg1), any(isnot(arg2), eq(arg1, arg2)), gt(arg1, 0), lt(0, arg2)):+log("ok")';
assert.equal(localScopeDiagnostics(file, nested).length, 6);
for (const body of [
  '+?is(global_flag):+log("ok")',
  '+?is("arg1"):+log("ok")',
  '+?eq("arg1", "arg2"):+log("ok")',
  '+?eq(vars.arg1, 0):+log("ok")',
  '+?is([arg1]):+log("is(arg1)")',
  '+log("?is(arg1):")',
  'Guide: "?is(arg1):"',
  '// +?is(arg1):',
  '/* +?is(arg1): */',
  '@next\n+?is(arg1):+log("ok")',
  '#trigger\nload,?is(arg1):next',
]) assert.deepEqual(localScopeDiagnostics(file, '@test(arg1, arg2)\n' + body), [], body);
assert.equal(localScopeDiagnostics(file, '@test(arg1)\n+?is(/* comment */ arg1):+log("ok")').length, 1);

const shadowing = `@test(arg1, true, false)
  +arg1=1
  +?is(flag):+arg1=2
  +setStorage(arg1, 3)
  +setStorage("arg1", 4)
  +:other(arg1, "text, with (parens)", arg1)
  +callScript(other, arg1)
  +?is(flag):+:other(arg1)
  ?is(flag):setStorage('arg1', 5)`;
const shadowWarnings = localScopeDiagnostics(file, shadowing);
assert.equal(shadowWarnings.length, 11);
assert(shadowWarnings.every(d => d.severity === 2));
assert.deepEqual(shadowWarnings.slice(0, 2).map(d => d.code), ['parameter-literal-shadowing', 'parameter-literal-shadowing']);
assert.match(shadowWarnings[2].message, /Did you mean \+\[arg1\]=/);
assert.match(shadowWarnings[4].message, /Did you mean setLocal\(arg1,/);
assert.match(shadowWarnings[6].message, /passes a literal.*Did you mean \[arg1\]\?/);
assert.deepEqual(shadowWarnings.map(d => shadowing.split('\n')[d.range.start.line].slice(d.range.start.character, d.range.end.character)),
  ['true', 'false', ...Array(9).fill('arg1')]);
for (const body of [
  '+[arg1]=1', '+global=arg1', '+vars.arg1=1',
  '+setLocal(arg1, 1)', '+setStorage(global, 1)', '+setStorage("vars.arg1", 1)',
  '+:other([arg1], "arg1", \'arg1\')', '+callScript(arg1, [arg1])',
  '+log("+:other(arg1) +arg1=1 +setStorage(arg1, 1)")',
  'Guide: "+arg1=1"', '// +arg1=1', '/* +:other(arg1) */',
  '@next\n+arg1=1\n+:other(arg1)\n+setStorage(arg1, 1)',
  '#trigger\nload,arg1',
]) assert.deepEqual(localScopeDiagnostics(file, '@test(arg1)\n' + body), [], body);
assert.deepEqual(localScopeDiagnostics(file, '@test(truely, false_value)'), []);
assert.equal(localScopeDiagnostics(file, '@test(arg1)\n+setStorage({arg1}, 1)').length, 1);
assert.equal(localScopeDiagnostics(file, '@test(arg1)\n+:other({arg1})').length, 1);

// Include warnings in normal linter output, even during incomplete edits and
// when the file has no on-disk copy yet.
disableConsole();
setCommands(['log', 'setStorage', 'setLocal', 'callScript']);
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rpgscript-local-scope-'));
try {
  const localFile = path.join(root, file);
  const lint = text => lintFile(localFile, root, text).diagnostics.filter(d => d.code === 'local-global-confusion');
  assert.equal(lint(source).length, 2);
  assert.equal(lint(source.slice(0, -2)).length, 2);
  assert.equal(lint(source.replaceAll('{arg1}', '[arg1]').replaceAll('{arg2}', '[arg2]')).length, 0);
  assert.equal(lint(source.replace('arg1, arg2', 'other')).length, 0);
  assert.equal(lint(bare).length, 1);
  assert.equal(lint(bare.replace('is(arg1)', 'is([arg1])')).length, 0);
  assert.equal(lint('@test(arg1)\n+arg1=1\n+setStorage(arg1, 2)\n+:test(arg1)').length, 3);
  assert.equal(lint('@test(arg1)\n+[arg1]=1\n+setLocal(arg1, 2)\n+:test([arg1])').length, 0);
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
console.log('Local/global warnings: suggestions, exact ranges, parameter scope, comments, strings, nested blocks, and incomplete edits passed.');
