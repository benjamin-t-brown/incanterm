import type { CellBuffer, Cell } from '../../game/cell-buffer.js';
import { renderView, type Scene } from '../../game/scene.js';
import { UIElement, DrawContext } from './element.js';
import { ParagraphWrapped, wrapParagraph } from './paragraph-wrapped.js';
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
export const STANDARD_WORLD_HEIGHT = STANDARD_HEIGHT;
const STANDARD_UI_TOP = STANDARD_HEIGHT - STANDARD_UI_HEIGHT;
export const MIN_STANDARD_HEIGHT = 16;

export const STANDARD_BACKGROUND: Cell = {
  ch: ' ',
  fg: { r: 92, g: 107, b: 99 },
  bg: { r: 12, g: 14, b: 13 },
};
const MAX_LOG_ENTRIES = 100;
export const ERROR_LOG_FG = { r: 255, g: 64, b: 64 };

export class LayoutStandardScene extends UIElement {
  readonly ui: UIElement;
  readonly tabs: TabbedView;
  readonly dialoguePanel: DialoguePanel;
  readonly message: ParagraphWrapped;
  readonly choiceMessage: ParagraphWrapped;
  readonly scriptLog: ParagraphWrapped;
  conversationOpen = false;
  private readonly logEntries: { message: string; error: boolean }[] = [];
  private viewportWidth = 0;
  private viewportHeight = 0;
  private canClick = false;

  getScenePoint(x: number, y: number): { x: number; y: number } | undefined {
    const portrait = this.dialoguePanel.portraitBox;
    const rightPortrait = this.dialoguePanel.rightPortraitBox;
    if (
      !this.canClick ||
      x < 0 ||
      y < 0 ||
      x >= this.viewportWidth ||
      y >= this.viewportHeight ||
      x < this.x ||
      x >= this.x + STANDARD_WIDTH ||
      y < this.y ||
      y >= this.y + STANDARD_WORLD_HEIGHT ||
      (this.ui.visible && y >= this.y + this.ui.y) ||
      (this.dialoguePanel.visible && portrait.visible &&
        x >= portrait.x && x < portrait.x + portrait.width &&
        y >= portrait.y && y < portrait.y + portrait.height) ||
      (this.dialoguePanel.visible && rightPortrait.visible &&
        x >= rightPortrait.x && x < rightPortrait.x + rightPortrait.width &&
        y >= rightPortrait.y && y < rightPortrait.y + rightPortrait.height)
    )
      return;
    const sceneX = x - this.x - Math.floor((STANDARD_WIDTH - this.scene.width) / 2);
    const sceneY = y - this.y - Math.floor((STANDARD_WORLD_HEIGHT - this.scene.height) / 2);
    if (sceneX < 0 || sceneY < 0 || sceneX >= this.scene.width || sceneY >= this.scene.height)
      return;
    return { x: sceneX, y: sceneY };
  }

