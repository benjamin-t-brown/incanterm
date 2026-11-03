import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CellBuffer, type Cell } from '../cell-buffer.js';
import { TEST_SCENE_ID, getDefaultAssetsRoot, loadScene } from '../load-scene.js';
import { Prop, Scene, renderView } from '../scene.js';
import { Sprite } from '../sprite.js';
import { encodeTerminal, getPlainText } from '../terminal.js';

const ink: Cell = {
  ch: '.',
  fg: { r: 255, g: 255, b: 255 },
  bg: { r: 0, g: 0, b: 0 },
};

describe('test room', () => {
  it('loads the scene and draws its crate', async () => {
    const scene = await loadScene(getDefaultAssetsRoot(), TEST_SCENE_ID);
    expect(scene).toMatchObject({ id: 'test-room', width: 32, height: 10, depthMode: 'bottom-up' });
    expect(scene.entities).toHaveLength(1);
    const [prop] = scene.entities;
    expect(prop).toBeInstanceOf(Prop);
    if (!(prop instanceof Prop)) throw new Error('expected a prop');
    expect(prop.id).toBe('crate');
    expect(prop.x).toBe(16);
    expect(prop.y).toBe(6);
    expect(prop.sprite.id).toBe('crate');

    const room = getPlainText(renderView(scene, scene.width, scene.height));
    expect(room).toBe(
      [
        createBlank(),
        createBlank(),
        createBlank(),
        createBlank(),
        createBand('+---+'),
        createBand('| # |'),
        createBand('+---+'),
        createBlank(),
        createBlank(),
        createBlank(),
      ].join('\n'),
    );

    const buffer = renderView(scene, scene.width, scene.height);
    expect(buffer.get(0, 0)).toMatchObject({
      ch: ' ',
      bg: { r: 0, g: 0, b: 0 },
    });
    expect(buffer.get(16, 5)).toMatchObject({
      ch: '#',
      fg: { r: 0xe6, g: 0xc9, b: 0x8a },
      bg: { r: 0x4a, g: 0x34, b: 0x1c },
    });
    expect(buffer.get(16, 6).ch).toBe('-');

    const centered = renderView(scene, 36, 12);
    expect(centered.get(0, 0).ch).toBe(' ');
    expect(centered.get(2, 1).ch).toBe(' ');
    expect(centered.get(18, 6).ch).toBe('#');
  });

  it('clips the room to a smaller terminal', async () => {
    const scene = await loadScene(getDefaultAssetsRoot(), TEST_SCENE_ID);
    expect(getPlainText(renderView(scene, 10, 5)).split('\n')).toEqual([
      '          ',
      '   +---+  ',
      '   | # |  ',
      '   +---+  ',
      '          ',
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
  it('treats black spaces as holes but keeps colored spaces opaque', () => {
    const black = { r: 0, g: 0, b: 0 };
    const red = { r: 200, g: 20, b: 30 };
    const blue = { r: 20, g: 30, b: 200 };
    const back: Cell = { ch: 'A', fg: blue, bg: red };
    const hole: Cell = { ch: ' ', fg: red, bg: black };
    const coloredSpace: Cell = { ch: ' ', fg: red, bg: blue };
    const nearBlackSpace: Cell = { ch: ' ', fg: red, bg: { r: 0, g: 0, b: 1 } };
    const scene = new Scene('holes', 5, 1, 'regular-z', ink, [
      new Prop('back', 0, 0, 0, 0, new Sprite('back', 4, 1, 0, 0, [back, back, back, back])),
      new Prop('middle', 0, 0, 0, 1, new Sprite('middle', 5, 1, 0, 0, [
        hole,
        coloredSpace,
        { ch: '@', fg: red, bg: black },
        nearBlackSpace,
        hole,
      ])),
      new Prop('front', 0, 0, 0, 2, new Sprite('front', 5, 1, 0, 0, Array(5).fill(hole))),
    ]);
    const buffer = renderView(scene, 5, 1);
    expect(buffer.get(0, 0)).toEqual(back);
    expect(buffer.get(1, 0)).toEqual(coloredSpace);
    expect(buffer.get(2, 0)).toEqual({ ch: '@', fg: red, bg: red });
    expect(buffer.get(3, 0)).toEqual(nearBlackSpace);
    expect(buffer.get(4, 0)).toEqual({ ch: ' ', fg: black, bg: black });
  });

  it('uses the front glyph and the nearest non-black sprite background', () => {
    const red = { r: 200, g: 20, b: 30 };
    const blue = { r: 20, g: 30, b: 200 };
    const black = { r: 0, g: 0, b: 0 };
    const createSprite = (id: string, ch: string, bg: Cell['bg']) =>
      new Sprite(id, 1, 1, 0, 0, [{ ch, fg: red, bg }]);
    const scene = new Scene('layers', 2, 1, 'regular-z', ink, [
      new Prop('floor', 0, 0, 0, 0, createSprite('floor', '.', blue)),
      new Prop('middle', 0, 0, 0, 1, createSprite('middle', 'M', black)),
      new Prop('front', 0, 0, 0, 2, createSprite('front', '@', black)),
    ]);
    const buffer = renderView(scene, 2, 1);
    expect(buffer.get(0, 0)).toEqual({ ch: '@', fg: red, bg: blue });
    expect(buffer.get(1, 0)).toEqual({ ch: ' ', fg: black, bg: black });
  });

  it('keeps black when all overlapping sprite backgrounds are black', () => {
    const black = { r: 0, g: 0, b: 0 };
    const scene = new Scene('black', 1, 1, 'regular-z', ink, [
      new Prop(
        'back',
        0,
        0,
        0,
        0,
        new Sprite('back', 1, 1, 0, 0, [{ ch: 'A', fg: ink.fg, bg: black }]),
      ),
      new Prop(
        'front',
        0,
        0,
        0,
        1,
        new Sprite('front', 1, 1, 0, 0, [{ ch: 'B', fg: ink.fg, bg: black }]),
      ),
    ]);
    expect(renderView(scene, 1, 1).get(0, 0)).toEqual({ ch: 'B', fg: ink.fg, bg: black });
  });

  it('shows Eva’s red shirt behind a desk without showing her E glyph', () => {
    const black = { r: 0, g: 0, b: 0 };
    const red = { r: 170, g: 0, b: 0 };
    const scene = new Scene('desk', 1, 2, 'bottom-up', ink, [
      new Prop(
        'eva',
        0,
        0,
        0,
        0,
        new Sprite('eva', 1, 1, 0, 0, [{ ch: 'E', fg: ink.fg, bg: red }]),
      ),
      new Prop(
        'desk',
        0,
        1,
        0,
        0,
        new Sprite('desk', 1, 2, 0, 1, [
          { ch: '│', fg: ink.fg, bg: black },
          { ch: ' ', fg: ink.fg, bg: black },
        ]),
      ),
    ]);
    expect(renderView(scene, 1, 2).get(0, 0)).toEqual({ ch: '│', fg: ink.fg, bg: red });
  });

  it('keeps sprite cells outside the scene from painting the view margin', () => {
    const blue = { r: 10, g: 20, b: 30 };
    const sprite = new Sprite('wide', 3, 1, 1, 0, [
      { ch: 'L', fg: ink.fg, bg: blue },
      { ch: 'C', fg: ink.fg, bg: blue },
      { ch: 'R', fg: ink.fg, bg: blue },
    ]);
    const scene = new Scene('clip', 1, 1, 'regular-z', ink, [new Prop('wide', 0, 0, 0, 0, sprite)]);
    const buffer = renderView(scene, 3, 1);
    expect(buffer.get(0, 0).ch).toBe(' ');
    expect(buffer.get(1, 0)).toEqual({ ch: 'C', fg: ink.fg, bg: blue });
    expect(buffer.get(2, 0).ch).toBe(' ');
  });

  it('paints the higher depth on top', () => {
    const scene = new Scene('overlap', 1, 1, 'bottom-up', ink, [
      new Prop('far', 0, 0, 0, 0, getGlyph('far', 'A')),
      new Prop('near', 0, 0, 2, 0, getGlyph('near', 'B')),
    ]);
    const buffer = new CellBuffer(1, 1, ink);
    scene.draw(buffer, 0, 0);
    expect(buffer.get(0, 0).ch).toBe('B');
  });

  it('uses z order for regular-z scenes', () => {
    const scene = new Scene('overlap', 1, 1, 'regular-z', ink, [
      new Prop('high', 0, 0, 0, 4, getGlyph('high', 'A')),
      new Prop('low', 0, 0, 0, 1, getGlyph('low', 'B')),
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

function createBlank(): string {
  return ' '.repeat(32);
}

function createBand(middle: string): string {
  return `${' '.repeat(14)}${middle}${' '.repeat(13)}`;
}

function getGlyph(id: string, ch: string): Sprite {
  return new Sprite(id, 1, 1, 0, 0, [{ ch, fg: ink.fg, bg: ink.bg }]);
}
