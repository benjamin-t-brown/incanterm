const assert = require('assert').strict;
const { disableConsole } = require('../src/server/dist/logger');
const { RPGScriptParser, ScriptParser } = require('../src/server/dist/rpgscript/rpgscript');
const { getStorageAssignmentHover, getHoverContents } = require('../src/server/dist/rpgscript/hover');

disableConsole();
const parser = new ScriptParser('assign.rpgscript');
assert.deepEqual(parser.parseConditional('else', 2), parser.parseConditional('else()', 2));
for (const [assignment, call] of [
  ['a=true', 'setStorage(a, true)'],
  ['b={vars.tmp}', 'setStorage(b, {vars.tmp})'],
  ['c=4', 'setStorage(c, 4)'],
  ['vars.tmp = -2.5;', 'setStorage(vars.tmp, -2.5)'],
  ['my_key="a,b=(c)?d:e"', 'setStorage(my_key, "a,b=(c)?d:e")'],
  ['literal="{vars.tmp}"', 'setStorage(literal, "{vars.tmp}")'],
  ['{someVar}=2', 'setStorage({someVar}, 2)'],
  ['{vars.destination}={vars.source}', 'setStorage({vars.destination}, {vars.source})'],
]) {
  assert.deepEqual(parser.parseCommand(assignment, 2), parser.parseCommand(call, 2));
}
assert.deepEqual(parser.parseCommand('b={vars.tmp}', 2).args, ['b', { storageKey: 'vars.tmp' }]);
assert.deepEqual(parser.parseCommand('{someVar}=2', 2).args, [{ storageKey: 'someVar' }, 2]);
assert.deepEqual(parser.parseCommand('setStorage("{someVar}", 2)', 2).args, ['{someVar}', 2]);

const project = new RPGScriptParser({ commands: ['setStorage', 'callScript'] });
project.parse('assign.rpgscript', `@start
+a=true
+b={vars.tmp}
+c=4
+?is(a):{
  +a=false
  +?is(b):{
    +nested={vars.tmp}
  }
  +after_nested=4
}
+?is(a):+inline=4
+?else:+inline=5
+:next()
@next
+done=true`);
const commands = project.getScript('start').blocks.flatMap(block => block.commands);
assert.equal(commands.filter(command => command.type === 'setStorage').length, 8);
assert.deepEqual(project.getCallScriptStrings(), [
  { scriptName: 'next', lineNum: 14, fileName: 'assign.rpgscript', argCount: 0 },
]);

for (const source of ['a=', 'a=;', 'a=true, false', 'a=b=4', 'a={vars.tmp', 'a={}', 'a="missing', 'a=4)']) {
  assert.throws(() => parser.parseCommand(source, 2), /\{Line 2\}.*Invalid storage assignment/);
}
assert.throws(() => parser.parseCommand('setStorage(b, {vars.tmp)', 2), /Invalid storage reference/);
assert.throws(() => parser.parseCommand('setStorage({vars.tmp, 2)', 2), /Invalid storage reference/);
for (const source of ['{someVar=2', 'someVar}=2', '{}=2', '{{someVar}}=2']) {
  assert.throws(() => parser.parseCommand(source, 2), /\{Line 2\}/);
}
project.parse('dynamic.rpgscript', `@dynamic
+someVar=a
+{someVar}=2
+?is(true):{
  {someVar}=3
  +{someVar}={vars.tmp}
}
+?is(true):{someVar}=4`);
const dynamic = project.getScript('dynamic').blocks.flatMap(block => block.commands);
assert.equal(dynamic.length, 5);
assert(dynamic.every(command => command.type === 'setStorage'));
assert(dynamic.slice(1).every(command => command.args[0].storageKey === 'someVar'));
for (const [line, expanded] of [
  ['+a=true', 'setStorage(a, true)'],
  ['  +b={vars.tmp}', 'setStorage(b, {vars.tmp})'],
  ['+c=4', 'setStorage(c, 4)'],
  ['+{someVar}=2', 'setStorage({someVar}, 2)'],
  ['  +{vars.destination} = {vars.source};', 'setStorage({vars.destination}, {vars.source})'],
  ['+?is(a):+{someVar}=2', 'setStorage({someVar}, 2)'],
  ['  +vars.my_key = -2.5;', 'setStorage(vars.my_key, -2.5)'],
  ['+?is(a):+b={vars.tmp}', 'setStorage(b, {vars.tmp})'],
  ['+?all(is(a), is(b)):+c=4', 'setStorage(c, 4)'],
  ['+?else():+text="a,b=(c)?d:e"', 'setStorage(text, "a,b=(c)?d:e")'],
  ['+?else:+text="a,b=(c)?d:e"', 'setStorage(text, "a,b=(c)?d:e")'],
  ['  a = false', 'setStorage(a, false)'],
]) {
  const start = line.lastIndexOf('+') >= 0 ? line.lastIndexOf('+') : line.indexOf('a');
  for (let character = start; character < line.length; character++) {
    assert.equal(getStorageAssignmentHover(line, character)?.value,
      `Storage Assignment\n\`\`\`rpgscript\n${expanded}\n\`\`\``, `${line} at ${character}`);
  }
  assert.equal(getStorageAssignmentHover(line, line.length), undefined);
}
for (const line of ['+log("+a=true")', 'Guide: "+a=true"', '// +a=true', '+a=', '+a=4)', '+:next()']) {
  assert.equal(getStorageAssignmentHover(line, Math.max(0, line.indexOf('a'))), undefined, line);
}
assert.equal(getStorageAssignmentHover('+?is(a):+b=4', 3), undefined);
assert.match(getHoverContents('Guide:').value, /Play Dialogue/);
console.log('Storage assignment parser, diagnostics, blocks, script-reference tracking, and hovers passed.');
