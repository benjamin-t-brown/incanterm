const assert = require('node:assert/strict');
const path = require('node:path');
const { lintFile } = require('../../../dist/rpgscript/lint');
const { setCommands } = require('../../../dist/generics');
const { disableConsole } = require('../../../dist/logger');
disableConsole();
setCommands(['log', 'playDialogue']);
function getDiagnostics(body) {
  return lintFile(path.join(__dirname, 'main.rpgscript'), __dirname, '@start\n' + body).diagnostics;
}
for (const body of [
  '+?else:{\n}',
  '+?is(flag):{\n}\n+log("break")\n+?else:{\n}',
  '+?is(flag):{\n}\nGuide: "break"\n+?else:{\n}',
  '+?is(flag):{\n+?else:{\n}\n}',
  '+?is(flag):{\n}\n+?else:{\n}\n+?else:{\n}',
]) {
  assert(getDiagnostics(body).some(d => d.severity === 1 && d.message.includes('preceding conditional')), body);
}
for (const body of [
  '+?is(flag):{\n}\n// comment\n\n+?else:{\n}',
  '+?is(flag):{\n+?is(other):{\n}\n+?else:{\n}\n}\n+?else:{\n}',
]) assert.deepEqual(getDiagnostics(body), [], body);
console.log('Else diagnostics: orphaned, interrupted, repeated and nested branches passed.');
