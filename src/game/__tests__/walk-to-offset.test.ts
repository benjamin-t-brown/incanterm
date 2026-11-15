import { expect, it, vi } from 'vitest';
import { Character } from '../character.js';
import { PlayerControl } from '../player-control.js';
import { ScriptRunner, parseRpgScript } from '../rpgscript/runtime.js';
import { commands } from '../scene-commands.js';
import { sceneCommandsShim } from '../scene-commands-shim.js';
import { Scene } from '../scene.js';
import { Sprite } from '../sprite.js';

const ink = { ch: '@', fg: { r: 255, g: 255, b: 255 }, bg: { r: 0, g: 0, b: 0 } };

function createOffsetRunner(source: string) {
  const hero = new Character('hero', 2, 2, 0,
    new Sprite('actor', 1, 1, 0, 0, [ink]), 'actor', 'Player', 'idle', 'right', 100, new Map());
  const scene = new Scene('room', 8, 5, 'regular-z', ink, [hero], [], new Set(), [], [], []);
  const control = new PlayerControl(scene);
  control.setPlayerWalkCh('hero');
  const runner = new ScriptRunner(parseRpgScript(source, 'offset.rpgscript', { commands }), {
    commands, context: { scene, playerControl: control },
  });
  return { hero, scene, control, runner };
}

it('walks relative to the character and waits for arrival', () => {
  const { hero, scene, control, runner } = createOffsetRunner(
    '@start(dx, dy)\n+walkToOffset(player, [dx], [dy])\n+setStorage(arrived, true)',
  );
  runner.start('start', [2, -1]);
  expect(runner.getGlobal('arrived')).toBeUndefined();
  control.click(0, 0, () => false);
  scene.update(200);
  control.update();
  runner.update();
  expect({ x: hero.x, y: hero.bottomY }).toEqual({ x: 4, y: 1 });
  expect(runner.getGlobal('arrived')).toBe(true);
});

it('skipWait continues while the walk remains protected from clicks', () => {
  const { hero, scene, control, runner } = createOffsetRunner(
    '@start\n+walkToOffset(hero, -2, 1, true)\n+setStorage(started, true)',
  );
  runner.start('start');
  expect(runner.getGlobal('started')).toBe(true);
  control.click(7, 4, () => false);
  scene.update(200);
  expect({ x: hero.x, y: hero.bottomY }).toEqual({ x: 0, y: 3 });
});

it('does nothing for zero offsets', () => {
  const { hero, runner } = createOffsetRunner('@start\n+walkToOffset(hero, 0, 0)');
  runner.start('start');
  expect(runner.isIdle()).toBe(true);
  expect(hero.isWalking()).toBe(false);
});

it.each([
  ['walkToOffset(hero, 1.5, 0)', 'requires integer offsets'],
  ['walkToOffset(hero, 1, nope)', 'requires integer offsets'],
  ['walkToOffset(hero, -3, 0)', 'outside the scene'],
  ['walkToOffset(missing, 1, 0)', 'no character missing'],
  ['walkToOffset(hero, 1, 0, maybe)', 'skipWait must be a boolean'],
])('rejects invalid offset walks: %s', (command, error) => {
  const { runner } = createOffsetRunner(`@start\n+${command}`);
  expect(() => runner.start('start')).toThrow(error);
});

it('retries unreachable destinations and interrupted walks without errors', () => {
  vi.useFakeTimers();
  try {
    const { scene, runner } = createOffsetRunner('@start\n+walkToOffset(hero, 2, 0)\n+setStorage(continued, true)');
    for (let y = 0; y < scene.height; y++) (scene.blockedCells as Set<number>).add(y * scene.width + 3);
    runner.start('start');
    for (let attempt = 0; attempt < 5; attempt++) {
      vi.advanceTimersByTime(100);
      runner.update();
    }
    expect(runner.getGlobal('continued')).toBe(true);

    const walk = createOffsetRunner('@start\n+walkToOffset(hero, 2, 0)\n+setStorage(continued, true)');
    walk.runner.start('start');
    walk.hero.stopWalking();
    walk.runner.update();
    vi.advanceTimersByTime(100);
    walk.runner.update();
    walk.scene.update(200);
    walk.runner.update();
    expect(walk.runner.getGlobal('continued')).toBe(true);
  } finally {
    vi.useRealTimers();
  }
});

it('validates offset arguments in terminal mode without a scene', () => {
  const runner = new ScriptRunner(parseRpgScript('@start\n+walkToOffset(hero, -1, 2, true)',
    'terminal.rpgscript', { commands: sceneCommandsShim }), { commands: sceneCommandsShim, context: {} });
  expect(() => runner.start('start')).not.toThrow();
  expect(runner.isIdle()).toBe(true);
});
