const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { lintFile } = require('../../../dist/rpgscript/lint');
const { setCommands } = require('../../../dist/generics');
const { disableConsole } = require('../../../dist/logger');

disableConsole();
setCommands(['setStorage', 'setLocal', 'setIndex']);
const file = path.join(__dirname, 'lists.rpgscript');
const source = `@start
+items=|
  key,
  map,
|
+[i]=0
+?while in([i], {items}):{
  +[item]={items}->[i]
  +[i]=[i]+1
}
+{items}->0="new"`;
assert.deepEqual(lintFile(file, __dirname, source).diagnostics, []);
const grammar = fs.readFileSync(path.join(__dirname, '../../../../../syntaxes/rpgscript.tmLanguage'), 'utf8');
const listRule = grammar.slice(grammar.indexOf('<key>main</key>'), grammar.indexOf('<key>main__1</key>'));
assert(listRule.includes('<key>4</key><dict><key>name</key><string>keyword.operator.assignment.rpgscript</string>'));
assert(listRule.includes('<key>endCaptures</key><dict><key>1</key><dict><key>name</key><string>keyword.operator.assignment.rpgscript</string>'));
assert(listRule.includes('<key>2</key><dict><key>name</key><string>punctuation.terminator.statement.rpgscript</string>'));
console.log('List syntax: editor diagnostics passed.');
