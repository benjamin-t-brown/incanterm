import { describe, expect, it } from 'vitest';
import { CellBuffer, type Cell } from '../../../game/cell-buffer.js';
import { getPlainText } from '../../../game/terminal.js';
import { UIElement, type DrawContext } from '../element.js';
import { TabbedView } from '../tabbed-view.js';

const ink: Cell = { ch: ' ', fg: { r: 255, g: 255, b: 255 }, bg: { r: 0, g: 0, b: 0 } };
const definitions = [
  { id: 'log', label: 'Log' },
  { id: 'inventory', label: 'Inventory' },
  { id: 'menu', label: 'Menu' },
];

function getLines(tabs: TabbedView): string[] {
  const buffer = new CellBuffer(tabs.width, tabs.height, ink);
  tabs.render(buffer);
  return getPlainText(buffer).split('\n');
}

class Rows extends UIElement {
  constructor(id: string, height: number) {
    super(id, 0, 0, 1, height);
  }

  protected paint(ctx: DrawContext): void {
    for (let y = 0; y < this.height; y++)
      ctx.set(0, y, { ...ink, ch: String.fromCharCode(65 + y) });
  }
}

describe('TabbedView', () => {
  it('draws three-row buttons with double borders only on the selected tab', () => {
    const tabs = new TabbedView('tabs', 0, 0, 40, 15, definitions);
    expect(tabs.selectedId).toBe('log');
    expect(getLines(tabs)[0].slice(0, 30)).toBe('╔═════╗ ┌───────────┐ ┌──────┐');
    expect(getLines(tabs)[1]).toContain('Log');
    expect(getLines(tabs)[1]).toContain('Inventory');
    expect(getLines(tabs)[1]).toContain('Menu');
    expect(getLines(tabs)[3][0]).toBe('┌');
    expect(getLines(tabs)[14][0]).toBe('└');

    tabs.select('inventory');
    expect(getLines(tabs)[0].slice(0, 30)).toBe('┌─────┐ ╔═══════════╗ ┌──────┐');
    expect(tabs.getContent('log').visible).toBe(false);
    expect(tabs.getContent('inventory').visible).toBe(true);
    tabs.selectNext();
    expect(tabs.selectedId).toBe('menu');
    tabs.selectNext();
    expect(tabs.selectedId).toBe('log');
  });

  it('clips each pane, scrolls overflow, and retains independent scroll positions', () => {
    const tabs = new TabbedView('tabs', 0, 0, 40, 15, definitions);
    tabs.getContent('log').addChild(new Rows('log-rows', 14));
    tabs.getContent('inventory').addChild(new Rows('inventory-rows', 11));
    expect(tabs.getContent('log').innerHeight).toBe(10);
    expect(getLines(tabs)[4][1]).toBe('A');
    tabs.scrollBy(99);
    expect(tabs.getContent('log').scrollY).toBe(4);
    expect(getLines(tabs)[4][1]).toBe('E');
    expect(getLines(tabs)[13][1]).toBe('N');
    expect(getLines(tabs)[14][1]).toBe('─');

    tabs.select('inventory');
    expect(getLines(tabs)[4][1]).toBe('A');
    tabs.scrollBy(1);
    expect(getLines(tabs)[4][1]).toBe('B');
    tabs.select('log');
    expect(getLines(tabs)[4][1]).toBe('E');
    tabs.resize(40, 12);
    expect(tabs.getContent('log').height).toBe(9);
    expect(tabs.getContent('log').scrollY).toBe(4);
  });

  it('rejects duplicate tabs and headers wider than the available area', () => {
    expect(() => new TabbedView('tabs', 0, 0, 40, 15, [definitions[0], definitions[0]])).toThrow(
      'Duplicate tab log',
    );
    expect(() => new TabbedView('tabs', 0, 0, 20, 15, definitions)).toThrow('exceed');
  });
});
