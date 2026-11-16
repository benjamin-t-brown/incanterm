import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createPanelResizer } from '../panel-resizer.js';
import { projectStorage } from '../project.js';

vi.mock('../project.js', () => ({
  projectStorage: { getItem: vi.fn(() => null), setItem: vi.fn() },
}));

let notifyResize: () => void;
const disconnectObserver = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(projectStorage.getItem).mockReturnValue(null);
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: () => void) {
        notifyResize = callback;
      }
      observe = vi.fn();
      disconnect = disconnectObserver;
    },
  );
});
afterEach(() => vi.unstubAllGlobals());

type ResizeEvent = {
  button?: number;
  pointerId?: number;
  clientX?: number;
  key?: string;
  shiftKey?: boolean;
  preventDefault?: () => void;
};

function createResizableSheetPicker() {
  let width = 0;
  const container = { clientWidth: 600 };
  const attributes = new Map<string, string>();
  const styles = new Map<string, string>();
  const listeners = new Map<string, (event: ResizeEvent) => void>();
  const panel = { getBoundingClientRect: () => ({ width }) };
  const handle = {
    setAttribute: (name: string, value: string) => attributes.set(name, value),
    addEventListener: (name: string, listener: (event: ResizeEvent) => void) =>
      listeners.set(name, listener),
    setPointerCapture: vi.fn(),
    classList: { add: vi.fn(), remove: vi.fn() },
  };
  const cleanup = createPanelResizer({
    container: container as unknown as HTMLElement,
    panel: panel as unknown as HTMLElement,
    handle: handle as unknown as HTMLElement,
    storageKey: 'incanterm-animation-sheet-list-width',
    defaultWidth: 180,
    reserve: 140,
    applyWidth: (next) => {
      width = next;
      styles.set('--anim-sheet-list-width', `${next}px`);
    },
  });
  function dispatchResizeEvent(name: string, event: ResizeEvent = {}): void {
    listeners.get(name)?.({ ...event, preventDefault: vi.fn() });
  }
  return { container, attributes, styles, handle, cleanup, dispatchResizeEvent };
}

it('restores the saved sheet-list width without writing it back on mount', () => {
  vi.mocked(projectStorage.getItem).mockReturnValue('260');
  const view = createResizableSheetPicker();
  expect(view.styles.get('--anim-sheet-list-width')).toBe('260px');
  expect(view.attributes.get('aria-valuenow')).toBe('260');
  expect(projectStorage.setItem).not.toHaveBeenCalled();
  view.cleanup();
  expect(disconnectObserver).toHaveBeenCalledOnce();
});

it('drags the divider and persists the new width when released', () => {
  const view = createResizableSheetPicker();
  view.dispatchResizeEvent('pointerdown', { button: 0, pointerId: 1, clientX: 200 });
  expect(view.handle.setPointerCapture).toHaveBeenCalledWith(1);
  view.dispatchResizeEvent('pointermove', { pointerId: 1, clientX: 310 });
  expect(view.styles.get('--anim-sheet-list-width')).toBe('290px');
  expect(projectStorage.setItem).not.toHaveBeenCalled();
  view.dispatchResizeEvent('pointerup', { pointerId: 1 });
  expect(projectStorage.setItem).toHaveBeenCalledWith(
    'incanterm-animation-sheet-list-width',
    '290',
  );
});

it('supports keyboard resizing and double-click reset', () => {
  const view = createResizableSheetPicker();
  view.dispatchResizeEvent('keydown', { key: 'ArrowRight' });
  expect(view.styles.get('--anim-sheet-list-width')).toBe('190px');
  view.dispatchResizeEvent('keydown', { key: 'ArrowRight', shiftKey: true });
  expect(view.styles.get('--anim-sheet-list-width')).toBe('230px');
  view.dispatchResizeEvent('dblclick');
  expect(view.styles.get('--anim-sheet-list-width')).toBe('180px');
  view.dispatchResizeEvent('keydown', { key: 'ArrowLeft' });
  view.dispatchResizeEvent('keydown', { key: 'Home' });
  expect(view.styles.get('--anim-sheet-list-width')).toBe('180px');
});

it('keeps room for frames and reclamps the list when its container shrinks', () => {
  vi.mocked(projectStorage.getItem).mockReturnValue('900');
  const view = createResizableSheetPicker();
  expect(view.styles.get('--anim-sheet-list-width')).toBe('460px');
  view.container.clientWidth = 400;
  notifyResize();
  expect(view.styles.get('--anim-sheet-list-width')).toBe('260px');
  expect(view.attributes.get('aria-valuemax')).toBe('260');
  view.dispatchResizeEvent('pointerdown', { button: 0, pointerId: 1, clientX: 200 });
  view.dispatchResizeEvent('pointermove', { pointerId: 1, clientX: -100 });
  expect(view.styles.get('--anim-sheet-list-width')).toBe('160px');
});
