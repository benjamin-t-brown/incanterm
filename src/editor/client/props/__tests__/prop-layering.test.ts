import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createProp, createSprite } from '../../../schema.js';
import { TestElement } from '../../__tests__/dom-fixture.js';
import { requestJson } from '../../api.js';
import { saveDraft } from '../../save.js';
import { mountProps } from '../props.js';

vi.mock('../../project.js', () => ({
  projectStorage: { getItem: () => null, setItem: vi.fn() },
}));
vi.mock('../../api.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api.js')>()),
  requestJson: vi.fn(),
}));
vi.mock('../../save.js', () => ({ saveDraft: vi.fn() }));
vi.mock('../../shell.js', () => ({
  askId: vi.fn(),
  createPageShell: (_title: string, content: string) => content,
  setDirtyGuard: vi.fn(),
  setEditorAssetUrl: vi.fn(),
}));
vi.mock('../../asset-tree.js', () => ({
  createAssetTree: () => ({ select: vi.fn(), setData: vi.fn(), createFolder: vi.fn() }),
}));
vi.mock('../../panel-resizer.js', () => ({ createPanelResizer: () => vi.fn() }));
vi.mock('../../tab-close-actions.js', () => ({ renderTabCloseActions: vi.fn() }));
vi.mock('../../../terminal-cell.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../terminal-cell.js')>()),
  preloadSpriteFonts: () => Promise.resolve(),
}));

let cleanup: (() => void) | undefined;
let elements: Map<string, PropTestElement>;
const prop = createProp('overlay', { type: 'sprite', id: 'overlay-art', index: 0 });

class PropTestElement extends TestElement {
  checked = false;
  min = '';
  max = '';

  set innerHTML(html: string) {
    for (const match of html.matchAll(/<([a-z][a-z0-9]*)\b[^>]*\bid="([^"]+)"[^>]*>/g)) {
      const element = new PropTestElement(match[1]);
      element.id = match[2];
      element.min = /\bmin="([^"]*)"/.exec(match[0])?.[1] ?? '';
      element.max = /\bmax="([^"]*)"/.exec(match[0])?.[1] ?? '';
      elements.set(`#${element.id}`, element);
    }
  }

  querySelector(selector: string): PropTestElement | null {
    return elements.get(selector) ?? null;
  }

  getContext() {
    return { fillRect: vi.fn() };
  }
}

function getElement(id: string): PropTestElement {
  const element = elements.get(`#${id}`);
  if (!element) throw new Error(`Missing test element ${id}`);
  return element;
}

beforeEach(() => {
  vi.useFakeTimers();
  elements = new Map([
    ['.simple-main', new PropTestElement()],
    ['.prop-main', new PropTestElement()],
    ['.prop-library', new PropTestElement()],
  ]);
  vi.stubGlobal('document', {
    createElement: (tag: string) => new PropTestElement(tag),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    fonts: { load: () => Promise.resolve() },
  });
  vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() });
  vi.stubGlobal('location', { search: '?id=overlay' });
  vi.mocked(requestJson).mockImplementation(async <T>(url: string): Promise<T> => {
    const responses: Record<string, unknown> = {
      '/api/props': { files: [prop.id], labels: {} },
      '/api/props/overlay': prop,
      '/api/sprites': { files: ['overlay-art'], labels: {} },
      '/api/sprites/overlay-art': createSprite('overlay-art', 1, 1),
      '/api/animations': { files: [], labels: {} },
      '/api/palette': null,
      '/api/prop-folders': { folders: [], placements: {} },
    };
    if (!(url in responses)) throw new Error(`Unexpected test request ${url}`);
    return structuredClone(responses[url]) as T;
  });
  vi.mocked(saveDraft).mockImplementation(async (_url, doc) => structuredClone(doc));
});

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

it('edits foreground in the prop editor but leaves Z offsets to scene instances', async () => {
  cleanup = mountProps(new PropTestElement() as unknown as HTMLElement);
  await vi.waitFor(() => expect(getElement('prop-status').textContent).toBe('Opened overlay'));
  const foreground = getElement('prop-foreground');
  expect(elements.has('#prop-depth')).toBe(false);
  expect(foreground.checked).toBe(false);

  for (const checked of [true, false]) {
    foreground.checked = checked;
    foreground.dispatch('change');
    expect(getElement('prop-tabs').children[0].className).toContain('dirty');
    getElement('save-prop').dispatch('click');
    await vi.waitFor(() =>
      expect(getElement('prop-tabs').children[0].className).not.toContain('dirty'),
    );
    expect(saveDraft).toHaveBeenLastCalledWith(
      '/api/props/overlay',
      expect.objectContaining({ foreground: checked, depthOffset: 0 }),
      expect.anything(),
    );
    expect(foreground.checked).toBe(checked);
  }
});
