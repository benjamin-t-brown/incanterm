import { expect, it } from 'vitest';
import { ScriptParser } from '../parser.js';
import { assignMissingVoiceIds } from '../voice-ids.js';

it('assigns once per requested dialogue occurrence without touching other markers or whitespace', () => {
  const lines = ['@intro', '  +?is(ready):{', `    Pilot&happy: 'Say "// voice".' // voice  `, '  }',
    'Pilot: "No recording." // no-voice', 'Pilot: "Keep ID" // voice v_existing',
    'Pilot: "// voice"', '// Pilot: "comment" // voice', '$', 'Leave:other // voice'];
  const source = lines.join('\n');
  const assigned = assignMissingVoiceIds(source, 'intro', () => 'v_unique');
  expect(assigned).toBe(source.replace('// voice  \n', '// voice v_unique  \n'));
  expect(assignMissingVoiceIds(assigned, 'intro', () => { throw new Error('Unexpected allocation'); })).toBe(assigned);
  const command = new ScriptParser('intro').parse(assigned).scripts.intro.blocks.flatMap(b => b.commands).find(c => c.i === 3);
  expect(command?.args).toEqual(['Pilot', 'Say "// voice".', 'happy', 'v_unique']);
});

it('never invents playback IDs or silently drops malformed metadata', () => {
  const parse = (suffix: string) => new ScriptParser('intro').parse(`@intro\nPilot: "Landing." // ${suffix}`);
  expect(() => parse('voice')).toThrow(/intro:2: Voice request needs an ID/);
  expect(() => parse('voice v_one v_two')).toThrow(/intro:2: Expected a single voice line ID/);
});
