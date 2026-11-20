import type { CellBuffer, Cell } from '../../game/cell-buffer.js';
import type { Character } from '../../game/character.js';
import { renderView, type Scene } from '../../game/scene.js';
import { UIElement, DrawContext } from './element.js';
import { ParagraphWrapped, wrapParagraph } from './paragraph-wrapped.js';
import { TabbedView } from './tabbed-view.js';
import { DialoguePanel } from './dialogue-panel.js';
import type { Rect } from './element.js';
import type { DialogueMessage } from './dialogue-message.js';
import type { SelectionRect } from '../../protocol/messages.js';
import { CenterToast } from './center-toast.js';
import { InventoryPanel } from './inventory-panel.js';
import { BorderBox } from './border-box.js';
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
export const BARK_MAX_WIDTH = 20;
type Bark = { character: Character; lines: string[]; remainingMs: number };
export const ERROR_LOG_FG = { r: 255, g: 64, b: 64 };

export class LayoutStandardScene extends UIElement {
  readonly ui: UIElement;
  readonly tabs: TabbedView;
  readonly dialoguePanel: DialoguePanel;
  readonly centerToast = new CenterToast();
  readonly message: DialogueMessage;
  readonly choiceMessage: ParagraphWrapped;
  readonly scriptLog: ParagraphWrapped;
  readonly inventory = new InventoryPanel();
  readonly logWindow = new BorderBox('log-window', 1, 1, 2, 2, {
    fg: UI_INK.fg, bg: UI_INK.bg, visible: false,
  });
  private readonly logWindowText = new ParagraphWrapped('log-window-text', 1, 0, 1, '', {
    fg: UI_INK.fg, bg: UI_INK.bg,
  });
  conversationOpen = false;
  portraitExitVisible = false;
  private readonly logEntries: { message: string; error: boolean }[] = [];
  private viewportWidth = 0;
  private viewportHeight = 0;
  private canClick = false;
  private barks: Bark[] = [];

  /** Returns a predicate that is true once the bark has expired, been replaced, or been cleared. */
  addBark(character: Character, text: string, ms: number): () => boolean {
    this.barks = this.barks.filter((bark) => bark.character !== character);
    const bark = { character, lines: wrapParagraph(text, BARK_MAX_WIDTH), remainingMs: ms };
    this.barks.push(bark);
    return () => !this.barks.includes(bark);
  }

  updateBarks(deltaMs: number): void {
    for (const bark of this.barks) bark.remainingMs -= deltaMs;
    this.barks = this.barks.filter((bark) => bark.remainingMs > 0);
  }

  clearBarks(): void {
    this.barks = [];
  }

  clearBark(character: Character): void {
    this.barks = this.barks.filter((bark) => bark.character !== character);
  }

  private renderBarks(buffer: CellBuffer): void {
    const originX = this.x + Math.floor((STANDARD_WIDTH - this.scene.width) / 2);
    const originY = this.y + Math.floor((STANDARD_WORLD_HEIGHT - this.scene.height) / 2);
    const minY = Math.max(0, this.y);
    const maxY = Math.min(buffer.height, this.y + STANDARD_WORLD_HEIGHT);
    for (const bark of this.barks) {
      const { sprite } = bark.character;
      const width = Math.max(...bark.lines.map((line) => line.length));
      const centerX = originX + bark.character.x - sprite.originX + Math.floor(sprite.width / 2);
      const left = Math.min(
        Math.max(this.x, centerX - Math.floor(width / 2)),
        this.x + STANDARD_WIDTH - width,
      );
      const bottom = originY + bark.character.y - sprite.originY - 1;
      const top = Math.max(minY, bottom - bark.lines.length + 1);
      bark.lines.forEach((line, index) => {
        const y = top + index;
        if (y >= maxY || y < minY) return;
        const pad = Math.floor((width - line.length) / 2);
        for (let i = 0; i < line.length; i++) {
          const x = left + pad + i;
          if (x < 0 || x >= buffer.width || line[i] === ' ') continue;
          buffer.set(x, y, { ...UI_INK, ch: line[i] });
        }
      });
    }
  }

