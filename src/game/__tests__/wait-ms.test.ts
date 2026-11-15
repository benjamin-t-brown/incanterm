import { afterEach, expect, it, vi } from 'vitest';
import { Character, type CharacterClip } from '../character.js';
import { PlayerControl } from '../player-control.js';
import { parseRpgScript, ScriptRunner } from '../rpgscript/runtime.js';
import { commands } from '../scene-commands.js';
import { Scene } from '../scene.js';
import { Sprite } from '../sprite.js';

afterEach(() => {
  vi.useRealTimers();
});

function createWaitRunner(source: string) {
  const ink = { ch: '.', fg: { r: 255, g: 255, b: 255 }, bg: { r: 0, g: 0, b: 0 } };
  const sprite = new Sprite('body', 1, 1, 0, 0, [ink]);
  const clips = new Map<string, CharacterClip>(
    (['up', 'down', 'left', 'right'] as const).flatMap((direction): [string, CharacterClip][] => [
      [`idle-${direction}`, { frames: [{ sprite, durationMs: 50 }], loop: true }],
      [`walk-${direction}`, { frames: [{ sprite, durationMs: 50 }], loop: true }],
    ]),
  );
  const hero = new Character('hero', 1, 1, 0, sprite, 'actor', 'Hero', 'idle', 'down', 100, clips);
  const scene = new Scene('room', 8, 4, 'regular-z', ink, [hero]);
  const control = new PlayerControl(scene);
  control.setPlayerWalkCh('hero');
  const storage = new Map<string, unknown>();
  const runner = new ScriptRunner(parseRpgScript(source, 'wait.rpgscript', { commands }), {
    commands,
    context: { scene, playerControl: control },
  });
  runner.storage = storage;
  return { runner, storage };
}

it('waits the requested milliseconds before continuing', () => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000);
  const { runner, storage } = createWaitRunner('@start\n+waitMs(33)\n+done=true');
  runner.start('start');
  expect(storage.get('global.done')).toBeUndefined();
  expect(runner.isIdle()).toBe(false);
  vi.setSystemTime(1_032);
  runner.update();
  expect(storage.get('global.done')).toBeUndefined();
  vi.setSystemTime(1_033);
  runner.update();
  expect(storage.get('global.done')).toBe(true);
  expect(runner.isIdle()).toBe(true);
});

it('rejects invalid wait durations', () => {
  const { runner } = createWaitRunner('@start\n+waitMs(-1)');
  expect(() => runner.start('start')).toThrow('waitMs requires a non-negative number of milliseconds');
});
