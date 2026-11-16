import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createAnimation, createCharacter, createSprite } from '../../../schema.js';
import { requestJson } from '../../api.js';
import { TestElement } from '../../__tests__/dom-fixture.js';
import { mountCharacters } from '../characters.js';

vi.mock('../../project.js', () => ({
  projectStorage: { getItem: () => null, setItem: vi.fn() },
}));
vi.mock('../../api.js', () => ({
  requestJson: vi.fn(),
  jsonRequest: vi.fn(),
  ApiError: class ApiError extends Error {},
}));
vi.mock('../../shell.js', () => ({
  createPageShell: (_title: string, main: string) => main,
  setDirtyGuard: vi.fn(),
  setEditorAssetUrl: vi.fn(),
  askId: vi.fn(),
}));
vi.mock('../../panel-resizer.js', () => ({ createPanelResizer: () => () => {} }));
vi.mock('../../tab-close-actions.js', () => ({ renderTabCloseActions: vi.fn() }));
vi.mock('../../../terminal-cell.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../terminal-cell.js')>()),
  preloadSpriteFonts: async () => {},
  terminalCellAtZoom: () => ({ width: 8, height: 16 }),
}));
vi.mock('../../terminal-renderer.js', () => ({
  drawTerminalGlyph: vi.fn(),
  fillTerminalCell: vi.fn(),
}));

class PortraitTestElement extends TestElement {
  innerHTML = '';
  isConnected = true;
  checked = false;
  placeholder = '';
  drawing = { fillRect: vi.fn(), clearRect: vi.fn(), fillStyle: '' };

  getContext() {
    return this.drawing;
  }

  override querySelectorAll(selector: string): PortraitTestElement[] {
    return this.children.flatMap((child) => {
      const element = child as PortraitTestElement;
      const matches = selector.startsWith('.')
        ? element.className.split(' ').includes(selector.slice(1))
        : element.tagName === selector;
      return [...(matches ? [element] : []), ...element.querySelectorAll(selector)];
    });
  }

  querySelector(selector: string): PortraitTestElement | null {
    return this.querySelectorAll(selector)[0] ?? null;
  }
}

let dispose: (() => void) | undefined;

