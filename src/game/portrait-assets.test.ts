import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createAnimation, createSprite, emptySpriteFrame } from '../editor/schema.js';
import { encodeStoredSprite } from '../editor/art/sprite-storage.js';
import { loadPortraitAssets, portraitFrameAt, portraitNextFrameDelay } from './portrait-assets.js';

describe('portrait assets', () => {
  let root: string | undefined;
  afterEach(async () => {
    if (root) await fs.rm(root, { recursive: true, force: true });
    root = undefined;
  });

  it('loads named sprite-sheet indexes and plays animation frames by duration', async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'incanterm-portraits-'));
    await fs.mkdir(path.join(root, 'sprites'));
    await fs.mkdir(path.join(root, 'animations'));
    const sprite = createSprite('face', 2, 1);
    sprite.sprites[0].layers[0].cells[0] = { ch: 'A', fg: 'bright-red', bg: 'black' };
    const second = emptySpriteFrame(2, 1);
    second.layers[0].cells[0] = { ch: 'B', fg: 'bright-blue', bg: 'black' };
    sprite.sprites.push(second);
    await fs.writeFile(path.join(root, 'sprites', 'face.json'), encodeStoredSprite(sprite));
    const animation = createAnimation('talking');
    animation.frames.push(
      { sprite: 'face', index: 0, durationMs: 80 },
      { sprite: 'face', index: 1, durationMs: 120 },
    );
    await fs.writeFile(path.join(root, 'animations', 'talking.json'), JSON.stringify(animation));

    const assets = await loadPortraitAssets(root);
    expect(assets.get('face')).toBeUndefined();
    expect(assets.get('face_0')?.frames[0].cells?.[0].ch).toBe('A');
    expect(assets.get('face_1')?.frames[0].cells?.[0].ch).toBe('B');
    expect(assets.get('face_0')?.frames[0].cells?.[0].fg).toEqual({ r: 255, g: 85, b: 85 });
    const talking = assets.get('talking');
    expect(talking).toBeDefined();
    if (!talking) return;
    expect(portraitFrameAt(talking, 0).cells?.[0].ch).toBe('A');
    expect(portraitFrameAt(talking, 79).cells?.[0].ch).toBe('A');
    expect(portraitFrameAt(talking, 80).cells?.[0].ch).toBe('B');
    expect(portraitFrameAt(talking, 200).cells?.[0].ch).toBe('A');
    expect(portraitNextFrameDelay(talking, 0)).toBe(80);
    expect(portraitNextFrameDelay(talking, 79)).toBe(1);
    expect(portraitNextFrameDelay(talking, 80)).toBe(120);
    expect(portraitNextFrameDelay(talking, 200)).toBe(80);
    const ending = { ...talking, loop: false };
    expect(portraitFrameAt(ending, 200).cells?.[0].ch).toBe('B');
    expect(portraitNextFrameDelay(ending, 80)).toBeUndefined();
  });

  it('mirrors portrait cells per axis and cancels a clip flip with a frame flip', async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'incanterm-portraits-'));
    await fs.mkdir(path.join(root, 'sprites'));
    await fs.mkdir(path.join(root, 'animations'));
    const sprite = createSprite('face', 2, 2);
    for (const [index, ch] of ['A', 'B', 'C', 'D'].entries())
      sprite.sprites[0].layers[0].cells[index] = { ch, fg: 'white', bg: 'black' };
    await fs.writeFile(path.join(root, 'sprites', 'face.json'), encodeStoredSprite(sprite));
    const clip = createAnimation('mirror');
    clip.flipH = true;
    clip.frames.push(
      { sprite: 'face', index: 0, durationMs: 100 },
      { sprite: 'face', index: 0, durationMs: 100, flipH: true, flipV: true },
    );
    await fs.writeFile(path.join(root, 'animations', 'mirror.json'), JSON.stringify(clip));
    const frames = (await loadPortraitAssets(root)).get('mirror')?.frames;
    expect(frames?.[0].cells?.map((cell) => cell.ch)).toEqual(['B', 'A', 'D', 'C']);
    expect(frames?.[1].cells?.map((cell) => cell.ch)).toEqual(['C', 'D', 'A', 'B']);
  });

  it('handles asset roots without portrait directories', async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'incanterm-portraits-'));
    expect((await loadPortraitAssets(root)).size).toBe(0);
  });

  it('ignores malformed portrait assets so unrelated dialogue can still play', async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'incanterm-portraits-'));
    await fs.mkdir(path.join(root, 'sprites'));
    await fs.writeFile(path.join(root, 'sprites', 'unfinished.json'), '{');
    expect((await loadPortraitAssets(root)).get('unfinished_0')).toBeUndefined();
  });
});
