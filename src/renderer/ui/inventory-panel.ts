import { ITEM_SPRITE_HEIGHT, ITEM_SPRITE_WIDTH } from '../../editor/items/item-schema.js';
import { CellBuffer } from '../../game/cell-buffer.js';
import type { ItemAsset } from '../../game/items.js';
import { InlineButton } from './button.js';
import { UIElement, type DrawContext } from './element.js';
import { UI_INK } from './standard-ui.js';

const NUMBER_X = 2;
const CURSOR_STEP_MS = 500;
const SPRITE_MIDDLE = Math.floor(ITEM_SPRITE_HEIGHT / 2);
const SELECTED_ACTION_BG = { r: 242, g: 242, b: 242 };

export class InventoryPanel extends UIElement {
  items: readonly ItemAsset[] = [];
  selectedId?: string;
  elapsedMs = 0;
  private readonly examineButton = new InlineButton('inventory-examine', 0, 0, 'Examine');
  private readonly useButton = new InlineButton('inventory-use', 0, 0, 'Use');
  private readonly combineButton = new InlineButton(
    'inventory-combine',
    0,
    0,
    'Combine With This Item',
  );
  private readonly shortCombineButton = new InlineButton(
    'inventory-combine-short',
    0,
    0,
    'Combine',
  );
  private readonly cancelButton = new InlineButton('inventory-cancel', 0, 0, 'Cancel', {
    bg: SELECTED_ACTION_BG,
  });
  private activeCombineButton = this.combineButton;
  private firstItem = 0;
  private focusedId?: string;
  private cursorItemId?: string;
  private cursorStartedAtMs = 0;
  private numberWidth = 2;

  constructor() {
    super('inventory-items', 0, 0, 110, 1);
    this.resize(this.width, this.height);
  }

  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.firstItem = Math.min(this.getPageIndex(), this.getPageCount() - 1) * height;
    if (this.focusedId) {
      const index = this.getItemIndex(this.focusedId);
      if (index < 0) this.clearItemFocus();
      else this.focusItemAt(index);
    }
    this.numberWidth = String(Math.max(1, this.items.length)).length + 1;
    const labelWidth = this.items.reduce(
      (max, item) => Math.max(max, item.definition.label.length),
      0,
    );
    const buttonsWidth = this.examineButton.width + 1 + this.useButton.width;
    this.examineButton.x = Math.min(this.getLabelX() + labelWidth + 1, width - buttonsWidth - 1);
    this.useButton.x = this.examineButton.x + this.examineButton.width + 1;

