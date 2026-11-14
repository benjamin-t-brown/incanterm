import { expect, it } from 'vitest';
import { Character } from '../character.js';
import { PlayerControl } from '../player-control.js';
import { parseRpgScript, ScriptRunner } from '../rpgscript/runtime.js';
import { commands } from '../scene-commands.js';
import { Scene } from '../scene.js';
import { Sprite } from '../sprite.js';

const ink = { ch: '@', fg: { r: 255, g: 255, b: 255 }, bg: { r: 0, g: 0, b: 0 } };

function createSpeedRunner(source: string) {
  const sprite = new Sprite('body', 1, 1, 0, 0, [ink]);
  const hero = new Character('hero', 0, 1, 0, sprite, 'hero-asset', 'Hero', 'idle', 'right', 100);
  const scene = new Scene('room', 8, 4, 'regular-z', ink, [hero], [], new Set(), [], [], [
    { id: 'marker-1', name: 'Exit', x: 4, y: 1 },
  ]);
  const control = new PlayerControl(scene);
  control.setPlayerWalkCh('hero');
  const runner = new ScriptRunner(parseRpgScript(source, 'speed.rpgscript', { commands }), {
    commands, context: { scene, playerControl: control },
  });
  return { hero, scene, runner };
}

it('speeds up walking by the given multiplier', () => {
  const { hero, scene, runner } = createSpeedRunner(
    '@start\n+setSpeedMult(hero, 2)\n+walkToMarker(hero, Exit, true)',
  );
  runner.start('start');
  expect(hero.speedMult).toBe(2);
  scene.update(50);
  expect(hero.x).toBe(2);
  scene.update(50);
  expect(hero.x).toBe(4);
  expect(hero.state).toBe('idle');
});

it('rejects non-positive multipliers', () => {
  const { runner } = createSpeedRunner('@start\n+setSpeedMult(hero, 0)');
  expect(() => runner.start('start')).toThrow('setSpeedMult requires a positive number');
});

it('rejects a missing character', () => {
  const { runner } = createSpeedRunner('@start\n+setSpeedMult(missing, 2)');
  expect(() => runner.start('start')).toThrow('no character missing');
});