  constructor(public scene: Scene) {
    super('layout-standard-scene', 0, 0, STANDARD_WIDTH, STANDARD_HEIGHT);
    this.ui = new StandardSceneUi(
      'scene-ui',
      0,
      STANDARD_UI_TOP,
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
    this.scriptLog = new ParagraphWrapped('scene-script-log', 1, 1, STANDARD_WIDTH - 4, '', {
      fg: UI_INK.fg,
      bg: UI_INK.bg,
    });
    this.tabs.getContent('log').addChild(this.choiceMessage).addChild(this.scriptLog);
    this.ui.addChild(this.tabs);
    this.ui.addChild(this.dialoguePanel);
    this.addChild(this.ui);
  }

  appendLog(message: string, error = false): void {
    this.logEntries.push({ message, error });
    if (this.logEntries.length > MAX_LOG_ENTRIES) this.logEntries.shift();
    this.scriptLog.text = this.logEntries.map((entry) => entry.message).join('\n');
    this.tabs.getContent('log').scrollToEnd();
  }

  render(buffer: CellBuffer): void {
    this.viewportWidth = buffer.width;
    this.viewportHeight = buffer.height;
    this.canClick = buffer.width >= MIN_STANDARD_WIDTH && buffer.height >= MIN_STANDARD_HEIGHT;
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
        : Math.max(buffer.height - STANDARD_HEIGHT, 4 - STANDARD_UI_TOP);

    const left = Math.max(0, -this.x);
    const right = Math.min(STANDARD_WIDTH, buffer.width - this.x);
    const logPanel = this.tabs.getContent('log');
    const followsLog = logPanel.scrollY === logPanel.maxScrollY();
    this.tabs.x = left;
    this.tabs.resize(right - left, STANDARD_UI_HEIGHT - 1);
    const portrait = this.dialoguePanel.portraitBox;
    const rightPortrait = this.dialoguePanel.rightPortraitBox;
    const portraitVisible = portrait.visible;
    const rightVisible = rightPortrait.visible;
    const gap = 1;
    const leftWidth = portraitVisible && (this.dialoguePanel.twoSpeakers || this.dialoguePanel.portraitSide === 'left')
      ? portrait.width + gap : 0;
    const rightWidth = rightVisible ? rightPortrait.width + gap
      : portraitVisible && this.dialoguePanel.portraitSide === 'right' ? portrait.width + gap : 0;
    const hasRoom = right - left >= leftWidth + rightWidth + 20;
    this.dialoguePanel.reservePortraitSpace = portraitVisible && !hasRoom;
    this.dialoguePanel.x = left + (hasRoom ? leftWidth : 0);
    this.dialoguePanel.resize(
      right - left - (hasRoom ? leftWidth + rightWidth : 0),
      Math.min(STANDARD_UI_HEIGHT - 1, buffer.height - (this.y + this.ui.y + this.dialoguePanel.y)),
    );
    this.choiceMessage.width = Math.max(1, logPanel.innerWidth - 2);
    this.choiceMessage.visible = this.choiceMessage.text.length > 0;
    this.scriptLog.y = this.choiceMessage.visible ? this.choiceMessage.y + this.choiceMessage.lines.length + 1 : 1;
    this.scriptLog.width = this.choiceMessage.width;
    this.scriptLog.lineColors = this.logEntries.flatMap((entry) =>
      wrapParagraph(entry.message, this.scriptLog.width).map(() =>
        entry.error ? ERROR_LOG_FG : this.scriptLog.fg,
      ),
    );
    this.scriptLog.visible = this.logEntries.length > 0;
    this.scriptLog.height = this.scriptLog.lines.length;
    if (followsLog) logPanel.scrollToEnd();
    this.dialoguePanel.visible = this.conversationOpen || this.message.text.length > 0;
    this.tabs.visible = !this.dialoguePanel.visible;
    super.render(buffer);
    this.dialoguePanel.drawPortrait(
      DrawContext.createFromBuffer(buffer),
      this.x + this.ui.x + (hasRoom
        ? leftWidth ? left : right - portrait.width
        : this.dialoguePanel.portraitSide === 'left' ? left + 2 : right - portrait.width - 2),
      Math.min(buffer.height - 1, this.y + this.ui.y + this.ui.height - 1),
    );
    this.dialoguePanel.drawPortrait(
      DrawContext.createFromBuffer(buffer),
      this.x + this.ui.x + right - rightPortrait.width - (hasRoom ? 0 : 2),
      Math.min(buffer.height - 1, this.y + this.ui.y + this.ui.height - 1),
      'right',
    );
  }

  protected paint(ctx: DrawContext): void {
    for (let y = 0; y < STANDARD_WORLD_HEIGHT; y++) {
      for (let x = 0; x < STANDARD_WIDTH; x++) ctx.set(x, y, STANDARD_BACKGROUND);
    }
    const world = renderView(this.scene, STANDARD_WIDTH, STANDARD_WORLD_HEIGHT);
    for (let y = 0; y < world.height; y++) {
      for (let x = 0; x < world.width; x++) ctx.set(x, y, world.get(x, y));
    }
  }
}
