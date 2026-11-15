import { afterEach, describe, expect, it, vi } from 'vitest';
import { PlayerControl } from '../../player-control.js';
import { Scene } from '../../scene.js';
import { commands } from '../../scene-commands.js';
import { parseRpgScript, ScriptRunner } from '../runtime.js';

describe('character timer script results', () => {
  afterEach(() => vi.restoreAllMocks());

  it.each([0.5, 0.999])('passes the returned random number to lt for %s', (random) => {
    vi.spyOn(Math, 'random').mockReturnValue(random);
    const scripts = parseRpgScript(`#classroom1Update
timer,classroom1Updater,Ralgo,2000
@classroom1Updater(ch)
  +?is(classroom1.enableRalgoMove):{
    +[shouldRalgoMove]<+:rand()
    +?lt([shouldRalgoMove], 100):{
      +result="move"
    }
  }
@rand
  +rand100()
  <{vars.rand100}`, 'timer.rpgscript', { commands });
    const scene = new Scene('room', 1, 1, 'regular-z', {
      ch: ' ', fg: { r: 255, g: 255, b: 255 }, bg: { r: 0, g: 0, b: 0 },
    }, []);
    const errors: unknown[] = [];
    const runner = new ScriptRunner(scripts, {
      commands,
      context: { scene, playerControl: new PlayerControl(scene) },
      getCharacterId: () => 'ralgo',
      onCommandError: (error) => errors.push(error),
    });
    runner.restartTimers(['classroom1Update']);
    runner.updateTimers(2000);
    expect(errors).toEqual([]);
    expect(runner.getGlobal('vars.rand100')).toBeUndefined();
    runner.setGlobal('classroom1.enableRalgoMove', true);
    for (let index = 0; index < 10; index++) runner.updateTimers(2000);

    expect(errors).toEqual([]);
    expect(runner.getGlobal('vars.rand100')).toBe(Math.floor(random * 100) + 1);
    expect(runner.getGlobal('result')).toBe(random < 0.99 ? 'move' : undefined);
  });
});
