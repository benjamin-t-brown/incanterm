import { describe, expect, it } from 'vitest';
import type { SpriteDocument } from '../../schema.js';
import { createAltCodeSheet } from '../create-alt-code-sheet.js';
import { encodeStoredSprite, parseStoredSprite } from '../sprite-storage.js';

function getPageEntries(sprite: SpriteDocument, page: number): [string, string][] {
  const cells = sprite.sprites[page].layers[0].cells;
  const entries: [string, string][] = [];
  for (let row = 2; row < sprite.height; row++) {
    for (let col = 1; col + 5 < sprite.width; col += 7) {
      const offset = row * sprite.width + col;
      const code = cells
        .slice(offset, offset + 4)
        .map((cell) => cell?.ch ?? ' ')
        .join('')
        .trim();
      const glyph = cells[offset + 5];
      if (code) entries.push([code, glyph?.ch ?? '']);
    }
  }
  return entries;
}

describe('Alt Codes spritesheet', () => {
  it('lays out every code from the main table in order, keeping leading zeros', () => {
    const sprite = createAltCodeSheet('alt-codes', 'Alt Codes');
    expect(sprite.sprites).toHaveLength(3);
    expect(getPageEntries(sprite, 0).map(([code]) => code)).toEqual(
      Array.from({ length: 127 }, (_, i) => String(i + 1)),
    );
    expect(getPageEntries(sprite, 1).map(([code]) => code)).toEqual(
      Array.from({ length: 128 }, (_, i) => i + 128)
        .filter((code) => code !== 189)
        .map(String),
    );
    expect(getPageEntries(sprite, 2).map(([code]) => code)).toEqual(
      Array.from({ length: 128 }, (_, i) => i + 128)
        .filter((code) => ![129, 141, 143, 144, 157, 173].includes(code))
        .map((code) => `0${code}`),
    );
  });

  it('keeps the actual glyphs, including spaces, when saved and reopened', () => {
    const sprite = createAltCodeSheet('alt-codes', 'Alt Codes');
    const stored = parseStoredSprite(JSON.parse(encodeStoredSprite(sprite)));
    expect(stored).toEqual({ ok: true, value: sprite });
    if (!stored.ok) return;
    const entries = new Map(
      stored.value.sprites.flatMap((_, page) => getPageEntries(stored.value, page)),
    );
    expect(entries.size).toBe(376);
    for (const glyph of entries.values()) expect([...glyph]).toHaveLength(1);
    expect(Object.fromEntries(entries)).toMatchObject({
      '3': '♥',
      '32': ' ',
      '60': '<',
      '92': '\\',
      '124': '|',
      '127': '⌂',
      '128': 'Ç',
      '179': '│',
      '219': '█',
      '255': '\u00a0',
      '0128': '€',
      '0160': '\u00a0',
      '0176': '°',
      '0255': 'ÿ',
    });
  });
});
