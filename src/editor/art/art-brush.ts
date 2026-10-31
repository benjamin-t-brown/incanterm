import type { ArtTool } from './art-cursor.js';
import { blankCell, type SpriteCell } from '../schema.js';

export function brushValue(
  tool: ArtTool,
  source: SpriteCell,
  target: SpriteCell | null,
): SpriteCell | null {
  if (tool === 'erase') return null;
  if (tool === 'fg-brush') {
    return target && target.ch !== ' ' ? { ...target, fg: source.fg } : target;
  }
  if (tool === 'bg-brush') return { ...(target ?? blankCell()), bg: source.bg };
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
