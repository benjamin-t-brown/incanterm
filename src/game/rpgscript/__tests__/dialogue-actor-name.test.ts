import { describe, expect, it } from 'vitest';
import { parseRpgScript, ScriptRunner } from './test-support.js';

describe('RPGScript dialogue actor names', () => {
  it('parses a title with a period as a dialogue actor', () => {
    const scripts = parseRpgScript('@start\nMr. Ralgo: "Hello"', 'example.rpgscript');
    const runner = new ScriptRunner(scripts);
    runner.start('start');
    expect(runner.dialogue).toEqual({ actor: 'Mr. Ralgo', text: 'Hello' });
  });

  it('parses spaced speaker names inside a braced conditional', () => {
    const scripts = parseRpgScript(
      '@start\n+setStorage(flag, 0)\n+?eq(flag, 0):{\n  Mr Ralgo: "You are the current class liaison, right?"\n}',
      'example.rpgscript',
    );
    const runner = new ScriptRunner(scripts);
    runner.start('start');
    expect(runner.dialogue).toEqual({
      actor: 'Mr Ralgo',
      text: 'You are the current class liaison, right?',
    });
  });

  it('parses spaced speaker names in inline conditions and prefixed commands', () => {
    const scripts = parseRpgScript(
      '@start\n+setStorage(flag, 0)\n+?eq(flag, 0):Mr Ralgo: "First"\n+Mr Ralgo: "Second"',
      'example.rpgscript',
    );
    const runner = new ScriptRunner(scripts);
    runner.start('start');
    expect(runner.dialogue).toEqual({ actor: 'Mr Ralgo', text: 'First' });
    runner.advance();
    expect(runner.dialogue).toEqual({ actor: 'Mr Ralgo', text: 'Second' });
  });
});
