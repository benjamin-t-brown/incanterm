const assert = require('node:assert/strict');
const { getOnceIdDiagnostics } = require('../../../dist/rpgscript/once-id');

const source = '#door\n  action,?all(once(),is(open)):enter\n@enter\n  +?once( ): {\n  }\n  +?once(posterRead):+log("ok")\n  +?once("quoted id"):+log("ok")\n  // +?once():\n  /* +?once(): */\n  Guide: "?once():"\n  +log("?once():")';
const diagnostics = getOnceIdDiagnostics('room.rpgscript', source);
assert.equal(diagnostics.length, 2);
assert.deepEqual(diagnostics.map(d => d.range.start), [
  { line: 1, character: 14 },
  { line: 3, character: 4 },
]);
assert(diagnostics.every(d => d.severity === 2 && d.code === 'once-missing-id'));
assert.equal(getOnceIdDiagnostics('room.rpgscript', '+?all(once(),once()):').length, 2);
console.log('once IDs: warnings, nested conditions, trigger bindings, ranges, strings and comments passed.');
