import { isSingleWidthGlyph } from '../glyph.js';
import { isSpriteColor } from '../palette.js';
import { createSprite, spriteLabelError, type SpriteCell, type SpriteDocument } from '../schema.js';

// Frame order and glyphs from the 22-frame ada3x3 spritesheet.
const CELLS: [string, string, string][] = [
  ['O', 'bright-white', 'black'],
  ['/', 'bright-white', 'black'],
  ['A', 'bright-black', 'bright-yellow'],
  ['\\', 'bright-white', 'black'],
  ['o', 'bright-white', 'black'],
  [';', 'bright-white', 'black'],
  ['@', 'bright-white', 'black'],
  ['.', 'bright-white', 'black'],
  [' ', 'white', 'bright-yellow'],
  ['0', 'bright-white', 'black'],
  [',', 'bright-white', 'black'],
  ['|', 'bright-white', 'black'],
  ['│', 'bright-white', 'black'],
  ['`', 'bright-white', 'black'],
  ['-', 'bright-white', 'black'],
  ['┘', 'bright-white', 'black'],
];

const FRAMES = [
  [0, 1, 0, 2, 3, 4, 2, 0, 4],
  [0, 5, 0, 2, 3, 4, 2, 0, 4],
  [0, 1, 6, 2, 3, 4, 2, 0, 4],
  [0, 5, 6, 2, 3, 4, 2, 0, 4],
  [6, 1, 0, 2, 3, 4, 2, 0, 4],
  [6, 5, 0, 2, 3, 4, 2, 0, 4],
  [0, 7, 0, 8, 9, 8, 2, 0, 4],
  [0, 10, 0, 8, 9, 8, 2, 0, 4],
  [0, 5, 0, 11, 3, 8, 0, 12, 0],
  [0, 5, 0, 8, 3, 11, 0, 12, 0],
  [0, 5, 8, 8, 3, 11, 0, 13, 14],
  [0, 5, 8, 11, 3, 8, 0, 13, 14],
  [8, 5, 0, 11, 3, 8, 14, 13, 0],
  [8, 5, 0, 8, 3, 11, 14, 13, 0],
  [0, 5, 0, 0, 9, 11, 0, 12, 0],
  [0, 5, 0, 11, 9, 0, 0, 12, 0],
  [0, 1, 6, 15, 3, 4, 2, 0, 4],
  [6, 1, 0, 2, 3, 15, 2, 0, 4],
  [6, 1, 2, 2, 3, 0, 2, 0, 4],
  [4, 1, 6, 0, 3, 4, 2, 0, 4],
  [4, 1, 2, 0, 3, 0, 2, 0, 4],
  [0, 1, 6, 11, 3, 0, 16, 12, 0],
] as const;

export function generateCharacter3x3(
  id: string,
  label: string,
  shirtColor: string,
  shirtLetter: string,
  hair: boolean,
  letterColor = 'bright-black',
): SpriteDocument {
  const error = spriteLabelError(label);
  if (error) throw new Error(error);
  if (!isSpriteColor(shirtColor))
    throw new Error('Choose a palette color or enter #rrggbb for the shirt');
  if (!isSpriteColor(letterColor))
    throw new Error('Choose a palette color or enter #rrggbb for the shirt letter');
  const shirt = shirtColor.startsWith('#') ? shirtColor.toLowerCase() : shirtColor;
  const letter = letterColor.startsWith('#') ? letterColor.toLowerCase() : letterColor;
  if (!isSingleWidthGlyph(shirtLetter) || !shirtLetter.trim())
    throw new Error('Shirt letter must be one single-width character');
  const sprite = createSprite(id, 3, 3, label.trim());
  sprite.font = 'consolas';
  sprite.sprites = FRAMES.map((indices) => ({
    layers: [
      {
        id: 'layer-1',
        name: 'Layer 1',
        visible: true,
        locked: false,
        cells: indices.map((value, position): SpriteCell | null => {
          if (value === 0) return null;
          const [ch, fg, bg] = CELLS[value - 1];
          if (!hair && (position === 0 || position === 2) && (ch === '.' || ch === ';'))
            return null;
          return {
            ch: value === 3 ? shirtLetter : ch,
            fg: value === 3 ? letter : fg,
            bg: value === 3 || value === 9 ? shirt : bg,
          };
        }),
      },
    ],
  }));
  return sprite;
}
