import { ALT_CODE_PAGES } from '../resources/alt-codes.js';
import { createEmptySpriteFrame, createSprite, type SpriteDocument } from '../schema.js';

const CODES_PER_ROW = 8;
const CODE_WIDTH = 4;
const SLOT_WIDTH = CODE_WIDTH + 3; // A space, the glyph, and a gap before the next code.
const HEADER_ROWS = 2;
const WIDTH = CODES_PER_ROW * SLOT_WIDTH + 1;
const HEIGHT = HEADER_ROWS + 16;

export function createAltCodeSheet(id: string, label: string): SpriteDocument {
  const sprite = createSprite(id, WIDTH, HEIGHT, label);
  sprite.sprites = ALT_CODE_PAGES.map(({ title, start, prefix, glyphs }) => {
    const frame = createEmptySpriteFrame(WIDTH, HEIGHT);
    const layer = frame.layers[0];
    layer.name = title;
    for (const [index, ch] of [...title].entries()) {
      layer.cells[index + 1] = { ch, fg: 'bright-cyan', bg: 'black' };
    }
    for (const [index, ch] of [...glyphs].entries()) {
      if (ch === '\0') continue;
      const row = HEADER_ROWS + Math.floor(index / CODES_PER_ROW);
      const col = 1 + (index % CODES_PER_ROW) * SLOT_WIDTH;
      const offset = row * WIDTH + col;
      const code = `${prefix}${start + index}`.padStart(CODE_WIDTH);
      for (const [digit, value] of [...code].entries()) {
        if (value !== ' ') layer.cells[offset + digit] = { ch: value, fg: 'white', bg: 'black' };
      }
      layer.cells[offset + CODE_WIDTH + 1] = { ch, fg: 'bright-white', bg: 'black' };
    }
    return frame;
  });
  return sprite;
}
