import { expect, it } from 'vitest';
import { Character } from '../character.js';
import { PlayerControl } from '../player-control.js';
import { parseRpgScript, ScriptRunner } from '../rpgscript/runtime.js';
import { commands } from '../scene-commands.js';
import { Scene } from '../scene.js';
import { Sprite } from '../sprite.js';

const ink = { ch: '@', fg: { r: 255, g: 255, b: 255 }, bg: { r: 0, g: 0, b: 0 } };

function createLookRunner(source: string) {
  const sprite = new Sprite('body', 1, 1, 0, 0, [ink]);
  const hero = new Character('hero', 2, 2, 0, sprite, 'hero-asset', 'Hero', 'idle', 'down', 100);
  const npc = new Character('npc', 5, 2, 0, sprite, 'npc-asset', 'Npc', 'idle', 'left', 100);
  const scene = new Scene('room', 8, 6, 'regular-z', ink, [hero, npc], [], new Set(), [], [], [
    { id: 'marker-1', name: 'Above', x: 2, y: 0 },
    { id: 'marker-2', name: 'Below', x: 2, y: 5 },
  ]);
  const control = new PlayerControl(scene);
  control.setPlayerWalkCh('hero');
  const runner = new ScriptRunner(parseRpgScript(source, 'look.rpgscript', { commands }), {
    commands, context: { scene, playerControl: control },
  });
  return { hero, npc, runner };
}

it.each([
  ['lookAtCh(hero, Npc)', 'right'],
  ['lookAtMarker(hero, Above)', 'up'],
  ['lookAtMarker(hero, Below)', 'down'],
] as const)('%s faces %s', (command, facing) => {
  const { hero, runner } = createLookRunner(`@start\n+${command}`);
  runner.start('start');
  expect(hero.facing).toBe(facing);
  expect(runner.isIdle()).toBe(true);
});

it('leaves facing unchanged when the target is on the same cell', () => {
  const { hero, runner } = createLookRunner('@start\n+lookAtCh(hero, Hero)');
  hero.facing = 'left';
  runner.start('start');
  expect(hero.facing).toBe('left');
});

it.each([
  ['lookAtCh(missing, Npc)', 'no character missing'],
  ['lookAtCh(hero, missing)', 'no character missing'],
  ['lookAtMarker(hero, Unknown)', 'has no marker Unknown'],
  ['lookAtMarker(missing, Above)', 'no character missing'],
])('rejects invalid look requests: %s', (command, error) => {
  const { runner } = createLookRunner(`@start\n+${command}`);
  expect(() => runner.start('start')).toThrow(error);
});
