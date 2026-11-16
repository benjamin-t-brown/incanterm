import { CellBuffer } from '../../game/cell-buffer.js';
import type { ItemAsset } from '../../game/items.js';
import { UIElement, type DrawContext } from './element.js';
import { UI_INK } from './standard-ui.js';

export class InventoryPanel extends UIElement {
  items: readonly ItemAsset[] = [];
  selectedId?: string;
  elapsedMs = 0;

  constructor() {
    super('inventory-items', 0, 0, 110, 3);
  }

  getActionAt(x: number, y: number): { itemId: string; examine: boolean } | undefined {
    if (x < 0 || x >= this.width || y < 2 || y >= this.height) return;
    const asset = this.items[Math.floor((y - 2) / 4)];
    return asset ? { itemId: asset.definition.id, examine: x >= this.width - 10 } : undefined;
  }

  protected override paint(ctx: DrawContext): void {
    const writeText = (text: string, y: number, x = 0): void => {
      for (let i = 0; i < text.length && x + i < this.width; i++)
        ctx.set(x + i, y, { ...UI_INK, ch: text[i] });
    };
    writeText(
      this.selectedId
        ? 'Click another item or a world target to combine. Esc cancels.'
        : 'Click an item to use it. Click EXAMINE to inspect it.',
      0,
    );
    if (!this.items.length) writeText('No items.', 2);
    this.items.forEach((asset, index) => {
      const top = 2 + index * 4;
      const selected = this.selectedId === asset.definition.id;
      writeText(
        `${selected ? '> ' : '  '}${asset.definition.label}`.slice(0, Math.max(0, this.width - 21)),
        top + 1,
        9,
      );
      writeText('[EXAMINE]', top + 1, this.width - 10);
      const total = asset.clip.frames.reduce((sum, frame) => sum + frame.durationMs, 0);
      let elapsed = asset.clip.loop && total > 0 ? this.elapsedMs % total : this.elapsedMs;
      let frame = asset.clip.frames.at(-1);
      for (const candidate of asset.clip.frames) {
        frame = candidate;
        if (elapsed < candidate.durationMs) break;
        elapsed -= candidate.durationMs;
      }
      const sprite = frame?.sprite;
      if (!sprite) return;
      const buffer = new CellBuffer(sprite.width, sprite.height, UI_INK);
      sprite.draw(buffer, sprite.originX, sprite.originY);
      for (let y = 0; y < Math.min(3, sprite.height); y++)
        for (let x = 0; x < Math.min(8, sprite.width); x++) ctx.set(x, top + y, buffer.get(x, y));
    });
  }
}
