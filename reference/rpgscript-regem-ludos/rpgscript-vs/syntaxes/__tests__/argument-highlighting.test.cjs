const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const grammar = fs.readFileSync(path.join(__dirname, '../rpgscript.tmLanguage'), 'utf8');
const argumentRules = grammar.split('<key>in_parens</key>')[1].split('<key>in_parens__1</key>')[0];

function getPattern(scope) {
  const rules = [...argumentRules.matchAll(
    /<key>match<\/key>\s*<string>([^<]*)<\/string>\s*<key>name<\/key>\s*<string>([^<]*)<\/string>/g,
  )];
  const rule = rules.find((match) => match[2] === scope);
  assert.ok(rule, `Missing argument rule for ${scope}`);
  return new RegExp(rule[1].replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&'));
}

const constantPattern = getPattern('variable.other.constant.rpgscript');
const parameterPattern = getPattern('variable.parameter.rpgscript');

test('highlights digit-prefixed strings as whole parameters, not partial numbers', function checkStringArguments() {
  for (const value of ['3x3', '5x5', '123abc', '3-variant', '3.variant', '-3x3', 'true.variant', 'false-name']) {
    const line = `+setCharacterVariant(Actor, ${value})`;
    assert.equal(constantPattern.test(line), false, value);
    const match = parameterPattern.exec(value);
    assert.equal(match?.index, 0, value);
    assert.equal(match?.[0], value, value);
  }
});

test('highlights complete numeric and boolean literals as constants', function checkConstantArguments() {
  for (const value of ['0', '3', '42', '-42', '3.25', '-0.5', '.5', '-.5', 'true', 'false']) {
    for (const line of [`+log(${value})`, `+log(Actor, ${value} )`, `+value=${value}`, `<${value}`]) {
      assert.equal(constantPattern.exec(line)?.[0], value, line);
    }
  }
});
