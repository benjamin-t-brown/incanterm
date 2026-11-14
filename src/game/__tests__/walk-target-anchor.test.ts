import { expect, it } from 'vitest';
import { Character } from '../character.js';
import { PlayerControl } from '../player-control.js';
import { ScriptRunner, parseRpgScript } from '../rpgscript/runtime.js';
import { commands } from '../scene-commands.js';
import { Scene, type DepthMode } from '../scene.js';
import { Sprite } from '../sprite.js';

const ink = { ch: '@', fg: { r: 255, g: 255, b: 255 }, bg: { r: 0, g: 0, b: 0 } };

function createWalkRunner(command: string, mode: DepthMode, width = 3, originX = 0) {
  const sprite = new Sprite('actor', width, 3, originX, 0, Array(width * 3).fill(ink));
  const hero = new Character('hero', 3, 3, 0, sprite, 'actor', undefined, 'idle', 'up', 100);
  // A three-cell doorway centered on x=4: the marker itself is clear, but x=6 is blocked.
  const scene = new Scene('room', 10, 8, mode, ink, [hero], [], new Set([22, 26]), [], [], [
    { id: 'door', name: 'Door', x: 4, y: 2 },
  ]);
  const control = new PlayerControl(scene);
  const runner = new ScriptRunner(parseRpgScript(`@start\n+${command}\n+setStorage(arrived, true)`, 'anchor.rpgscript', { commands }), {
    commands, context: { scene, playerControl: control },
  });
  return { hero, scene, runner };
}

it.each(['walkToMarker(hero, Door)', 'chWalkToCoord(hero, 4, 2)'])(
  'targets the bottom center in bottom-up scenes: %s', (command) => {
    const { hero, scene, runner } = createWalkRunner(command, 'bottom-up');
    runner.start('start');
    scene.update(1000);
    runner.update();
    expect(hero.x).toBe(3);
    expect(hero.bottomY).toBe(2);
    expect(hero.isWalking()).toBe(false);
    expect(runner.getStorage('arrived')).toBe(true);
  },
);

it.each([[3, 1], [2, 0], [4, 2]])('accounts for width %s and origin %s', (width, originX) => {
  const { hero, scene, runner } = createWalkRunner('walkToMarker(hero, Door)', 'bottom-up', width, originX);
  (scene.blockedCells as Set<number>).clear();
  runner.start('start');
  scene.update(1000);
  runner.update();
  expect(hero.x - originX + Math.floor(width / 2)).toBe(4);
  expect(hero.bottomY).toBe(2);
  expect(runner.getStorage('arrived')).toBe(true);
});

it('keeps origin-column targeting in regular-z scenes', () => {
  const { hero, scene, runner } = createWalkRunner('walkToMarker(hero, Door)', 'regular-z');
  (scene.blockedCells as Set<number>).clear();
  runner.start('start');
  scene.update(1000);
  runner.update();
  expect(hero.x).toBe(4);
  expect(hero.bottomY).toBe(2);
  expect(runner.getStorage('arrived')).toBe(true);
});
