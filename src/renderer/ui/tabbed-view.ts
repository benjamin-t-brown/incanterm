import { BorderBox } from './border-box.js';
import { Button } from './button.js';
import type { Rgb } from '../../game/color.js';
import { UIElement } from './element.js';

export type TabDefinition = { id: string; label: string };

export class TabbedView extends UIElement {
  private readonly tabs: {
    id: string;
    button: Button;
    content: BorderBox;
  }[] = [];
  private activeIndex = 0;

  constructor(
    id: string,
    x: number,
    y: number,
    width: number,
    height: number,
    tabs: TabDefinition[],
    options?: { fg?: Rgb; bg?: Rgb },
  ) {
    super(id, x, y, width, height);
    if (!tabs.length) throw new Error('TabbedView needs at least one tab');
    if (height < 6) throw new Error('TabbedView needs at least six rows');

    let buttonX = 0;
    for (const tab of tabs) {
      if (this.tabs.some((existing) => existing.id === tab.id))
        throw new Error(`Duplicate tab ${tab.id}`);
      const buttonWidth = Math.max(3, tab.label.length + 4);
      if (buttonX + buttonWidth > width) throw new Error('TabbedView tabs exceed its width');
      const button = new Button(`${id}-${tab.id}-tab`, buttonX, 0, buttonWidth, tab.label, options);
      const content = new BorderBox(`${id}-${tab.id}-content`, 0, 3, width, height - 3, {
        border: 'single',
        ...options,
      });
      this.tabs.push({ id: tab.id, button, content });
      this.addChild(button);
      this.addChild(content);
      buttonX += buttonWidth + 1;
    }
    this.select(tabs[0].id);
  }

  get selectedId(): string {
    return this.tabs[this.activeIndex].id;
  }

  content(id: string): BorderBox {
    const tab = this.tabs.find((entry) => entry.id === id);
    if (!tab) throw new Error(`Unknown tab ${id}`);
    return tab.content;
  }

  select(id: string): void {
    const index = this.tabs.findIndex((entry) => entry.id === id);
    if (index < 0) throw new Error(`Unknown tab ${id}`);
    this.activeIndex = index;
    for (const [i, tab] of this.tabs.entries()) {
      tab.button.border = i === index ? 'double' : 'single';
      tab.content.visible = i === index;
    }
  }

  selectNext(direction = 1): void {
    const index = (this.activeIndex + direction + this.tabs.length) % this.tabs.length;
    this.select(this.tabs[index].id);
  }

  scrollBy(rows: number): void {
    const content = this.tabs[this.activeIndex].content;
    content.scrollY += rows;
  }

  resize(width: number, height: number): void {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 2 || height < 6)
      throw new Error('TabbedView needs at least 2 columns and six rows');
    const lastButton = this.tabs[this.tabs.length - 1].button;
    if (lastButton.x + lastButton.width > width)
      throw new Error('TabbedView tabs exceed its width');
    this.width = width;
    this.height = height;
    for (const tab of this.tabs) {
      tab.content.width = width;
      tab.content.height = height - 3;
      tab.content.scrollY = Math.min(tab.content.scrollY, tab.content.maxScrollY());
    }
  }
}
