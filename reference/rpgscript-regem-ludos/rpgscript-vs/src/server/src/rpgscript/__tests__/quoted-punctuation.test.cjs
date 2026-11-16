const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const grammar = fs.readFileSync(path.join(__dirname, '../../../../../syntaxes/rpgscript.tmLanguage'), 'utf8');
for (const [section, next] of [['in_parens__1', 'in_parens__2'], ['in_parens__2', 'in_parens__3']]) {
  const rules = grammar.slice(grammar.indexOf(`<key>${section}</key>`), grammar.indexOf(`<key>${next}</key>`));
  const substitution = rules.indexOf('<string>(\\[)([\\w\\d_\\-\\.\\x{0020}]*)(\\])</string>');
  const fallback = rules.indexOf('<string>(.)</string>');
  assert(substitution >= 0 && fallback > substitution, `${section} must color substitutions before other quoted text`);
  assert(rules.slice(fallback).includes('<string>string.rpgscript</string>'));
}
console.log('Quoted punctuation: grammar scopes passed.');
