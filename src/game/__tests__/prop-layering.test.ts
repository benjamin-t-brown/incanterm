import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { createAnimation, createProp, createScene } from '../../editor/schema.js';
import { AnimatedProp } from '../animated-prop.js';
import { Character } from '../character.js';
import { loadScene } from '../load-scene.js';
import { PlayerControl } from '../player-control.js';
import { parseRpgScript, ScriptRunner } from '../rpgscript/runtime.js';
import { commands } from '../scene-commands.js';
import { Background, Prop, Scene, renderView } from '../scene.js';
import { compareSceneDrawRank, type DepthMode } from '../scene-order.js';
import { Sprite } from '../sprite.js';

const ink = { ch: ' ', fg: { r: 255, g: 255, b: 255 }, bg: { r: 0, g: 0, b: 0 } };

function createGlyph(id: string): Sprite {
  return new Sprite(id, 1, 1, 0, 0, [{ ...ink, ch: id }]);
}

it('draws foreground after normal entities, with depth and stable ties within the layer', () => {
  const ranks = [
    { id: 'front-tie', background: false, foreground: true, depth: -10, order: 3 },
    { id: 'normal', background: false, depth: 1000, order: 0 },
    { id: 'front-far', background: false, foreground: true, depth: -20, order: 4 },
    { id: 'background', background: true, depth: 2000, order: 2 },
    { id: 'front', background: false, foreground: true, depth: -10, order: 1 },
  ];
  expect(ranks.sort(compareSceneDrawRank).map(({ id }) => id)).toEqual([
    'background',
    'normal',
    'front-far',
    'front',
    'front-tie',
  ]);
});

it.each<DepthMode>(['bottom-up', 'regular-z'])(
  'keeps foreground props above backgrounds, props and characters in %s',
  (mode) => {
    const scene = new Scene('layers', 1, 1, mode, ink, [
      new Prop('foreground', 0, 0, -1024, -1000, createGlyph('F'), true),
      new Prop('normal', 0, 0, 1024, 1000, createGlyph('N')),
      new Character('actor', 0, 0, 1000, createGlyph('C'), 'actor', undefined, 'idle', 'down'),
      new Background('background', 0, 0, 2000, 1000, createGlyph('B')),
    ]);
    expect(renderView(scene, 1, 1).get(0, 0).ch).toBe('F');
  },
);

it('can draw a character in front of shelf art and restore their normal depth from RPGScript', () => {
  const actor = new Character('hero', 0, 0, 0, createGlyph('H'), 'hero', undefined, 'idle', 'down');
  const shelf = new Prop('shelf', 0, 0, 1, 0, createGlyph('S'));
  const scene = new Scene('climb-layers', 1, 1, 'bottom-up', ink, [actor, shelf]);
  const playerControl = new PlayerControl(scene);
  playerControl.setPlayerWalkCh(actor.id);
  const script = parseRpgScript(
    '@raise\n+setChForeground(player, true)\n@restore\n+setChForeground(player, false)',
    'climb-layers.rpgscript',
    { commands },
  );
  const runner = new ScriptRunner(script, { commands, context: { scene, playerControl } });
  expect(renderView(scene, 1, 1).get(0, 0).ch).toBe('S');
  runner.start('raise');
  expect(renderView(scene, 1, 1).get(0, 0).ch).toBe('H');
  runner.start('restore');
  expect(renderView(scene, 1, 1).get(0, 0).ch).toBe('S');
});

it.each([
  ['sprite', 'bottom-up'],
  ['sprite', 'regular-z'],
  ['animation', 'bottom-up'],
  ['animation', 'regular-z'],
] as const)('loads independent %s instance offsets in %s', async (visualType, depthMode) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'incanterm-prop-layering-'));
  try {
    async function writeAsset(folder: string, id: string, value: unknown): Promise<void> {
      await fs.mkdir(path.join(root, folder), { recursive: true });
      await fs.writeFile(path.join(root, folder, `${id}.json`), JSON.stringify(value));
    }
    await writeAsset('sprites', 'overlay-art', {
      format: 'incanterm-sprite',
      version: 1,
      id: 'overlay-art',
      width: 1,
      height: 1,
      originX: 0,
      originY: 0,
      cells: [{ ch: 'F', fg: '#ffffff', bg: '#000000' }],
    });
    const animation = createAnimation('overlay-clip');
    animation.frames = [{ sprite: 'overlay-art', index: 0, durationMs: 100 }];
    await writeAsset('animations', animation.id, animation);
    const prop = createProp(
      'overlay',
      visualType === 'sprite'
        ? { type: 'sprite', id: 'overlay-art', index: 0 }
        : { type: 'animation', id: animation.id },
    );
    prop.groundOffsetY = 3;
    prop.depthOffset = 50;
    const document = createScene('layers', undefined, 2, 1, depthMode);
    for (const foreground of [false, true]) {
      await writeAsset('props', prop.id, { ...prop, foreground });
      for (const depthOffset of [-10, 0, 10]) {
        document.entities = [
          { id: 'first', type: 'Prop', prop: prop.id, x: 0, y: 0, z: 2, depthOffset },
          {
            id: 'second',
            type: 'Prop',
            prop: prop.id,
            x: 1,
            y: 0,
            z: 2,
            depthOffset: -depthOffset,
          },
        ];
        await writeAsset('scenes', document.id, document);
        const scene = await loadScene(root, document.id);
        const loaded = scene.entities[0];
        expect(loaded).toBeInstanceOf(AnimatedProp);
        if (!(loaded instanceof AnimatedProp)) throw new Error('Expected reusable prop');
        const expectedDepth = depthOffset + (depthMode === 'bottom-up' ? 3 : 2);
        expect(loaded.getDepth(depthMode)).toBe(expectedDepth);
        expect(scene.entities[1].getDepth(depthMode)).toBe(
          -depthOffset + (depthMode === 'bottom-up' ? 3 : 2),
        );
        expect(loaded.clone()).toMatchObject({ foreground, z: 2, depthOffset: loaded.depthOffset });
        scene.entities.push(new Prop('normal', 0, 0, 0, 0, createGlyph('N')));
        scene.entities.push(new Prop('other', 1, 0, 0, 0, createGlyph('N')));
        const frame = renderView(scene, 2, 1);
        expect(frame.get(0, 0).ch).toBe(foreground || depthOffset >= 0 ? 'F' : 'N');
        expect(frame.get(1, 0).ch).toBe(foreground || depthOffset <= 0 ? 'F' : 'N');
      }
    }
    document.entities = [{ id: 'legacy', type: 'Prop', prop: prop.id, x: 0, y: 0, z: 2 }];
    await writeAsset('props', prop.id, { ...prop, depthOffset: 50 });
    await writeAsset('scenes', document.id, document);
    const legacy = await loadScene(root, document.id);
    expect(legacy.entities[0].getDepth(depthMode)).toBe(50 + (depthMode === 'bottom-up' ? 3 : 2));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
