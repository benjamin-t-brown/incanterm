const assert = require('node:assert/strict');
const { getDefineCommandArgs } = require('../../../dist/rpgscript/commands');

const source = `const setAnimState = defineCommand({
  parse: (args, location) => {
    if (args.length !== 2) return;
    return {
      character: getScriptValue(args[0], location),
      state: getScriptValue(args[1], location),
    };
  },
  execute: (step) => {},
});
const bark = defineCommand({
  parse: (args, location) => {
    return {
      character: getScriptValue(args[0], location),
      text: getScriptValue(args[1], location),
      ms: args.length >= 3 ? getScriptValue(args[2], location) : undefined,
    };
  },
  execute: (step) => {},
});`.split('\n');
assert.deepEqual(getDefineCommandArgs(source, 0), ['character', 'state']);
assert.deepEqual(getDefineCommandArgs(source, 10), ['character', 'text', '?ms']);
console.log('defineCommand arguments: required and optional names passed.');
