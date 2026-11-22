import type { ChoicePrompt } from '../../game/rpgscript/runtime.js';
import { BorderBox } from './border-box.js';
import { Button } from './button.js';
import { ParagraphWrapped } from './paragraph-wrapped.js';
import { UI_INK } from './standard-ui.js';

const PANEL_WIDTH = 60;
const BUTTON_HEIGHT = 3;

export class ChoicePanel extends BorderBox {
  private choice?: ChoicePrompt;
  private readonly question = new ParagraphWrapped('script-choice-question', 1, 0, 1, '', {
    ...UI_INK, visible: false,
  });
  private buttons: Button[] = [];

  constructor() {
    super('script-choices', 0, 0, PANEL_WIDTH, 2, { ...UI_INK, border: 'single', visible: false });
    this.addChild(this.question);
  }

  setChoices(choice?: ChoicePrompt): void {
    if (choice === this.choice) return;
    this.choice = choice;
    this.visible = !!choice?.options.length;
    this.question.text = choice?.question ?? '';
    this.question.visible = this.question.text.trim().length > 0;
    for (const button of this.buttons) this.removeChild(button);
    this.buttons = choice?.options.map((option, index) => {
      const button = new Button(`script-choice-${index + 1}`, 1, 0, 12, `${index + 1}. ${option}`, UI_INK);
      this.addChild(button);
      return button;
    }) ?? [];
    this.scrollY = 0;
  }

  resize(availableWidth: number, preferredHeight: number, maxHeight: number): void {
    const count = this.buttons.length;
    if (!count) return;
    this.width = Math.min(PANEL_WIDTH, availableWidth);
    this.question.width = this.innerWidth - 2;
    const questionHeight = this.question.visible ? this.question.lines.length : 0;
    const headerHeight = questionHeight + 2;
    const buttonHeight = headerHeight + count * BUTTON_HEIGHT <= preferredHeight ? BUTTON_HEIGHT : 1;
    this.height = Math.min(maxHeight, headerHeight + count * buttonHeight);
    this.buttons.forEach((button, index) => {
      button.y = questionHeight + index * buttonHeight;
      button.width = Math.min(this.question.width, Math.max(12, button.text.length + 4));
      button.height = buttonHeight;
    });
  }

  getChoiceAt(x: number, y: number): number | undefined {
    if (!this.visible || !this.enabled || x < 1 || x >= this.width - 1 || y < 1 || y >= this.height - 1) return;
    const contentX = x - 1;
    const contentY = y - 1 + this.scrollY;
    const index = this.buttons.findIndex((button) =>
      contentX >= button.x && contentX < button.x + button.width &&
      contentY >= button.y && contentY < button.y + button.height,
    );
    if (index >= 0) return index;
  }
}
