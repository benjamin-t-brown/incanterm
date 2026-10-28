import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CellBuffer, type Cell } from './cell-buffer.js';
import { TEST_SCENE_ID, defaultAssetsRoot, loadScene } from './load-scene.js';
import { Prop, Scene, renderView } from './scene.js';
import { Sprite } from './sprite.js';
import { encodeTerminal, plainText } from './terminal.js';

const ink: Cell = {
  ch: '.',
  fg: { r: 255, g: 255, b: 255 },
  bg: { r: 0, g: 0, b: 0 },
};

describe('test room', () => {
  it('loads the scene and draws its crate', async () => {
    const scene = await loadScene(defaultAssetsRoot(), TEST_SCENE_ID);
    expect(scene).toMatchObject({ id: 'test-room', width: 32, height: 10, depthMode: 'bottom-up' });
    expect(scene.entities).toHaveLength(1);
    const [prop] = scene.entities;
    expect(prop).toBeInstanceOf(Prop);
    if (!(prop instanceof Prop)) throw new Error('expected a prop');
    expect(prop.id).toBe('crate');
    expect(prop.x).toBe(16);
    expect(prop.y).toBe(6);
    expect(prop.sprite.id).toBe('crate');

    const room = plainText(renderView(scene, scene.width, scene.height));
    expect(room).toBe(
      [
        dots(),
        dots(),
        dots(),
        dots(),
        band('+---+'),
        band('| # |'),
        band('+---+'),
        dots(),
        dots(),
        dots(),
      ].join('\n'),
    );

    const buffer = renderView(scene, scene.width, scene.height);
    expect(buffer.get(0, 0)).toMatchObject({
      ch: '.',
      fg: { r: 0x5c, g: 0x6b, b: 0x63 },
      bg: { r: 0x14, g: 0x20, b: 0x1c },
    });
    expect(buffer.get(16, 5)).toMatchObject({
      ch: '#',
      fg: { r: 0xe6, g: 0xc9, b: 0x8a },
      bg: { r: 0x4a, g: 0x34, b: 0x1c },
    });
    expect(buffer.get(16, 6).ch).toBe('-');

    const centered = renderView(scene, 36, 12);
    expect(centered.get(0, 0).ch).toBe(' ');
    expect(centered.get(2, 1).ch).toBe('.');
    expect(centered.get(18, 6).ch).toBe('#');
  });

  it('clips the room to a smaller terminal', async () => {
    const scene = await loadScene(defaultAssetsRoot(), TEST_SCENE_ID);
    expect(plainText(renderView(scene, 10, 5)).split('\n')).toEqual([
      '..........',
      '...+---+..',
      '...| # |..',
      '...+---+..',
      '..........',
    ]);
  });

  it('reports a missing prop sprite', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'incanterm-scene-'));
    try {
      await fs.mkdir(path.join(root, 'scenes'), { recursive: true });
      await fs.writeFile(
        path.join(root, 'scenes', 'test-room.json'),
        JSON.stringify({
          format: 'incanterm-scene',
          version: 1,
          id: 'test-room',
          width: 8,
          height: 4,
          depthMode: 'bottom-up',
          clear: { ch: '.', fg: '#000000', bg: '#000000' },
          entities: [{ id: 'crate', type: 'Prop', sprite: 'missing', x: 1, y: 1 }],
        }),
      );
      await expect(loadScene(root, 'test-room')).rejects.toThrow(/Missing asset/);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});

describe('scene drawing', () => {
  it('paints the higher depth on top', () => {
    const scene = new Scene('overlap', 1, 1, 'bottom-up', ink, [
      new Prop('far', 0, 0, 0, 0, glyph('far', 'A')),
      new Prop('near', 0, 0, 2, 0, glyph('near', 'B')),
    ]);
    const buffer = new CellBuffer(1, 1, ink);
    scene.draw(buffer, 0, 0);
    expect(buffer.get(0, 0).ch).toBe('B');
  });

  it('uses z order for regular-z scenes', () => {
    const scene = new Scene('overlap', 1, 1, 'regular-z', ink, [
      new Prop('high', 0, 0, 0, 4, glyph('high', 'A')),
      new Prop('low', 0, 0, 0, 1, glyph('low', 'B')),
    ]);
    const buffer = new CellBuffer(1, 1, ink);
    scene.draw(buffer, 0, 0);
    expect(buffer.get(0, 0).ch).toBe('A');
  });

  it('encodes a truecolor terminal frame', () => {
    const buffer = new CellBuffer(1, 1, {
      ch: '#',
      fg: { r: 1, g: 2, b: 3 },
      bg: { r: 4, g: 5, b: 6 },
    });
    const text = encodeTerminal(buffer);
    expect(text.startsWith('\x1b[?7l\x1b[2J\x1b[H')).toBe(true);
    expect(text).toContain('\x1b[38;2;1;2;3;48;2;4;5;6m#');
    expect(text.endsWith('\x1b[?7h')).toBe(true);
  });
});

function dots(): string {
  return '.'.repeat(32);
}

function band(middle: string): string {
  return `${'.'.repeat(14)}${middle}${'.'.repeat(13)}`;
}

function glyph(id: string, ch: string): Sprite {
  return new Sprite(id, 1, 1, 0, 0, [{ ch, fg: ink.fg, bg: ink.bg }]);
}
