import { Button } from './button.js';
import { type DrawContext, UIElement } from './element.js';
import { UI_INK } from './standard-ui.js';

const slots = [
  ['Up', 12, 1], ['Left', 0, 4], ['Cancel', 12, 4], ['Right', 24, 4], ['Down', 12, 7],
] as const;
const muted = { r: 106, g: 113, b: 118 };

export class PushDirectionPad extends UIElement {
  private readonly buttons = slots.map(([label, x, y]) => {
    const button = new Button(`push-${label.toLowerCase()}`, x, y, 11, label, UI_INK);
    this.addChild(button);
    return { label, button, index: -1 };
  });

  constructor() {
    super('push-directions', 0, 1, 35, 10, { visible: false });
  }

  setChoices(options?: readonly string[]): void {
    this.visible = !!options?.length;
    if (!this.visible) return;
    for (const slot of this.buttons) {
      slot.index = options?.indexOf(slot.label) ?? -1;
      slot.button.enabled = slot.index >= 0;
      slot.button.text = slot.button.enabled ? `${slot.index + 1}. ${slot.label}` : slot.label;
      slot.button.fg = slot.button.enabled ? UI_INK.fg : muted;
    }
  }

  getChoiceAt(x: number, y: number): number | undefined {
    if (!this.visible) return;
    return this.buttons.find(({ button }) => button.enabled &&
      x >= button.x && x < button.x + button.width && y >= button.y && y < button.y + button.height)?.index;
  }

  protected paint(ctx: DrawContext): void {
    const title = 'Push direction';
    for (let i = 0; i < title.length; i++)
      ctx.set(Math.floor((this.width - title.length) / 2) + i, 0, { ...UI_INK, ch: title[i] });
  }
}
