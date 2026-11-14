const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const grammar = fs.readFileSync(path.join(__dirname, '../rpgscript.tmLanguage'), 'utf8');
const rule = grammar.match(/<key>match<\/key>\s*<string>([^<]*&amp;[^<]*)<\/string>\s*<key>captures<\/key>\s*<dict>([\s\S]*?)\n\s*<\/dict>/);
assert.ok(rule, 'Portrait emotion must have a capture-based highlighting rule');
const pattern = new RegExp(rule[1].replaceAll('&amp;', '&').replace(/\\x\{0020\}/g, ' '));
const scopes = [...rule[2].matchAll(/<key>(\d)<\/key><dict><key>name<\/key><string>([^<]+)<\/string>/g)]
  .map(([, capture, scope]) => [Number(capture), scope]);

test('highlights portrait emotion separately from the speaker', function checkPortraitEmotionScopes() {
  assert.deepEqual(scopes, [
    [1, 'storage.type.function.rpgscript'],
    [2, 'keyword.operator.assignment.rpgscript'],
    [3, 'variable.parameter.rpgscript'],
    [4, 'storage.type.function.rpgscript'],
  ]);
  for (const prefix of ['', '  ', '\t']) {
    for (const actor of ['Eva', 'John Doe']) {
      const line = `${prefix}${actor}&happy: "Hello & goodbye"`;
      assert.deepEqual(pattern.exec(line)?.slice(1), [actor, '&', 'happy', ':']);
    }
  }
});

test('does not treat ampersands in dialogue text or comments as portrait emotions', function checkNonEmotionLines() {
  for (const line of ['Eva: "Hello & goodbye"', '// Eva&happy: "Hello"', '+log("Eva&happy: Hello")']) {
    assert.equal(pattern.test(line), false);
  }
  const fallbackIndex = grammar.indexOf('<string>((^(\\s)*[\\w\\x{0020}\\x{0026}]*:)');
  assert.ok(grammar.indexOf(rule[0]) < fallbackIndex, 'Emotion captures must precede the speaker fallback');
});
