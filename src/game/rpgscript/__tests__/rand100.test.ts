import { afterEach, describe, expect, it, vi } from 'vitest';
import { commands, parseRpgScript, ScriptRunner } from './test-support.js';
import { sceneCommandsShim } from '../../scene-commands-shim.js';

describe('rand100 scene command', () => {
  afterEach(() => vi.restoreAllMocks());

  it('writes an integer from 1 through 100 to vars.rand100 on every call', () => {
    const random = vi.spyOn(Math, 'random').mockReturnValueOnce(0).mockReturnValueOnce(0.9999999999999999);
    const scripts = parseRpgScript('@roll\n+rand100()\nA: "Rolled {vars.rand100}"\n+rand100()', 'roll.rpgscript');
    const runner = new ScriptRunner(scripts);

    runner.start('roll');
    expect(runner.getStorage('vars.rand100')).toBe(1);
    expect(runner.dialogue?.text).toBe('Rolled 1');
    runner.advance();
    expect(runner.getStorage('vars.rand100')).toBe(100);
    expect(random).toHaveBeenCalledTimes(2);
    expect(sceneCommandsShim.rand100).toBe(commands.rand100);
  });

  it('requires no arguments', () => {
    expect(() => parseRpgScript('@roll\n+rand100(1)', 'roll.rpgscript')).toThrow(
      'roll.rpgscript:2: Command rand100 is not supported yet',
    );
  });
});
