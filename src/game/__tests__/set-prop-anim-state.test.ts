import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { createAnimation, createProp, createScene, createSprite } from '../../editor/schema.js';
import { AssetStore } from '../../editor/store.js';
import { AnimatedProp, type PropClip } from '../animated-prop.js';
import { loadScene } from '../load-scene.js';
import { PlayerControl } from '../player-control.js';
import { parseRpgScript, ScriptRunner } from '../rpgscript/runtime.js';
import { commands } from '../scene-commands.js';
import { renderView, Scene } from '../scene.js';
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

it('loads a starting sprite state and switches between sprite and animation states from scripts', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'incanterm-prop-states-'));
  try {
    const store = new AssetStore(root);
    const sheet = createSprite('door-art', 1, 1);
    sheet.sprites = ['D', 'S', 'A'].map((ch) => {
      const frame = structuredClone(sheet.sprites[0]);
      frame.layers[0].cells[0] = { ch, fg: 'white', bg: 'black' };
      return frame;
    });
    await store.saveSprite(sheet.id, sheet);
    const animation = createAnimation('door-opening');
    animation.frames = [2, 0].map((index) => ({ sprite: sheet.id, index, durationMs: 100 }));
    await store.saveAnimation(animation.id, animation);
    const prop = createProp('door', { type: 'sprite', id: sheet.id, index: 0 });
    prop.customAnimations = {
      open: { type: 'sprite', id: sheet.id, index: 1 },
      opening: animation.id,
    };
    await store.savePropDraft(prop.id, prop, null);
    expect(await store.readProp(prop.id)).toEqual(prop);
    const doc = createScene('room', undefined, 1, 1);
    doc.entities = [{ type: 'Prop', id: 'door', prop: prop.id, x: 0, y: 0, z: 0, state: 'open' }];
    await store.saveSceneDraft(doc.id, doc, null);
    const scene = await loadScene(root, doc.id);
    const door = scene.entities[0];
    if (!(door instanceof AnimatedProp)) throw new Error('Expected a reusable prop');
    const script = parseRpgScript(
      '@animate\n+setPropAnimState(door, opening)\n@open\n+setPropAnimState(door, open)\n@reset\n+setPropAnimState(door, default)',
      'door.rpgscript',
      { commands },
    );
    const runner = new ScriptRunner(script, {
      commands,
      context: { scene, playerControl: new PlayerControl(scene) },
    });
    const getGlyph = () => renderView(scene, 1, 1).get(0, 0).ch;
    expect(getGlyph()).toBe('S');
    door.update(2500);
    expect(getGlyph()).toBe('S');
    runner.start('animate');
    expect(getGlyph()).toBe('A');
    door.update(100);
    expect(getGlyph()).toBe('D');
    runner.start('open');
    expect(getGlyph()).toBe('S');
    runner.start('reset');
    expect(getGlyph()).toBe('D');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
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
