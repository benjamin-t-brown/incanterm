import { isSingleWidthGlyph } from '../glyph.js';
import { isSpriteColor } from '../palette.js';
import {
  createSprite,
  getSpriteLabelError,
  type SpriteCell,
  type SpriteDocument,
} from '../schema.js';
import { CHARACTER_5X5_CELLS, CHARACTER_5X5_FRAMES } from './character-template-5x5.js';

// Built-in frame order and glyphs for the standard 22-frame 3x3 character template.
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

// Optional hair positions and glyphs for the standard 3x3 template.
const HAIR_HEAD_FRAMES = new Set([2, 4, 10, 11, 12, 13, 14, 15, 16, 17, 21]);
const HAIR_SIDE_CELLS = new Map([
  [2, 2],
  [3, 2],
  [4, 0],
  [5, 0],
  [10, 2],
  [11, 2],
  [12, 0],
  [13, 0],
  [16, 2],
  [17, 0],
  [21, 2],
]);

const HAIRLESS_5X5_OUTLINE: Readonly<Record<number, string>> = {
  2: '─',
  3: '╮',
  6: '╰',
  8: '╯',
};

export function generateCharacter3x3(
  id: string,
  label: string,
  shirtColor: string,
  shirtLetter: string,
  hair: boolean,
  letterColor = 'bright-white',
): SpriteDocument {
  const { shirt, letter } = getCharacterColors(label, shirtColor, shirtLetter, letterColor);
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
            ch:
              hair && position === 1 && HAIR_HEAD_FRAMES.has(frameIndex)
                ? 'o'
                : value === 3
                  ? shirtLetter
                  : ch,
            fg: value === 3 ? letter : fg,
            bg: value === 3 || value === 8 ? shirt : bg,
          };
        }),
      },
    ],
  }));
  return sprite;
}

export function generateCharacter5x5(
  id: string,
  label: string,
  shirtColor: string,
  shirtLetter: string,
  hair: boolean,
  letterColor = 'bright-white',
): SpriteDocument {
  const { shirt, letter } = getCharacterColors(label, shirtColor, shirtLetter, letterColor);
  const sprite = createSprite(id, 5, 5, label.trim());
  sprite.font = 'consolas';
  sprite.sprites = CHARACTER_5X5_FRAMES.map((indices) => ({
    layers: [
      {
        id: 'layer-1',
        name: 'Layer 1',
        visible: true,
        locked: false,
        cells: indices.map((value, position): SpriteCell | null => {
          if (value === 0) return null;
          const [ch, fg, bg] = CHARACTER_5X5_CELLS[value - 1];
          // Without hair, keep a white head outline in place of the yellow hair marks.
          if (!hair && fg === 'yellow') {
            return { ch: HAIRLESS_5X5_OUTLINE[position] ?? ch, fg: 'bright-white', bg };
          }
          return {
            ch: value === 8 ? shirtLetter : ch,
            fg: value === 8 ? letter : fg,
            bg: bg === '#f2740d' ? shirt : bg,
          };
        }),
      },
    ],
  }));
  return sprite;
}

function getCharacterColors(
  label: string,
  shirtColor: string,
  shirtLetter: string,
  letterColor: string,
): { shirt: string; letter: string } {
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
  return { shirt, letter };
}
