import type { CellBuffer, Cell } from '../../game/cell-buffer.js';
import { renderView, type Scene } from '../../game/scene.js';
import { UIElement, type DrawContext } from './element.js';
import { ParagraphWrapped } from './paragraph-wrapped.js';
import { TabbedView } from './tabbed-view.js';
import { DialoguePanel } from './dialogue-panel.js';
import {
  MIN_STANDARD_WIDTH,
  STANDARD_TABS,
  STANDARD_UI_HEIGHT,
  STANDARD_WIDTH,
  StandardSceneUi,
  UI_INK,
} from './standard-ui.js';

export { MIN_STANDARD_WIDTH, STANDARD_UI_HEIGHT, STANDARD_WIDTH } from './standard-ui.js';
export const STANDARD_HEIGHT = 40;
export const STANDARD_WORLD_HEIGHT = STANDARD_HEIGHT - STANDARD_UI_HEIGHT;
export const MIN_STANDARD_HEIGHT = 16;

export const STANDARD_BACKGROUND: Cell = {
  ch: ' ',
  fg: { r: 92, g: 107, b: 99 },
  bg: { r: 12, g: 14, b: 13 },
};

export class LayoutStandardScene extends UIElement {
  readonly ui: UIElement;
  readonly tabs: TabbedView;
  readonly dialoguePanel: DialoguePanel;
  readonly message: ParagraphWrapped;
  readonly choiceMessage: ParagraphWrapped;
  private worldStart = 0;
  private worldRows = STANDARD_WORLD_HEIGHT;

  constructor(readonly scene: Scene) {
    super('layout-standard-scene', 0, 0, STANDARD_WIDTH, STANDARD_HEIGHT);
    this.ui = new StandardSceneUi(
      'scene-ui',
      0,
      STANDARD_WORLD_HEIGHT,
      STANDARD_WIDTH,
      STANDARD_UI_HEIGHT,
    );
    this.tabs = new TabbedView(
      'scene-tabs',
      0,
      1,
      STANDARD_WIDTH,
      STANDARD_UI_HEIGHT - 1,
      STANDARD_TABS,
      { fg: UI_INK.fg, bg: UI_INK.bg },
    );
    this.dialoguePanel = new DialoguePanel(
      'scene-dialogue',
      0,
      1,
      STANDARD_WIDTH,
      STANDARD_UI_HEIGHT - 1,
    );
    this.message = this.dialoguePanel.message;
    this.choiceMessage = new ParagraphWrapped('scene-choices', 1, 3, STANDARD_WIDTH - 4, '', {
      fg: UI_INK.fg,
      bg: UI_INK.bg,
    });
    this.tabs.content('log').addChild(this.choiceMessage);
    this.ui.addChild(this.tabs);
    this.ui.addChild(this.dialoguePanel);
    this.addChild(this.ui);
  }

  render(buffer: CellBuffer): void {
    if (buffer.width < MIN_STANDARD_WIDTH || buffer.height < MIN_STANDARD_HEIGHT) {
      const warning = `Terminal needs at least ${MIN_STANDARD_WIDTH}x${MIN_STANDARD_HEIGHT} cells`;
      for (let x = 0; x < Math.min(buffer.width, warning.length); x++) {
        buffer.set(x, Math.floor(buffer.height / 2), { ...UI_INK, ch: warning[x] });
      }
      return;
    }

    this.x = Math.floor((buffer.width - STANDARD_WIDTH) / 2);
    this.y =
      buffer.height >= STANDARD_HEIGHT
        ? Math.floor((buffer.height - STANDARD_HEIGHT) / 2)
        : Math.max(buffer.height - STANDARD_HEIGHT, 4 - STANDARD_WORLD_HEIGHT);
    this.worldStart = Math.max(0, -this.y);
    this.worldRows = Math.max(
      0,
      Math.min(STANDARD_WORLD_HEIGHT, buffer.height - this.y) - this.worldStart,
    );

    const left = Math.max(0, -this.x);
    const right = Math.min(STANDARD_WIDTH, buffer.width - this.x);
    this.tabs.x = left;
    this.tabs.resize(right - left, STANDARD_UI_HEIGHT - 1);
    this.dialoguePanel.x = left;
    this.dialoguePanel.resize(right - left, STANDARD_UI_HEIGHT - 1);
    this.choiceMessage.width = Math.max(1, this.tabs.content('log').innerWidth - 2);
    this.dialoguePanel.visible = this.message.text.length > 0;
    this.tabs.visible = !this.dialoguePanel.visible;
    super.render(buffer);
  }

  protected paint(ctx: DrawContext): void {
    for (let y = 0; y < STANDARD_WORLD_HEIGHT; y++) {
      for (let x = 0; x < STANDARD_WIDTH; x++) ctx.set(x, y, STANDARD_BACKGROUND);
    }
    if (this.worldRows === 0) return;
    const world = renderView(this.scene, STANDARD_WIDTH, this.worldRows);
    for (let y = 0; y < world.height; y++) {
      for (let x = 0; x < world.width; x++) ctx.set(x, this.worldStart + y, world.get(x, y));
    }
  }
}
