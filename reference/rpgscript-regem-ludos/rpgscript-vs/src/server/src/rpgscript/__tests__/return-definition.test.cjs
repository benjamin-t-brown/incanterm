const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { RPGScriptParser } = require('../../../dist/rpgscript/rpgscript');
const { getDefinition } = require('../../../dist/rpgscript/definition');
const { setCurrentParser } = require('../../../dist/generics');

const file = path.join(__dirname, 'target.rpgscript');
const parser = new RPGScriptParser({ commands: [] });
parser.parse(file, '// target\n@testReturn2\n');
setCurrentParser(parser);
const normal = getDefinition('+:testReturn2()');
assert.equal(normal.targetUri, pathToFileURL(file).href);
assert.equal(normal.targetSelectionRange.start.line, 1);
for (const source of ['+[local]<+:testReturn2();', '  +[local] < +:testReturn2 ();', '+result<+:testReturn2();']) {
  assert.deepEqual(getDefinition(source), normal);
}
assert.equal(getDefinition('+[local]<+:missing();'), undefined);