    // Keep the target label readable even at the minimum terminal width.
    const availableWidth = width - this.getLabelX() - 2;
    this.activeCombineButton =
      this.combineButton.width + Math.min(labelWidth, 8) <= availableWidth
        ? this.combineButton
        : this.shortCombineButton;
    this.activeCombineButton.x = this.cancelButton.x = Math.min(
      this.getLabelX() + labelWidth + 1,
      width - this.activeCombineButton.width - 1,
    );
  }

  scrollPage(direction: -1 | 1): void {
    const page = Math.max(0, Math.min(this.getPageIndex() + direction, this.getPageCount() - 1));
    const first = page * this.height;
    if (this.firstItem === first) return;
    const focusedRow = this.getItemIndex(this.focusedId) - this.firstItem;
    this.firstItem = first;
    if (focusedRow >= 0) this.focusItemAt(Math.min(first + focusedRow, this.items.length - 1));
  }

  getFocusedItemId(): string | undefined {
    return this.focusedId;
  }

  clearItemFocus(): void {
    this.focusedId = undefined;
  }

  focusItemNumber(number: number): void {
    this.focusItemAt(number - 1);
  }

  moveItemFocus(direction: -1 | 1): void {
    const index = this.getItemIndex(this.focusedId ?? this.selectedId);
    const last = this.items.length - 1;
    const target =
      index >= this.firstItem && index < this.firstItem + this.height
        ? index + direction
        : direction === 1
          ? this.firstItem
          : this.firstItem + this.height - 1;
    this.focusItemAt(Math.max(0, Math.min(target, last)));
  }

  getActionAt(
    x: number,
    y: number,
    rightClick = false,
  ): { itemId: string; examine: boolean } | undefined {
    if (x < 0 || x >= this.width || y < 0 || y >= this.height) return;
    const asset = this.items[this.firstItem + y];
    if (!asset) return;
    if (rightClick) return { itemId: asset.definition.id, examine: true };
    const button = this.getItemButtons(asset.definition.id).find((button) =>
      isButtonColumn(button, x),
    );
    if (button) return { itemId: asset.definition.id, examine: button === this.examineButton };
  }

  getPageText(): string {
    return `Page ${this.getPageIndex() + 1}/${this.getPageCount()}`;
  }

  protected override paint(ctx: DrawContext): void {
    const cursorItemId = this.focusedId ?? this.selectedId;
    const cursorX = this.getCursorX(cursorItemId);
    if (!this.items.length) {
      paintText(ctx, 'No items.', 0, 0);
      return;
    }

    const labelX = this.getLabelX();
    // Composite full-size sprites in one column so transparent cells don't erase neighboring art.
    const sprites = new CellBuffer(ITEM_SPRITE_WIDTH, this.height, UI_INK);
    this.items.slice(this.firstItem, this.firstItem + this.height).forEach((asset, row) => {
      const itemId = asset.definition.id;
      const buttons = this.getItemButtons(itemId);
      const labelWidth = Math.max(0, buttons[0].x - labelX - 1);
      this.paintSprite(sprites, asset, row);
      if (cursorItemId === itemId) paintText(ctx, '>', cursorX, row);
      else if (this.selectedId === itemId) paintText(ctx, '*', 0, row);
      paintText(ctx, `${this.firstItem + row + 1}.`.padStart(this.numberWidth), NUMBER_X, row);
      if (labelWidth > 0) {
        const label = asset.definition.label;
        const text = label.length > labelWidth ? `${label.slice(0, labelWidth - 1)}…` : label;
        paintText(ctx, text, labelX, row);
      }
      for (const button of buttons) {
        button.y = row;
        button.draw(ctx);
      }
    });
    const spriteX = this.getSpriteX();
    for (let y = 0; y < sprites.height; y++)
      for (let x = 0; x < sprites.width; x++) ctx.set(spriteX + x, y, sprites.get(x, y));
  }

  private getCursorX(itemId: string | undefined): number {
    if (itemId !== this.cursorItemId) {
      this.cursorItemId = itemId;
      this.cursorStartedAtMs = this.elapsedMs;
    }
    return Math.floor(Math.max(0, this.elapsedMs - this.cursorStartedAtMs) / CURSOR_STEP_MS) % 2;
  }

  private getItemButtons(itemId: string): [InlineButton, ...InlineButton[]] {
    if (!this.selectedId) return [this.examineButton, this.useButton];
    return [itemId === this.selectedId ? this.cancelButton : this.activeCombineButton];
  }

  private getItemIndex(itemId: string | undefined): number {
    return this.items.findIndex((item) => item.definition.id === itemId);
  }

  private focusItemAt(index: number): void {
    const item = this.items[index];
    if (!item) return;
    this.focusedId = item.definition.id;
    if (index < this.firstItem || index >= this.firstItem + this.height)
      this.firstItem = Math.floor(index / this.height) * this.height;
  }

  private getPageIndex(): number {
    return Math.floor(this.firstItem / this.height);
  }

  private getPageCount(): number {
    return Math.max(1, Math.ceil(this.items.length / this.height));
  }

  private getSpriteX(): number {
    return NUMBER_X + this.numberWidth + 1;
  }

  private getLabelX(): number {
    return this.getSpriteX() + ITEM_SPRITE_WIDTH + 1;
  }

  private paintSprite(buffer: CellBuffer, asset: ItemAsset, row: number): void {
    const total = asset.clip.frames.reduce((sum, frame) => sum + frame.durationMs, 0);
    let elapsed = asset.clip.loop && total > 0 ? this.elapsedMs % total : this.elapsedMs;
    let frame = asset.clip.frames.at(-1);
    for (const candidate of asset.clip.frames) {
      frame = candidate;
      if (elapsed < candidate.durationMs) break;
      elapsed -= candidate.durationMs;
    }
    const sprite = frame?.sprite;
    if (sprite) sprite.draw(buffer, sprite.originX, row - SPRITE_MIDDLE + sprite.originY);
  }
}

function isButtonColumn(button: InlineButton, x: number): boolean {
  return x >= button.x && x < button.x + button.width;
}

function paintText(ctx: DrawContext, text: string, x: number, y: number): void {
  for (let i = 0; i < text.length; i++) ctx.set(x + i, y, { ...UI_INK, ch: text[i] });
}
