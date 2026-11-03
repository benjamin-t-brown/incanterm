import { describe, expect, it } from 'vitest';
import { defineCommand } from '../command.js';
import type { ScriptValue } from '../parser.js';
import { parseRpgScript, ScriptRunner } from '../runtime.js';

describe('game-supplied command registries', () => {
  const record = defineCommand({
    parse: (args) => {
      if (args.length === 1) return { value: args[0] as ScriptValue };
    },
    execute: (step, script, values: unknown[]) => values.push(script.value(step.value)),
  });

  it('runs a custom game command with session-bound implementations over shared scripts', () => {
    const scripts = parseRpgScript('@start(who)\n+record([who])', 'custom.rpgscript', {
      commands: { record },
    });
    const firstValues: unknown[] = [];
    const secondValues: unknown[] = [];
    const first = new ScriptRunner(scripts, {
      commands: { record },
      context: firstValues,
    });
    const second = new ScriptRunner(scripts, {
      commands: { record },
      context: secondValues,
    });
    first.start('start', ['hero']);
    second.start('start', ['villain']);
    first.start('start', ['friend']);
    expect(firstValues).toEqual(['hero', 'friend']);
    expect(secondValues).toEqual(['villain']);
    expect(first.isIdle()).toBe(true);
    expect(second.isIdle()).toBe(true);
  });

  it('uses the supplied registry for validation and reports missing runtime implementations', () => {
    expect(() =>
      parseRpgScript('@start\n+log("hello")', 'custom.rpgscript', {
        commands: { record },
      }),
    ).toThrow('custom.rpgscript:2: Unknown command log');
    expect(() =>
      parseRpgScript('@start\n+record()', 'custom.rpgscript', {
        commands: { record },
      }),
    ).toThrow('custom.rpgscript:2: Command record is not supported yet');
    const scripts = parseRpgScript('@start\n+record("hello")', 'custom.rpgscript', {
      commands: { record },
    });
    expect(() => new ScriptRunner(scripts, { commands: {}, context: [] }).start('start')).toThrow(
      'custom.rpgscript:2: Unknown command record',
    );
  });
});
