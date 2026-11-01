import { CellBuffer, type Cell } from '../../game/cell-buffer.js';
import { UIElement, type DrawContext } from './element.js';
import { TabbedView } from './tabbed-view.js';

export const STANDARD_WIDTH = 120;
export const STANDARD_UI_HEIGHT = 16;
export const MIN_STANDARD_WIDTH = 40;
export const UI_INK: Cell = {
  ch: ' ',
  fg: { r: 205, g: 211, b: 209 },
  bg: { r: 16, g: 20, b: 25 },
};
export const STANDARD_TABS = [
  { id: 'log', label: 'Log' },
  { id: 'inventory', label: 'Inventory' },
  { id: 'menu', label: 'Menu' },
];

export class StandardSceneUi extends UIElement {
  protected paint(ctx: DrawContext): void {
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        ctx.set(x, y, { ...UI_INK, ch: y === 0 ? '=' : ' ' });
      }
    }
  }
}

/** The default tabbed UI, without drawing or loading a world scene. */
export function renderStandardUiPreview(width: number): CellBuffer {
  const columns = Math.max(MIN_STANDARD_WIDTH, Math.min(STANDARD_WIDTH, width));
  const buffer = new CellBuffer(columns, STANDARD_UI_HEIGHT, UI_INK);
  const panel = new StandardSceneUi('scene-ui-preview', 0, 0, columns, STANDARD_UI_HEIGHT);
  panel.addChild(
    new TabbedView('scene-ui-preview-tabs', 0, 1, columns, STANDARD_UI_HEIGHT - 1, STANDARD_TABS, {
      fg: UI_INK.fg,
      bg: UI_INK.bg,
    }),
  );
  panel.render(buffer);
  return buffer;
}
