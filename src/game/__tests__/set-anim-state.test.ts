import { expect, it } from 'vitest';
import { CellBuffer } from '../cell-buffer.js';
import { Character, type CharacterClip } from '../character.js';
import { PlayerControl } from '../player-control.js';
import { parseRpgScript, ScriptRunner } from '../rpgscript/runtime.js';
import { commands } from '../scene-commands.js';
import { Scene } from '../scene.js';
import { Sprite } from '../sprite.js';

function createAnimationRunner(source: string) {
  const ink = { ch: '.', fg: { r: 255, g: 255, b: 255 }, bg: { r: 0, g: 0, b: 0 } };
  const sprite = new Sprite('body', 1, 1, 0, 0, [ink]);
  const custom = new Sprite('dance', 1, 1, 0, 0, [{ ...ink, ch: 'D' }]);
  const clips = new Map<string, CharacterClip>([
    ...(['up', 'down', 'left', 'right'] as const).flatMap((direction): [string, CharacterClip][] => [
      [`idle-${direction}`, { frames: [{ sprite, durationMs: 50 }], loop: true }],
      [`walk-${direction}`, { frames: [{ sprite, durationMs: 50 }], loop: true }],
    ]),
    ['dance', { frames: [{ sprite: custom, durationMs: 50 }, { sprite, durationMs: 50 }], loop: true }],
  ]);
  const hero = new Character('hero', 1, 1, 0, sprite, 'actor', 'Hero', 'idle', 'down', 100, clips);
  const scene = new Scene('room', 8, 4, 'regular-z', ink, [hero]);
  const control = new PlayerControl(scene);
  control.setPlayerWalkCh('hero');
  const logs: string[] = [];
  const runner = new ScriptRunner(parseRpgScript(source, 'anim.rpgscript', { commands }), {
    commands, context: { scene, playerControl: control }, writeLog: (message) => logs.push(message),
  });
  return { hero, scene, runner, logs, ink };
}

it('sets a custom state independent of facing and resets its animation when changed', () => {
  const { hero, runner, ink } = createAnimationRunner(
    '@start(state)\n+setAnimState(player, [state])\nA: "Pause"\n+setAnimState(Hero, dance)',
  );
  runner.start('start', ['dance']);
  expect(hero.state).toBe('dance');
  hero.animate(75);
  hero.facing = 'left';
  hero.animate(0);
  const buffer = new CellBuffer(8, 4, ink);
  hero.draw(buffer, 0, 0);
  expect(buffer.get(1, 1).ch).toBe('.');
  runner.advance();
  hero.draw(buffer, 0, 0);
  expect(buffer.get(1, 1).ch).toBe('D');
});

it('replaces an active walk, and a later walk replaces the custom state', () => {
  const { hero, scene, runner } = createAnimationRunner('@start\n+setAnimState(hero, dance)');
  hero.walkTo(scene, { x: 5, y: 1 });
  expect(hero.isWalking()).toBe(true);
  runner.start('start');
  expect(hero.isWalking()).toBe(false);
  expect(hero.state).toBe('dance');
  hero.walkTo(scene, { x: 4, y: 1 });
  expect(hero.state).toBe('walk');
  hero.update(300, scene);
  expect(hero.state).toBe('idle');
});

it('logs a missing state and falls back to directional idle', () => {
  const { hero, runner, logs } = createAnimationRunner('@start\n+setAnimState(Hero, missing)');
  hero.state = 'dance';
  runner.start('start');
  expect(hero.state).toBe('idle');
  expect(logs).toEqual([
    '[RPGSCRIPT] setAnimState: character Hero has no animation state missing; using idle (anim.rpgscript:2)',
  ]);
  expect(runner.isIdle()).toBe(true);
});

it('rejects invalid state arguments', () => {
  const { runner } = createAnimationRunner('@start\n+setAnimState(hero, 3)');
  expect(() => runner.start('start')).toThrow('setAnimState requires an animation state name');
});
