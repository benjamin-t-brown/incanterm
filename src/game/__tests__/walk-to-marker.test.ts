import { expect, it } from 'vitest';
import { Character } from '../character.js';
import { PlayerControl } from '../player-control.js';
import { ScriptRunner, parseRpgScript } from '../rpgscript/runtime.js';
import { commands } from '../scene-commands.js';
import { Scene } from '../scene.js';
import { Sprite } from '../sprite.js';

const ink = { ch: '@', fg: { r: 255, g: 255, b: 255 }, bg: { r: 0, g: 0, b: 0 } };

function createMarkerRunner(source: string, scriptName?: string) {
  const sprite = new Sprite('actor', 1, 1, 0, 0, [ink]);
  const hero = new Character('hero', 0, 1, 0, sprite, 'actor', 'Player', 'idle', 'right', 100,
    new Map(), undefined, scriptName);
  const scene = new Scene('room', 7, 4, 'regular-z', ink, [hero], [], new Set(), [], [], [
    { id: 'marker-1', name: 'Exit', x: 4, y: 1 },
  ]);
  const control = new PlayerControl(scene);
  control.setPlayerWalkCh('hero');
  const runner = new ScriptRunner(parseRpgScript(source, 'marker.rpgscript', { commands }), {
    commands, context: { scene, playerControl: control },
  });
  return { hero, scene, control, runner };
}

it('waits for arrival before executing subsequent commands and ignores player clicks', () => {
  const { hero, scene, control, runner } = createMarkerRunner(
    '@start\n+walkToMarker(hero, Exit)\n+setStorage(arrived, true)',
  );
  runner.start('start');
  expect(runner.isIdle()).toBe(false);
  expect(runner.getStorage('arrived')).toBeUndefined();
  control.click(0, 3, () => false);
  scene.update(100);
  control.update();
  runner.update();
  expect(hero.x).toBe(2);
  expect(runner.getStorage('arrived')).toBeUndefined();
  control.click(0, 3, () => false);
  scene.update(100);
  control.update();
  runner.update();
  expect(hero.x).toBe(4);
  expect(runner.getStorage('arrived')).toBe(true);
  expect(runner.isIdle()).toBe(true);
});

it('accepts a character scene script name in walkToMarker', () => {
  const { hero, scene, control, runner } = createMarkerRunner(
    '@start\n+walkToMarker(SceneHero, Exit)', 'SceneHero');
  control.setPlayerWalkCh('SceneHero');
  runner.start('start');
  scene.update(200);
  control.update();
  runner.update();
  expect(hero.x).toBe(4);
  expect(runner.isIdle()).toBe(true);
});

it('skipWait continues immediately but protects the walk until arrival', () => {
  const { hero, scene, control, runner } = createMarkerRunner(
    '@start(who, marker)\n+walkToMarker([who], [marker], true)\n+setStorage(started, true)',
  );
  runner.start('start', ['hero', 'Exit']);
  expect(runner.isIdle()).toBe(true);
  expect(runner.getStorage('started')).toBe(true);
  control.click(0, 3, () => false);
  scene.update(200);
  control.update();
  expect(hero).toMatchObject({ x: 4, y: 1 });
  control.click(0, 3, () => false);
  expect(hero.isWalking()).toBe(true);
});

it.each([
  ['walkToMarker(hero, Unknown)', 'has no marker Unknown'],
  ['walkToMarker(missing, Exit)', 'no character missing'],
  ['walkToMarker(hero, Exit, maybe)', 'skipWait must be a boolean'],
])('rejects invalid marker walks: %s', (command, error) => {
  const { runner } = createMarkerRunner(`@start\n+${command}`);
  expect(() => runner.start('start')).toThrow(error);
});

it('rejects an unreachable marker instead of waiting forever', () => {
  const { scene, runner } = createMarkerRunner('@start\n+walkToMarker(hero, Exit)');
  for (let y = 0; y < scene.height; y++) (scene.blockedCells as Set<number>).add(y * scene.width + 2);
  expect(() => runner.start('start')).toThrow('unreachable');
});

it('still reports a walk interrupted outside a conversation', () => {
  const { hero, control, runner } = createMarkerRunner('@start\n+walkToMarker(hero, Exit)');
  runner.start('start');
  hero.stopWalking();
  expect(() => runner.update()).toThrow('interrupted before arrival');
  expect(control.isWalkPausedForConversation(hero, { x: 4, y: 1 })).toBe(false);
});

it('logs a scene command failure and continues with the next step when recovery is enabled', () => {
  const { scene, control } = createMarkerRunner('@start\n+walkToMarker(hero, Exit)');
  const errors: string[] = [];
  const runner = new ScriptRunner(parseRpgScript(
    '@start\n+walkToMarker(hero, WrongName)\n+setStorage(continued, true)',
    'marker.rpgscript', { commands },
  ), {
    commands,
    context: { scene, playerControl: control },
    onCommandError: (error, location) => errors.push(`${location}: ${String(error)}`),
  });
  runner.start('start');
  expect(runner.isIdle()).toBe(true);
  expect(runner.getStorage('continued')).toBe(true);
  expect(errors).toHaveLength(1);
  expect(errors[0]).toContain('marker.rpgscript:2 (+walkToMarker)');
  expect(errors[0]).toContain('has no marker WrongName');
});
