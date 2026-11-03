import { isSingleWidthGlyph } from '../glyph.js';
import { isSpriteColor } from '../palette.js';
import { createSprite, getSpriteLabelError, type SpriteCell, type SpriteDocument } from '../schema.js';

// Frame order and glyphs from the 22-frame test3x3 spritesheet.
const CELLS: [string, string, string][] = [
  ['o', 'bright-white', 'black'],
  ['/', 'bright-white', 'black'],
  ['J', 'bright-white', 'yellow'],
  ['\\', 'bright-white', 'black'],
  ['O', 'bright-white', 'black'],
  ['.', 'bright-white', 'black'],
  ['@', 'bright-white', 'black'],
  [' ', 'white', 'yellow'],
  ['0', 'bright-white', 'black'],
  ['|', 'bright-white', 'black'],
  ['│', 'bright-white', 'black'],
  [' ', 'white', 'black'],
  ['-', 'bright-white', 'black'],
  [',', 'bright-white', 'black'],
  ['┘', 'bright-white', 'black'],
];

const FRAMES = [
  [0, 1, 0, 2, 3, 4, 2, 0, 4],
  [0, 5, 0, 2, 3, 4, 2, 0, 4],
  [0, 1, 0, 6, 3, 4, 2, 0, 4],
  [0, 5, 0, 6, 3, 4, 2, 0, 4],
  [0, 1, 0, 2, 3, 6, 2, 0, 4],
  [0, 5, 0, 2, 3, 6, 2, 0, 4],
  [0, 7, 0, 6, 8, 6, 2, 0, 4],
  [0, 9, 0, 6, 8, 6, 2, 0, 4],
  [0, 1, 0, 2, 8, 4, 2, 0, 4],
  [0, 1, 0, 2, 8, 4, 0, 10, 0],
  [0, 1, 0, 6, 8, 4, 2, 0, 4],
  [0, 1, 0, 6, 8, 4, 0, 11, 12],
  [0, 1, 0, 2, 8, 6, 2, 0, 4],
  [0, 1, 0, 2, 8, 6, 0, 11, 0],
  [0, 1, 0, 6, 8, 6, 2, 0, 4],
  [0, 1, 0, 6, 8, 6, 0, 11, 0],
  [0, 1, 0, 13, 3, 4, 2, 0, 4],
  [0, 1, 0, 2, 3, 13, 2, 0, 4],
  [0, 1, 2, 2, 3, 0, 2, 0, 4],
  [4, 1, 0, 0, 3, 4, 2, 0, 4],
  [4, 1, 2, 0, 3, 0, 2, 0, 4],
  [0, 1, 0, 14, 3, 0, 15, 10, 0],
] as const;

// Hair positions and glyphs follow the matching frames of the ada3x3 spritesheet.
const HAIR_HEAD_FRAMES = new Set([2, 4, 10, 11, 12, 13, 14, 15, 16, 17, 21]);
const HAIR_SIDE_CELLS = new Map([
  [2, 2], [3, 2], [4, 0], [5, 0], [10, 2], [11, 2],
  [12, 0], [13, 0], [16, 2], [17, 0], [21, 2],
]);

export function generateCharacter3x3(
  id: string,
  label: string,
  shirtColor: string,
  shirtLetter: string,
  hair: boolean,
  letterColor = 'bright-white',
): SpriteDocument {
  const error = getSpriteLabelError(label);
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
  sprite.sprites = FRAMES.map((indices, frameIndex) => ({
    layers: [
      {
        id: 'layer-1',
        name: 'Layer 1',
        visible: true,
        locked: false,
        cells: indices.map((value, position): SpriteCell | null => {
          if (value === 0) {
            return hair && HAIR_SIDE_CELLS.get(frameIndex) === position
              ? { ch: ';', fg: 'bright-white', bg: 'black' }
              : null;
          }
          const [ch, fg, bg] = CELLS[value - 1];
          return {
            ch: hair && position === 1 && HAIR_HEAD_FRAMES.has(frameIndex)
              ? 'o' : value === 3 ? shirtLetter : ch,
            fg: value === 3 ? letter : fg,
            bg: value === 3 || value === 8 ? shirt : bg,
          };
        }),
      },
    ],
  }));
  return sprite;
}
