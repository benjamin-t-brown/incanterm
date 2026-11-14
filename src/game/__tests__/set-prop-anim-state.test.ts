import { expect, it } from 'vitest';
import { AnimatedProp, type PropClip } from '../animated-prop.js';
import { PlayerControl } from '../player-control.js';
import { parseRpgScript, ScriptRunner } from '../rpgscript/runtime.js';
import { commands } from '../scene-commands.js';
import { Scene } from '../scene.js';
import { Sprite } from '../sprite.js';

function createPropRunner(source: string) {
  const ink = { ch: '.', fg: { r: 255, g: 255, b: 255 }, bg: { r: 0, g: 0, b: 0 } };
  const idle = new Sprite('idle', 1, 1, 0, 0, [ink]);
  const open = new Sprite('open', 1, 1, 0, 0, [{ ...ink, ch: 'O' }]);
  const clips = new Map<string, PropClip>([
    ['default', { frames: [{ sprite: idle, durationMs: 50 }], loop: true }],
    ['open', { frames: [{ sprite: open, durationMs: 50 }], loop: true }],
  ]);
  const left = new AnimatedProp('vend-1', 1, 1, 0, 0, idle, clips, 'default', 'vend_energy_1', 'vend_energy');
  const right = new AnimatedProp('vend-2', 3, 1, 0, 0, idle, clips, 'default', 'vend_energy_1', 'vend_energy');
  const scene = new Scene('room', 8, 4, 'regular-z', ink, [left, right]);
  const control = new PlayerControl(scene);
  const logs: string[] = [];
  const runner = new ScriptRunner(parseRpgScript(source, 'prop-anim.rpgscript', { commands }), {
    commands,
    context: { scene, playerControl: control },
    writeLog: (message) => logs.push(message),
  });
  return { left, right, runner, logs };
}

it('sets the animation state on every prop that shares the instance name', () => {
  const { left, right, runner } = createPropRunner('@start\n+setPropAnimState(vend_energy_1, open)');
  runner.start('start');
  expect(left.state).toBe('open');
  expect(right.state).toBe('open');
});

it('logs a missing state and falls back to default on each match', () => {
  const { left, right, runner, logs } = createPropRunner(
    '@start\n+setPropAnimState(vend_energy_1, missing)',
  );
  left.state = 'open';
  right.state = 'open';
  runner.start('start');
  expect(left.state).toBe('default');
  expect(right.state).toBe('default');
  expect(logs).toEqual([
    '[RPGSCRIPT] setPropAnimState: prop vend_energy_1 has no animation state missing; using default (prop-anim.rpgscript:2)',
    '[RPGSCRIPT] setPropAnimState: prop vend_energy_1 has no animation state missing; using default (prop-anim.rpgscript:2)',
  ]);
});

it('rejects invalid state arguments', () => {
  const { runner } = createPropRunner('@start\n+setPropAnimState(vend_energy_1, 3)');
  expect(() => runner.start('start')).toThrow('setPropAnimState requires an animation state name');
});

it('throws when no prop matches the instance name', () => {
  const { runner } = createPropRunner('@start\n+setPropAnimState(missing, open)');
  expect(() => runner.start('start')).toThrow('Scene room has no prop missing');
});
