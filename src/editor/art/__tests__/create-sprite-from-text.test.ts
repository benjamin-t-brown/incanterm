import { describe, expect, it } from 'vitest';
import { MAX_SPRITE_HEIGHT, MAX_SPRITE_WIDTH, parseSprite } from '../../schema.js';
import { createSpriteFromText } from '../create-sprite-from-text.js';

describe('create sprite from text', () => {
  it('keeps ASCII art aligned and fills the entire sprite with white-on-black cells', () => {
    const lines = [
      '___           _',
      ' | _ ) ___  ___| |__',
      String.raw` | _ \/ _ \/ _ \ / /`,
      String.raw` |___/\___/\___/_\_\  `,
    ];
    const width = lines[3].length;
    const result = createSpriteFromText('text-art', ' Boo ', lines.join('\n'));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const sprite = result.value;
    expect(sprite).toMatchObject({ label: 'Boo', width, height: 4 });
    expect(sprite.sprites).toHaveLength(1);
    expect(sprite.sprites[0].layers).toHaveLength(1);
    expect(sprite.sprites[0].layers[0].cells).toEqual(
      lines.flatMap((line) =>
        [...line.padEnd(width)].map((ch) => ({ ch, fg: 'bright-white', bg: 'black' })),
      ),
    );
    expect(parseSprite(sprite)).toEqual(result);
  });

  it('normalizes line endings and preserves blank rows and tab alignment', () => {
    const result = createSpriteFromText('text-art', 'Text Art', '\r\nA\tB\r\n\r\t╚\n\n');
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value).toMatchObject({ width: 5, height: 5 });
    expect(result.value.sprites[0].layers[0].cells.map((cell) => cell?.ch).join('')).toBe(
      ['     ', 'A   B', '     ', '    ╚', '     '].join(''),
    );
  });

  it('rejects empty art, invalid labels, and glyphs that do not fit a cell', () => {
    expect(createSpriteFromText('text-art', 'Text Art', ' \n\t')).toEqual({
      ok: false,
      error: 'Paste or type some ASCII art first.',
    });
    expect(createSpriteFromText('text-art', ' ', 'X')).toMatchObject({ ok: false });
    expect(createSpriteFromText('text-art', 'Text Art', 'X\n界')).toEqual({
      ok: false,
      error: 'Row 2 contains an unsupported character.',
    });
  });

  it('accepts the maximum dimensions but rejects larger art instead of clipping it', () => {
    const widestLine = 'x'.repeat(MAX_SPRITE_WIDTH);
    const tallestArt = Array<string>(MAX_SPRITE_HEIGHT).fill(widestLine).join('\n');
    expect(createSpriteFromText('text-art', 'Text Art', `${tallestArt}\n`)).toMatchObject({
      ok: true,
      value: { width: MAX_SPRITE_WIDTH, height: MAX_SPRITE_HEIGHT },
    });
    expect(createSpriteFromText('text-art', 'Text Art', `${widestLine}x`)).toEqual({
      ok: false,
      error: `Row 1 cannot be wider than ${MAX_SPRITE_WIDTH} columns.`,
    });
    expect(createSpriteFromText('text-art', 'Text Art', `${tallestArt}\nx`)).toEqual({
      ok: false,
      error: `Text cannot be taller than ${MAX_SPRITE_HEIGHT} rows.`,
    });
  });
});
