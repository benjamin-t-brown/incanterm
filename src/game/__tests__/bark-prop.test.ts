import { expect, it, vi } from 'vitest';
import { Character } from '../character.js';
import { PlayerControl } from '../player-control.js';
import { parseRpgScript, ScriptRunner } from '../rpgscript/runtime.js';
import { Prop, Scene } from '../scene.js';
import { commands } from '../scene-commands.js';
import { Sprite } from '../sprite.js';

function createBarkRunner(body: string) {
  const black = { r: 0, g: 0, b: 0 };
  const cell = { ch: '.', fg: black, bg: black };
  const sprite = new Sprite('test', 1, 1, 0, 0, [cell]);
  const speaker = new Prop('speaker-1', 2, 2, 0, 0, sprite, false, 'Speaker');
  const firstCrate = new Prop('crate-1', 3, 2, 0, 0, sprite, false, 'Crate');
  const secondCrate = new Prop('crate-2', 4, 2, 0, 0, sprite, false, 'Crate');
  const character = new Character('npc', 5, 2, 0, sprite, 'npc', 'Speaker', 'idle', 'down');
  const scene = new Scene('room', 8, 6, 'regular-z', cell, [speaker, firstCrate, secondCrate, character]);
  const scripts = parseRpgScript(`@start\n${body}`, 'barks.rpgscript', { commands });
  const complete = vi.fn(() => false);
  const showBark = vi.fn((_target: Prop, _text: string, _ms: number) => complete);
  const runner = new ScriptRunner(scripts, {
    commands,
    context: { scene, playerControl: new PlayerControl(scene), bark: showBark },
  });
  return { runner, showBark, complete, speaker, secondCrate, character };
}

it('finds the prop by name and waits for its bark to finish by default', () => {
  const { runner, showBark, complete, speaker } = createBarkRunner(`
    +barkProp(sPEAKER, "Beep")
    +continued=true
  `);
  runner.start('start');
  expect(showBark).toHaveBeenCalledExactlyOnceWith(speaker, 'Beep', 2000);
  runner.update();
  expect(runner.getGlobal('continued')).toBeUndefined();
  complete.mockReturnValue(true);
  runner.update();
  expect(runner.getGlobal('continued')).toBe(true);
});

it('supports nonblocking prop and character barks without confusing their targets', () => {
  const { runner, showBark, secondCrate, character } = createBarkRunner(`
    +barkProp(CRATE-2, "Rattle", 350, true)
    +bark(Speaker, "Hello", 700, true)
    +continued=true
  `);
  runner.start('start');
  expect(showBark.mock.calls).toEqual([[secondCrate, 'Rattle', 350], [character, 'Hello', 700]]);
  expect(runner.getGlobal('continued')).toBe(true);
});

it.each([
  ['crate', 'prop crate is ambiguous; use an instance ID'],
  ['npc', 'has no prop npc'],
])('rejects a prop reference that does not identify one prop: %s', (reference, message) => {
  const { runner, showBark } = createBarkRunner(`+barkProp(${reference}, "Beep")`);
  expect(() => runner.start('start')).toThrow(message);
  expect(showBark).not.toHaveBeenCalled();
});