  getScenePoint(x: number, y: number): { x: number; y: number } | undefined {
    const portrait = this.dialoguePanel.portraitBox;
    const rightPortrait = this.dialoguePanel.rightPortraitBox;
    if (
      !this.canClick ||
      this.logWindow.visible ||
      this.centerToast.visible ||
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
    this.tabs.getContent('inventory').addChild(this.inventory);
    this.ui.addChild(this.tabs);
    this.ui.addChild(this.dialoguePanel);
    this.addChild(this.ui);
    this.logWindow.addChild(this.logWindowText);
  }

  toggleLogWindow(): void {
    this.logWindow.visible = !this.logWindow.visible;
    if (this.logWindow.visible) this.logWindow.scrollToEnd();
  }

  appendLog(message: string, error = false): void {
    this.logEntries.push({ message, error });
    if (this.logEntries.length > MAX_LOG_ENTRIES) this.logEntries.shift();
    this.scriptLog.text = this.logEntries.map((entry) => entry.message).join('\n');
    this.tabs.getContent('log').scrollToEnd();
  }

  getLogSelectionRect(): SelectionRect | undefined {
    if (this.logWindow.visible) return {
      x: this.logWindow.x + 1, y: this.logWindow.y + 1,
      width: Math.max(0, Math.min(this.logWindow.innerWidth, this.viewportWidth - this.logWindow.x - 1)),
      height: Math.max(0, Math.min(this.logWindow.innerHeight, this.viewportHeight - this.logWindow.y - 1)),
    };
    if (!this.canClick || !this.ui.visible || !this.tabs.visible ||
      this.tabs.selectedId !== 'log' || this.centerToast.visible) return;
    const content = this.tabs.getContent('log');
    const x = this.x + this.ui.x + this.tabs.x + content.x + 1;
    const y = this.y + this.ui.y + this.tabs.y + content.y + 1;
    const left = Math.max(0, x);
    const top = Math.max(0, y);
    return {
      x: left,
      y: top,
      width: Math.max(0, Math.min(this.viewportWidth, x + content.innerWidth) - left),
      height: Math.max(0, Math.min(this.viewportHeight, y + content.innerHeight) - top),
    };
  }

  getInventoryActionAt(x: number, y: number): ReturnType<InventoryPanel['getActionAt']> {
    if (this.logWindow.visible || !this.canClick || !this.ui.visible || !this.tabs.visible ||
      this.tabs.selectedId !== 'inventory' || this.centerToast.visible ||
      x < 0 || y < 0 || x >= this.viewportWidth || y >= this.viewportHeight) return;
    const pane = this.tabs.getContent('inventory');
    const left = this.x + this.ui.x + this.tabs.x + pane.x;
    const top = this.y + this.ui.y + this.tabs.y + pane.y;
    if (x < left + 1 || x >= left + pane.width - 1 || y < top + 1 || y >= top + pane.height - 1) return;
    return this.inventory.getActionAt(
      x - left - 1 - this.inventory.x,
      y - top - 1 + pane.scrollY - this.inventory.y,
    );
  }

  getTabAt(x: number, y: number): string | undefined {
    if (this.logWindow.visible || !this.canClick || !this.ui.visible || !this.tabs.visible || this.centerToast.visible ||
      x < 0 || y < 0 || x >= this.viewportWidth || y >= this.viewportHeight) return;
    return this.tabs.getTabAt(x - this.x - this.ui.x - this.tabs.x, y - this.y - this.ui.y - this.tabs.y);
  }

  /** The portrait image cells, excluding the rounded frame; coordinates are on the final screen. */
  getPortraitScreenRect(side: 'left' | 'right' = 'left'): Rect | undefined {
    const box = side === 'left' ? this.dialoguePanel.portraitBox : this.dialoguePanel.rightPortraitBox;
    if (this.logWindow.visible || !this.canClick || (!this.dialoguePanel.visible && !this.portraitExitVisible) || !box.visible) return;
    return { x: box.x + 1, y: box.y + 1, width: box.width - 2, height: box.height - 2 };
  }

  /** Convert a scene-local rectangle to final screen coordinates, including viewport centering. */
  getSceneScreenRect(area: Readonly<Rect> = { x: 0, y: 0, width: this.scene.width, height: this.scene.height }): Rect | undefined {
    if (this.logWindow.visible || !this.canClick) return;
    return {
      x: this.x + Math.floor((STANDARD_WIDTH - this.scene.width) / 2) + area.x,
      y: this.y + Math.floor((STANDARD_WORLD_HEIGHT - this.scene.height) / 2) + area.y,
      width: area.width,
      height: area.height,
    };
  }

  render(buffer: CellBuffer): void {
    this.viewportWidth = buffer.width;
    this.viewportHeight = buffer.height;
    this.canClick = buffer.width >= MIN_STANDARD_WIDTH && buffer.height >= MIN_STANDARD_HEIGHT;
    if (this.logWindow.visible) {
      this.renderLogWindow(buffer);
      return;
    }
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
    this.inventory.width = Math.max(1, this.tabs.getContent('inventory').innerWidth);
    this.inventory.height = Math.max(3, 2 + this.inventory.items.length * 4);
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
    this.dialoguePanel.setEmptyBackground(this.message.text.length === 0);
    this.dialoguePanel.portraitExitVisible = this.portraitExitVisible;
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
    this.renderBarks(buffer);
    if (this.centerToast.visible) this.centerToast.render(buffer);
  }

  private renderLogWindow(buffer: CellBuffer): void {
    const followsLog = this.logWindow.scrollY === this.logWindow.maxScrollY();
    this.logWindow.x = buffer.width >= 4 ? 1 : 0;
    this.logWindow.y = buffer.height >= 4 ? 1 : 0;
    this.logWindow.width = Math.max(2, buffer.width - 2);
    this.logWindow.height = Math.max(2, buffer.height - 2);
    this.logWindowText.width = Math.max(1, this.logWindow.innerWidth - 2);
    this.logWindowText.text = this.logEntries.length
      ? this.logEntries.map((entry) => entry.message).join('\n') : 'No log entries yet.';
    this.logWindowText.lineColors = this.logEntries.flatMap((entry) =>
      wrapParagraph(entry.message, this.logWindowText.width).map(() =>
        entry.error ? ERROR_LOG_FG : this.logWindowText.fg,
      ),
    );
    this.logWindowText.height = this.logWindowText.lines.length;
    if (followsLog) this.logWindow.scrollToEnd();
    this.logWindow.render(buffer);
    const title = ' Log | ` to return ';
    for (let i = 0; i < Math.min(title.length, this.logWindow.innerWidth); i++)
      buffer.set(this.logWindow.x + 1 + i, this.logWindow.y, { ...UI_INK, ch: title[i] });
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
