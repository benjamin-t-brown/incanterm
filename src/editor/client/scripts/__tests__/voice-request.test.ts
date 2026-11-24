import { expect, it } from 'vitest';
import { rewriteVoiceRequest, setSelectedVoiceRequests } from '../voice-request.js';

it('round trips literal shorthand to the same ID without disturbing surrounding lines', () => {
  const source = `@arrival\n  Survey Lead&happy: 'Dock (three), "now".'\n+endConv()`;
  const enabled = rewriteVoiceRequest(source, 2, true, () => 'v_test');
  expect(enabled).toBe(
    `@arrival\n  Survey Lead&happy: 'Dock (three), "now".' // voice v_test\n+endConv()`,
  );
  const disabled = rewriteVoiceRequest(enabled, 2, false);
  expect(disabled).toContain('// no-voice v_test');
  expect(rewriteVoiceRequest(disabled, 2, true)).toBe(enabled);
});

it.each([
  ['+playDialogue(Ada, "Wait")', '+playDialogue(Ada, "Wait", "", "v_id")'],
  [`  +playDialogue( 'Ada', 'Wait', sad );`, `  +playDialogue( 'Ada', 'Wait', sad, "v_id" );`],
])('adds an ID to %s and preserves the existing call', (input, expected) => {
  expect(rewriteVoiceRequest(`@start\n${input}`, 2, true, () => 'v_id')).toBe(
    `@start\n${expected}`,
  );
});

it('does not allocate an ID or change an untouched text-only line when turning off', () => {
  const source = '@intro\nAda: "No recording."';
  expect(
    rewriteVoiceRequest(source, 2, false, () => {
      throw new Error('unexpected allocation');
    }),
  ).toBe(source);
});

it.each([
  '+?is(ready):+playDialogue(Ada, "Wait")',
  'Ada: "Hi [name]"',
  '+playDialogue("{speaker}", "Hi")',
  '+playDialogue(Ada, "Hi") // leave this comment',
  '_Ada: "Not a regular dialogue"',
])('refuses a rewrite that could change meaning: %s', (line) => {
  expect(() => rewriteVoiceRequest(`@start\n${line}`, 2, true, () => 'v_id')).toThrow();
});

it('keeps numeric dialogue as text and completes an existing handwritten marker', () => {
  expect(rewriteVoiceRequest('@intro\nAda: "42" // voice', 2, true, () => 'v_test'))
    .toBe('@intro\nAda: "42" // voice v_test');
});

it('uses the full parser to distinguish dialogue from a choice label', () => {
  expect(() => rewriteVoiceRequest('@start\n$\nAda: "Not dialogue"', 3, true)).toThrow(/cursor/);
});

it('requests selected dialogue across commands and comments, preserving existing IDs and skipping substitutions', () => {
  const lines = ['@test', 'Pilot: "Before"', 'Pilot: "First"', '+waitMs(1)', '// note',
    'Pilot: "Again" // no-voice v_again', 'Pilot: "Already" // voice v_old',
    'Pilot: "Hello [name]"', 'Pilot: "Last"', 'Pilot: "After"'];
  let id = 0;
  const result = setSelectedVoiceRequests(lines.join('\n'), 3, 9, true, () => `v_new${++id}`);
  expect(result.count).toBe(3);
  expect(result.skipped.map(item => item.line)).toEqual([8]);
  lines[2] += ' // voice v_new1';
  lines[5] = 'Pilot: "Again" // voice v_again';
  lines[8] += ' // voice v_new2';
  expect(result.source).toBe(lines.join('\n'));
});
