import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { createAnimation, createProp, createScene } from '../../editor/schema.js';
import { AnimatedProp } from '../animated-prop.js';
import { loadScene } from '../load-scene.js';
import { renderView } from '../scene.js';
import { createSceneFixtureAssets } from './scene-fixture.js';

it.each([true, false])('plays loaded prop frames, flips and invisible frames (loop=%s)', async (loop) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'incanterm-prop-'));
  try {
    async function writeAsset(folder: string, id: string, value: unknown): Promise<void> {
      await fs.mkdir(path.join(root, folder), { recursive: true });
      await fs.writeFile(path.join(root, folder, `${id}.json`), JSON.stringify(value));
    }
    await writeAsset('sprites', 'body', {
      format: 'incanterm-sprite', version: 1, id: 'body',
      width: 2, height: 1, originX: 1, originY: 0,
      cells: [
        { ch: 'A', fg: '#ffffff', bg: '#000000' },
        { ch: 'B', fg: '#ffffff', bg: '#000000' },
      ],
    });
    await writeAsset('animations', 'blink', {
      ...createAnimation('blink'), loop, flipH: true,
      frames: [
        { invisible: true, durationMs: 20 },
        { sprite: 'body', index: 0, durationMs: 30 },
        { sprite: 'body', index: 0, durationMs: 50, flipH: true },
      ],
    });
    const prop = createProp('machine', { type: 'animation', id: 'blink' });
    prop.width = 2;
    prop.blockedCells = [0];
    await writeAsset('props', 'machine', prop);
    const document = createScene('room', undefined, 4, 2);
    document.entities = [{ id: 'machine', type: 'Prop', prop: 'machine', x: 1, y: 0, z: 0 }];
    await writeAsset('scenes', 'room', document);
    const scene = await loadScene(root, 'room');
    const machine = scene.entities[0];
    expect(machine).toBeInstanceOf(AnimatedProp);
    if (!(machine instanceof AnimatedProp)) throw new Error('Missing animated prop');
    expect(scene.blockedCells.has(0)).toBe(true);
    function getFrame(): string {
      const buffer = renderView(scene, 4, 2);
      return buffer.get(0, 0).ch + buffer.get(1, 0).ch;
    }
    expect(getFrame()).toBe('  ');
    scene.update(20);
    expect(getFrame()).toBe('BA');
    scene.update(30);
    expect(getFrame()).toBe('AB');
    scene.update(50);
    expect(getFrame()).toBe(loop ? '  ' : 'AB');
    const clone = machine.clone();
    clone.update(20);
    expect(getFrame()).toBe(loop ? '  ' : 'AB');
    const buffer = renderView(scene, 4, 2);
    clone.draw(buffer, 0, 0);
    expect(buffer.get(0, 0).ch + buffer.get(1, 0).ch).toBe('BA');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

it('loads multiple instances of an animated prop with independent animation clocks', async () => {
  const root = await createSceneFixtureAssets();
  try {
    for (const folder of ['animations', 'props']) await fs.mkdir(path.join(root, folder));
    const animation = createAnimation('blink');
    animation.frames = [{ sprite: 'target', index: 0, durationMs: 20 }, { invisible: true, durationMs: 30 }];
    await fs.writeFile(path.join(root, 'animations', 'blink.json'), JSON.stringify(animation));
    await fs.writeFile(path.join(root, 'props', 'machine.json'),
      JSON.stringify(createProp('machine', { type: 'animation', id: 'blink' })));
    const document = createScene('animated-room', undefined, 32, 10);
    document.entities = [8, 20].map((x, index) =>
      ({ id: `machine-${index}`, type: 'Prop', prop: 'machine', x, y: 4, z: 0 }));
    await fs.writeFile(path.join(root, 'scenes', `${document.id}.json`), JSON.stringify(document));
    const scene = await loadScene(root, document.id);
    const [first, second] = scene.entities;
    expect(first).toBeInstanceOf(AnimatedProp);
    expect(second).toBeInstanceOf(AnimatedProp);
    if (!(first instanceof AnimatedProp) || !(second instanceof AnimatedProp)) throw new Error('Missing animated props');
    expect(renderView(scene, 32, 10).get(8, 3).ch).toBe('#');
    first.update(20);
    const frame = renderView(scene, 32, 10);
    expect(frame.get(8, 3).ch).toBe(' ');
    expect(frame.get(20, 3).ch).toBe('#');
    second.update(20);
    expect(renderView(scene, 32, 10).get(20, 3).ch).toBe(' ');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
