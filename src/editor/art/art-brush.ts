import type { ArtTool } from './art-cursor.js';
import { createBlankCell, createSprite, type SpriteCell, type SpriteDocument } from '../schema.js';
import { DEFAULT_SPRITE_FONT, type SpriteFontId } from '../terminal-cell.js';

export type BrushStamp = { width: number; height: number; cells: (SpriteCell | null)[] };

export function createSpriteFromBrush(
  id: string,
  label: string,
  brush: BrushStamp,
  font: SpriteFontId = DEFAULT_SPRITE_FONT,
): SpriteDocument {
  const sprite = createSprite(id, brush.width, brush.height, label);
  sprite.font = font;
  sprite.sprites[0].layers[0].cells = brush.cells.map((cell) => (cell ? { ...cell } : null));
  return sprite;
}

export function getBrushValue(
  tool: ArtTool,
  source: SpriteCell,
  target: SpriteCell | null,
): SpriteCell | null {
  if (tool === 'erase') return null;
  if (tool === 'fg-brush') {
    return target && target.ch !== ' ' ? { ...target, fg: source.fg } : target;
  }
  if (tool === 'bg-brush') return { ...(target ?? createBlankCell()), bg: source.bg };
  if (!target) {
    return tool === 'fg' || tool === 'bg' || tool === 'fg-erase' || tool === 'bg-erase'
      ? null
      : source;
  }
  if (tool === 'bg') return { ...target, bg: source.bg };
  if (tool === 'fg') return { ...target, fg: source.fg };
  if (tool === 'fg-erase') return { ...target, ch: ' ', fg: 'white' };
  if (tool === 'bg-erase') return { ...target, bg: 'black' };
  return source;
}
