import { expect, it, vi } from 'vitest';
import { renderTabReordering } from '../tab-reordering.js';
import { TestElement } from './dom-fixture.js';

class TabTestElement extends TestElement {
  scrollLeft = 0;

  getBoundingClientRect() {
    return { left: 100, width: 100 };
  }
}

function createDragTransfer(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    types: [...data.keys()],
    effectAllowed: 'uninitialized',
    dropEffect: 'none',
    getData: (type: string) => data.get(type) ?? '',
    setData(type: string, value: string) {
      data.set(type, value);
      this.types = [...data.keys()];
    },
  };
}

function dispatchDragEvent(
  tab: TestElement,
  type: string,
  dataTransfer: ReturnType<typeof createDragTransfer>,
  clientX = 110,
) {
  const event = {
    target: tab,
    dataTransfer,
    clientX,
    relatedTarget: null,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
  };
  for (const listener of tab.listeners.get(type) ?? []) listener(event);
  return event;
}

function createTabStrip(initial: string[] = ['zebra', 'alpha', 'middle']) {
  const host = new TabTestElement();
  let tabs = initial;
  const onReorder = vi.fn((next: string[]) => {
    tabs = next;
    render();
  });
  function render(): void {
    host.replaceChildren(
      ...tabs.map((id) => {
        const tab = new TabTestElement();
        tab.dataset.tabId = id;
        tab.className = 'editor-document-tab';
        tab.setAttribute('role', 'tab');
        tab.setAttribute('aria-selected', String(id === 'alpha'));
        return tab;
      }),
    );
    bindTabs();
  }
  function bindTabs(): void {
    renderTabReordering(host as unknown as HTMLElement, { tabs, onReorder });
  }
  function getTab(id: string): TestElement {
    const tab = host.children.find((child) => child.dataset.tabId === id);
    if (!tab) throw new Error(`Missing tab ${id}`);
    return tab;
  }
  function setTabs(next: string[]): void {
    tabs = next;
    render();
  }
  render();
  return { host, onReorder, getTab, setTabs, bindTabs };
}

it.each([
  {
    source: 'middle',
    target: 'zebra',
    x: 110,
    side: 'before',
    expected: ['middle', 'zebra', 'alpha'],
  },
  {
    source: 'zebra',
    target: 'middle',
    x: 190,
    side: 'after',
    expected: ['alpha', 'middle', 'zebra'],
  },
])(
  'drags $source $side $target without changing selection',
  ({ source, target, x, side, expected }) => {
    const { host, getTab, onReorder } = createTabStrip();
    const transfer = createDragTransfer();
    expect(host.children.every((tab) => tab.draggable)).toBe(true);
    dispatchDragEvent(getTab(source), 'dragstart', transfer);
    expect(transfer.effectAllowed).toBe('move');
    expect(transfer.getData('application/x-incanterm-tab')).toBe(source);
    // Payloads are protected during native dragover events.
    const over = dispatchDragEvent(
      getTab(target),
      'dragover',
      { ...transfer, getData: () => '' },
      x,
    );
    expect(over.preventDefault).toHaveBeenCalled();
    expect(getTab(target).className).toContain(`editor-tab-drop-${side}`);
    dispatchDragEvent(getTab(target), 'drop', transfer, x);
    expect(onReorder).toHaveBeenCalledExactlyOnceWith(expected);
    expect(host.children.map((tab) => tab.dataset.tabId)).toEqual(expected);
    expect(getTab('alpha').attributes.get('aria-selected')).toBe('true');
    expect(host.children.every((tab) => !tab.className.includes('editor-tab-drop-'))).toBe(true);
  },
);

it('clears insertion indicators when leaving a tab or cancelling a drag', () => {
  const { host, getTab, onReorder } = createTabStrip();
  const transfer = createDragTransfer();
  dispatchDragEvent(getTab('zebra'), 'dragstart', transfer);
  dispatchDragEvent(getTab('alpha'), 'dragover', transfer);
  dispatchDragEvent(getTab('alpha'), 'dragleave', transfer);
  expect(getTab('alpha').className).not.toContain('editor-tab-drop-');
  dispatchDragEvent(getTab('middle'), 'dragover', transfer, 190);
  dispatchDragEvent(getTab('zebra'), 'dragend', transfer);
  expect(host.children.every((tab) => !tab.className.includes('editor-tab-drop-'))).toBe(true);
  expect(getTab('zebra').className).not.toContain('editor-tab-dragging');
  expect(
    dispatchDragEvent(getTab('middle'), 'dragover', transfer).preventDefault,
  ).not.toHaveBeenCalled();
  expect(onReorder).not.toHaveBeenCalled();
});

it('ignores self drops and moves that would not change the order', () => {
  const { getTab, onReorder } = createTabStrip();
  const transfer = createDragTransfer();
  dispatchDragEvent(getTab('zebra'), 'dragstart', transfer);
  expect(
    dispatchDragEvent(getTab('zebra'), 'dragover', transfer).preventDefault,
  ).not.toHaveBeenCalled();
  dispatchDragEvent(getTab('zebra'), 'drop', transfer);
  dispatchDragEvent(getTab('zebra'), 'dragstart', transfer);
  dispatchDragEvent(getTab('alpha'), 'drop', transfer);
  expect(onReorder).not.toHaveBeenCalled();
});

it('rejects tab drags from another strip and ignores asset drags', () => {
  const first = createTabStrip();
  const second = createTabStrip();
  const transfer = createDragTransfer();
  dispatchDragEvent(first.getTab('zebra'), 'dragstart', transfer);
  expect(
    dispatchDragEvent(second.getTab('alpha'), 'dragover', transfer).preventDefault,
  ).not.toHaveBeenCalled();
  expect(transfer.dropEffect).toBe('none');
  dispatchDragEvent(second.getTab('alpha'), 'drop', transfer);
  const asset = createDragTransfer({ 'application/x-incanterm-asset': 'zebra' });
  expect(
    dispatchDragEvent(first.getTab('alpha'), 'dragover', asset).preventDefault,
  ).not.toHaveBeenCalled();
  dispatchDragEvent(first.getTab('alpha'), 'drop', asset);
  expect(first.onReorder).not.toHaveBeenCalled();
  expect(second.onReorder).not.toHaveBeenCalled();
});

it('does not move a tab removed while dragging and binds each element only once', () => {
  const { getTab, setTabs, bindTabs, onReorder } = createTabStrip();
  bindTabs();
  expect(getTab('zebra').listeners.get('dragstart')).toHaveLength(1);
  const transfer = createDragTransfer();
  dispatchDragEvent(getTab('zebra'), 'dragstart', transfer);
  setTabs(['alpha', 'middle']);
  expect(
    dispatchDragEvent(getTab('middle'), 'dragover', transfer).preventDefault,
  ).not.toHaveBeenCalled();
  dispatchDragEvent(getTab('middle'), 'drop', transfer);
  expect(onReorder).not.toHaveBeenCalled();
});

it('scrolls back to reveal newly prepended tabs but preserves scrolling for other updates', () => {
  const { host, setTabs } = createTabStrip();
  host.scrollLeft = 250;
  setTabs(['zebra', 'middle', 'alpha']);
  expect(host.scrollLeft).toBe(250);
  setTabs(['new', 'zebra', 'middle', 'alpha']);
  expect(host.scrollLeft).toBe(0);
});
