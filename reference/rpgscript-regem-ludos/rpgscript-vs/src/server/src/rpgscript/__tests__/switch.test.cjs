const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { lintFile } = require('../../../dist/rpgscript/lint');
const { setCommands } = require('../../../dist/generics');
const { disableConsole } = require('../../../dist/logger');

disableConsole();
setCommands(['log', 'playDialogue']);
const root = path.resolve(__dirname);
const file = path.join(root, 'switch.rpgscript');
const source = `@pick(value, label)
+?switch([value]):{
  0: {
    +log("zero")
  }
  "true": {
    +log("string")
  }
  a: {
    +log("bare string")
  }
  [label]: {
    +log("local")
  }
  *: {
    +log("default")
  }
}
+?switch(true):{
  lt({score}, 50): {
    +log("low")
  }
}`;
assert.deepEqual(lintFile(file, root, source).diagnostics, []);
assert(lintFile(file, root, source.replace('  *: {', '  broken(value): {')).diagnostics.some(d => d.severity === 1));
const grammar = fs.readFileSync(path.join(__dirname, '../../../../../syntaxes/rpgscript.tmLanguage'), 'utf8');
const mainRules = grammar.slice(grammar.indexOf('<key>main</key>'), grammar.indexOf('<key>in_dialog</key>'));
const switchRules = grammar.slice(grammar.indexOf('<key>switch_cases</key>'), grammar.indexOf('<key>main__9</key>'));
assert(mainRules.includes('<key>begin</key><string>^(\\s*)(\\+)(\\?switch)'));
assert(!mainRules.includes('<key>match</key><string>^\\s*([^+].*?)(:)'));
const caseRules = [...switchRules.matchAll(/<key>match<\/key><string>(\^\\s\*[^<]+)<\/string>\s*<key>captures<\/key><dict><key>1<\/key><dict><key>name<\/key><string>([^<]+)<\/string>/g)]
  .map(([, pattern, scope]) => ({ regex: new RegExp(pattern), scope }));
for (const [label, scope] of [
  ['"a"', 'string.rpgscript'],
  ['"*"', 'string.rpgscript'],
  ["'a'", 'string.rpgscript'],
  ['true', 'variable.other.constant.rpgscript'],
  ['false', 'variable.other.constant.rpgscript'],
  ['1', 'variable.other.constant.rpgscript'],
  ['a', 'variable.parameter.rpgscript'],
  ['*', 'variable.other.constant.rpgscript'],
  ['[label]', 'punctuation.terminator.statement.rpgscript'],
  ['{score}', 'punctuation.terminator.statement.rpgscript'],
]) {
  const line = `  ${label}: {`;
  const rule = caseRules.find(({ regex }) => regex.test(line));
  assert.equal(rule?.scope, scope, `Wrong case color for ${label}`);
  assert.equal(rule.regex.exec(line)[0].trimEnd().endsWith('{'), false, 'Case highlighting must not consume the block brace');
}
const switchHeaders = [...mainRules.matchAll(/<key>begin<\/key><string>([^<]*\\\?switch[^<]*)<\/string>/g)]
  .map(([, pattern]) => new RegExp(pattern));
assert(switchHeaders[0]?.test('+?switch({score}):{'));
assert(switchHeaders[0]?.test('+?switch([label]):{'));
assert(!switchHeaders[0]?.test('+?switch(score):{'));
assert(mainRules.includes('<key>5</key><dict><key>name</key><string>punctuation.terminator.statement.rpgscript</string>'));
console.log('Switch syntax: editor diagnostics passed.');
