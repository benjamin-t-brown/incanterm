import { afterEach, expect, it, vi } from 'vitest';
import { getSideTabs, renderTabCloseActions } from '../tab-close-actions.js';

afterEach(() => vi.unstubAllGlobals());

it('finds only the tabs on the requested side of the selection', () => {
  const tabs = ['a', 'b', 'c', 'd'];
  expect(getSideTabs(tabs, 'b', 'left')).toEqual(['a']);
  expect(getSideTabs(tabs, 'b', 'right')).toEqual(['c', 'd']);
  expect(getSideTabs(tabs, 'a', 'left')).toEqual([]);
  expect(getSideTabs(tabs, 'd', 'right')).toEqual([]);
  expect(getSideTabs(tabs, null, 'left')).toEqual([]);
  expect(getSideTabs(tabs, 'missing', 'right')).toEqual([]);
  expect(tabs).toEqual(['a', 'b', 'c', 'd']);
});

function createElement() {
  return {
    className: '',
    disabled: false,
    append: vi.fn(),
    before: vi.fn(),
    setAttribute: vi.fn(),
    addEventListener: vi.fn<(type: string, listener: () => void) => void>(),
  };
}

function createTestControls(tabs: string[], active: string | null, cancelId?: string) {
  const elements: ReturnType<typeof createElement>[] = [];
  function createTrackedElement() {
    const element = createElement();
    elements.push(element);
    return element;
  }
  vi.stubGlobal('document', { createElement: createTrackedElement });
  const host = createTrackedElement() as unknown as HTMLElement;
  const closeTab = vi.fn(async (id: string) => {
    if (id === cancelId) return;
    tabs = tabs.filter((tab) => tab !== id);
    renderTabCloseActions(host, { tabs, active, closeTab });
  });
  renderTabCloseActions(host, { tabs, active, closeTab });
  const left = elements[3];
  const right = elements[4];
  async function clickButton(button: typeof left) {
    const listener = button.addEventListener.mock.calls[0][1] as () => void;
    listener();
    await vi.waitFor(() => expect(button.disabled).toBe(false));
  }
  return { host, left, right, closeTab, clickButton, elements };
}

it('disables actions with no neighboring tabs and reuses the controls on rerender', () => {
  const { host, left, right, closeTab, elements } = createTestControls(['a'], 'a');
  expect(left.disabled).toBe(true);
  expect(right.disabled).toBe(true);
  renderTabCloseActions(host, { tabs: ['a', 'b'], active: 'a', closeTab });
  expect(left.disabled).toBe(true);
  expect(right.disabled).toBe(false);
  expect(elements).toHaveLength(5);
  renderTabCloseActions(host, { tabs: [], active: null, closeTab });
  expect(left.disabled).toBe(true);
  expect(right.disabled).toBe(true);
});

it('closes neighboring tabs sequentially without closing the selected tab', async () => {
  const { left, right, closeTab } = createTestControls(['a', 'b', 'c', 'd'], 'b');
  const listener = right.addEventListener.mock.calls[0][1] as () => void;
  listener();
  expect(left.disabled).toBe(true);
  expect(right.disabled).toBe(true);
  await vi.waitFor(() => expect(left.disabled).toBe(false));
  expect(closeTab.mock.calls).toEqual([['c'], ['d']]);
  expect(right.disabled).toBe(true);
});

it('stops the batch when closing a tab is cancelled', async () => {
  const { left, clickButton, closeTab } = createTestControls(['a', 'b', 'c', 'd'], 'd', 'b');
  await clickButton(left);
  expect(closeTab.mock.calls).toEqual([['a'], ['b']]);
});
