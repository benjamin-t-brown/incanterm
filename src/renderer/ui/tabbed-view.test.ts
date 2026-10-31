import { describe, expect, it } from 'vitest';
import { CellBuffer, type Cell } from '../../game/cell-buffer.js';
import { plainText } from '../../game/terminal.js';
import { UIElement, type DrawContext } from './element.js';
import { TabbedView } from './tabbed-view.js';

const ink: Cell = { ch: ' ', fg: { r: 255, g: 255, b: 255 }, bg: { r: 0, g: 0, b: 0 } };
const definitions = [
  { id: 'log', label: 'Log' },
  { id: 'inventory', label: 'Inventory' },
  { id: 'menu', label: 'Menu' },
];

function lines(tabs: TabbedView): string[] {
  const buffer = new CellBuffer(tabs.width, tabs.height, ink);
  tabs.render(buffer);
  return plainText(buffer).split('\n');
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
    expect(lines(tabs)[0].slice(0, 30)).toBe('╔═════╗ ┌───────────┐ ┌──────┐');
    expect(lines(tabs)[1]).toContain('Log');
    expect(lines(tabs)[1]).toContain('Inventory');
    expect(lines(tabs)[1]).toContain('Menu');
    expect(lines(tabs)[3][0]).toBe('┌');
    expect(lines(tabs)[14][0]).toBe('└');

    tabs.select('inventory');
    expect(lines(tabs)[0].slice(0, 30)).toBe('┌─────┐ ╔═══════════╗ ┌──────┐');
    expect(tabs.content('log').visible).toBe(false);
    expect(tabs.content('inventory').visible).toBe(true);
    tabs.selectNext();
    expect(tabs.selectedId).toBe('menu');
    tabs.selectNext();
    expect(tabs.selectedId).toBe('log');
  });

  it('clips each pane, scrolls overflow, and retains independent scroll positions', () => {
    const tabs = new TabbedView('tabs', 0, 0, 40, 15, definitions);
    tabs.content('log').addChild(new Rows('log-rows', 14));
    tabs.content('inventory').addChild(new Rows('inventory-rows', 11));
    expect(tabs.content('log').innerHeight).toBe(10);
    expect(lines(tabs)[4][1]).toBe('A');
    tabs.scrollBy(99);
    expect(tabs.content('log').scrollY).toBe(4);
    expect(lines(tabs)[4][1]).toBe('E');
    expect(lines(tabs)[13][1]).toBe('N');
    expect(lines(tabs)[14][1]).toBe('─');

    tabs.select('inventory');
    expect(lines(tabs)[4][1]).toBe('A');
    tabs.scrollBy(1);
    expect(lines(tabs)[4][1]).toBe('B');
    tabs.select('log');
    expect(lines(tabs)[4][1]).toBe('E');
    tabs.resize(40, 12);
    expect(tabs.content('log').height).toBe(9);
    expect(tabs.content('log').scrollY).toBe(4);
  });

  it('rejects duplicate tabs and headers wider than the available area', () => {
    expect(() => new TabbedView('tabs', 0, 0, 40, 15, [definitions[0], definitions[0]])).toThrow(
      'Duplicate tab log',
    );
    expect(() => new TabbedView('tabs', 0, 0, 20, 15, definitions)).toThrow('exceed');
  });
});
