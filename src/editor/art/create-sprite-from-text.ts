import { isSingleWidthGlyph } from '../glyph.js';
import {
  createSprite,
  getSpriteLabelError,
  MAX_SPRITE_HEIGHT,
  MAX_SPRITE_WIDTH,
  type SchemaResult,
  type SpriteDocument,
} from '../schema.js';

const TAB_SIZE = 4;

export function createSpriteFromText(
  id: string,
  label: string,
  text: string,
): SchemaResult<SpriteDocument> {
  const labelError = getSpriteLabelError(label);
  if (labelError) return { ok: false, error: labelError };
  if (!text.trim()) return { ok: false, error: 'Paste or type some ASCII art first.' };

  // A final line ending terminates the last row; additional blank rows are kept.
  const lines = text.replace(/\r\n?/g, '\n').replace(/\n$/, '').split('\n');
  const height = lines.length;
  if (height > MAX_SPRITE_HEIGHT) {
    return { ok: false, error: `Text cannot be taller than ${MAX_SPRITE_HEIGHT} rows.` };
  }

  const rows: string[][] = [];
  let width = 0;
  for (const [index, line] of lines.entries()) {
    const row: string[] = [];
    for (const ch of line) {
      if (ch === '\t') {
        row.push(...Array<string>(TAB_SIZE - (row.length % TAB_SIZE)).fill(' '));
      } else if (isSingleWidthGlyph(ch)) {
        row.push(ch);
      } else {
        return { ok: false, error: `Row ${index + 1} contains an unsupported character.` };
      }
      if (row.length > MAX_SPRITE_WIDTH) {
        return {
          ok: false,
          error: `Row ${index + 1} cannot be wider than ${MAX_SPRITE_WIDTH} columns.`,
        };
      }
    }
    rows.push(row);
    width = Math.max(width, row.length);
  }

  const sprite = createSprite(id, width, height, label.trim());
  sprite.sprites[0].layers[0].cells = rows.flatMap((row) =>
    Array.from({ length: width }, (_, column) => ({
      ch: row[column] ?? ' ',
      fg: 'bright-white',
      bg: 'black',
    })),
  );
  return { ok: true, value: sprite };
}
