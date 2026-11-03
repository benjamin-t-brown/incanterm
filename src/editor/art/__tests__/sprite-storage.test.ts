import fs from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createSprite } from '../../schema.js';
import { encodeStoredSprite, parseStoredSprite } from '../sprite-storage.js';

describe('sprite disk storage', () => {
  it('round-trips frames, layers, transparent cells, and Unicode glyphs', () => {
    const sprite = createSprite('sample', 8, 2);
    const first = sprite.sprites[0].layers[0];
    first.cells[0] = { ch: '█', fg: 'bright-white', bg: 'black' };
    first.cells[1] = { ch: '█', fg: 'bright-white', bg: 'black' };
    sprite.sprites[0].layers.push({
      id: 'layer-2',
      name: 'Top',
      visible: false,
      locked: true,
      cells: Array.from({ length: 16 }, () => null),
    });
    sprite.sprites[0].layers[1].cells[15] = { ch: '╬', fg: 'cyan', bg: 'blue' };
    sprite.sprites.push({ layers: [{ ...first, cells: [...first.cells] }] });

    const stored = JSON.parse(encodeStoredSprite(sprite)) as Record<string, unknown>;
    expect(stored.version).toBe(3);
    expect(stored).toHaveProperty('cellPalette');
    expect(parseStoredSprite(stored)).toEqual({ ok: true, value: sprite });
    expect(parseStoredSprite(sprite)).toEqual({ ok: true, value: sprite });
  });

  it('uses indexes for noisy cells and runs for repeated cells', () => {
    const sprite = createSprite('modes', 20, 1);
    const layer = sprite.sprites[0].layers[0];
    layer.cells = Array.from({ length: 20 }, (_, i) =>
      i % 2 ? { ch: 'A', fg: 'white', bg: 'black' } : { ch: 'B', fg: 'white', bg: 'black' },
    );
    sprite.sprites[0].layers.push({ ...layer, id: 'layer-2', cells: Array(20).fill(null) });
    const stored = JSON.parse(encodeStoredSprite(sprite)) as {
      sprites: Array<{ layers: Array<{ cells: Record<string, unknown> }> }>;
    };
    expect(stored.sprites[0].layers[0].cells).toHaveProperty('indices');
    expect(stored.sprites[0].layers[1].cells).toHaveProperty('runs');
    expect(parseStoredSprite(stored)).toEqual({ ok: true, value: sprite });
  });

  it('rejects malformed runs and palette references', () => {
    const sprite = createSprite('broken', 2, 1);
    const stored = JSON.parse(encodeStoredSprite(sprite)) as {
      sprites: Array<{ layers: Array<{ cells: unknown }> }>;
    };
    stored.sprites[0].layers[0].cells = { runs: [[3, 0]] };
    expect(parseStoredSprite(stored).ok).toBe(false);
    stored.sprites[0].layers[0].cells = { indices: [0, 999] };
    expect(parseStoredSprite(stored).ok).toBe(false);
  });

  it('makes the sample spritesheet substantially smaller', async () => {
    const file = path.join(process.cwd(), 'assets', 'sprites', 'test1.json');
    const storedText = await fs.readFile(file, 'utf8');
    const parsed = parseStoredSprite(JSON.parse(storedText) as unknown);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(encodeStoredSprite(parsed.value)).toBe(storedText);
    expect(Buffer.byteLength(storedText)).toBeLessThan(
      JSON.stringify(parsed.value, null, 2).length / 10,
    );
  });
});