beforeEach(() => {
  vi.stubGlobal('document', {
    createElement: (tag: string) => new PortraitTestElement(tag),
    fonts: { ready: Promise.resolve() },
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
  vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() });
  vi.stubGlobal('location', { search: '' });
});
afterEach(() => {
  dispose?.();
  dispose = undefined;
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

async function mountPicker() {
  const sprite = createSprite('sheet', 1, 1);
  sprite.label = 'Portrait sheet';
  sprite.sprites.push(structuredClone(sprite.sprites[0]));
  const animation = createAnimation('clip', 'Portrait animation');
  animation.frames = [{ sprite: 'sheet', index: 1, durationMs: 100 }];
  animation.loop = false;
  const files = ['sheet', ...Array.from({ length: 40 }, (_, index) => `sheet-${index}`)];
  const character = createCharacter('hero', 'clip', 'Test Hero');
  const inventory: Record<string, unknown> = {
    '/api/characters': { files: ['hero'], labels: { hero: 'Test Hero' } },
    '/api/characters/hero': character,
    '/api/sprites': { files, labels: { sheet: 'Portrait sheet' } },
    '/api/sprites/sheet': sprite,
    '/api/animations': { files: ['clip'], labels: { clip: 'Portrait animation' } },
    '/api/animations/clip': animation,
    '/api/sprite-folders': { folders: ['Faces'], placements: { sheet: 'Faces' } },
    '/api/animation-folders': { folders: ['Expressions'], placements: { clip: 'Expressions' } },
    '/api/character-folders': { folders: [], placements: {} },
    '/api/palette': null,
  };
  vi.mocked(requestJson).mockImplementation(async (url) => {
    if (!(url in inventory)) throw new Error(`Unexpected request ${url}`);
    return structuredClone(inventory[url]);
  });
  const elements = new Map<string, PortraitTestElement>();
  function getElement(selector: string): PortraitTestElement {
    let element = elements.get(selector);
    if (!element) {
      element = new PortraitTestElement();
      elements.set(selector, element);
    }
    return element;
  }
  const root = new PortraitTestElement();
  root.querySelector = getElement;
  getElement('#character-preview-state').value = 'invisible';
  dispose = mountCharacters(root as unknown as HTMLElement);
  await vi.waitFor(() => {
    expect(getElement('#character-list').querySelectorAll('.asset-tree-file')).toHaveLength(1);
  });
  getElement('#character-list').querySelectorAll('.asset-tree-file')[0].dispatch('click');
  await vi.waitFor(() => expect(getElement('#character-id').textContent).toBe('Test Hero'));
  getElement('#add-character-portrait').dispatch('click');
  return { getElement, root };
}

it('uses the read-only folder/search browser without fetching thumbnails or truncating assets', async () => {
  const { getElement } = await mountPicker();
  const list = getElement('#portrait-results');
  expect(list.querySelectorAll('.asset-tree-file')).toHaveLength(40);
  expect(list.querySelectorAll('.asset-tree-file').every((row) => !row.draggable)).toBe(true);
  expect(requestJson).not.toHaveBeenCalledWith('/api/sprites/sheet');
  const search = getElement('#portrait-search');
  search.value = 'Faces';
  search.dispatch('input');
  expect(list.querySelectorAll('.asset-tree-file').map((row) => row.dataset.id)).toEqual(['sheet']);
  list.querySelectorAll('.asset-tree-file')[0].dispatch('click');
  await vi.waitFor(() => expect(getElement('#portrait-okay').disabled).toBe(false));
  expect(getElement('#portrait-frame-label').hidden).toBe(false);
  const frames = getElement('#portrait-frame').querySelectorAll('button');
  expect(frames).toHaveLength(2);
  expect(frames[0].attributes.get('aria-pressed')).toBe('true');
  frames[1].dispatch('click');
  await vi.waitFor(() => expect(frames[1].attributes.get('aria-pressed')).toBe('true'));
  expect(getElement('#portrait-picker-status').textContent).toBe('Portrait sheet · frame 2 / 2');
  getElement('#portrait-emotion').value = 'happy,smile';
  getElement('#character-portrait-form').dispatch('submit');
  expect(getElement('#character-portrait-dialog').open).toBe(false);
  getElement('#add-character-portrait').dispatch('click');
  await vi.waitFor(() => expect(getElement('#portrait-okay').disabled).toBe(false));
  expect(getElement('#portrait-frame-label').hidden).toBe(false);
  expect(frames[1].attributes.get('aria-pressed')).toBe('true');
  expect(
    getElement('#portrait-results')
      .querySelectorAll('.asset-tree-file')
      .find((row) => row.dataset.id === 'sheet')
      ?.attributes.get('aria-current'),
  ).toBe('true');
});

it('switches to animation folders, clears sprite frames and plays the selected animation', async () => {
  const { getElement } = await mountPicker();
  const search = getElement('#portrait-search');
  search.value = 'Portrait sheet';
  search.dispatch('input');
  getElement('#portrait-results').querySelectorAll('.asset-tree-file')[0].dispatch('click');
  await vi.waitFor(() => expect(getElement('#portrait-okay').disabled).toBe(false));
  expect(getElement('#portrait-frame-label').hidden).toBe(false);
  const kind = getElement('#portrait-kind');
  kind.value = 'animation';
  kind.dispatch('change');
  expect(getElement('#portrait-frame-label').hidden).toBe(true);
  expect(getElement('#portrait-okay').disabled).toBe(true);
  expect(search.value).toBe('');
  expect(search.placeholder).toBe('Search animations…');
  search.value = 'Expressions';
  search.dispatch('input');
  const rows = getElement('#portrait-results').querySelectorAll('.asset-tree-file');
  expect(rows.map((row) => row.dataset.id)).toEqual(['clip']);
  rows[0].dispatch('click');
  await vi.waitFor(() => expect(getElement('#portrait-okay').disabled).toBe(false));
  expect(getElement('#portrait-picker-status').textContent).toBe(
    'Portrait animation · frame 1 / 1',
  );
  expect(getElement('#portrait-frame-label').hidden).toBe(true);
});
