import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createProp, createSprite } from '../../../schema.js';
import { TestElement } from '../../__tests__/dom-fixture.js';
import { requestJson } from '../../api.js';
import { alertModal, askAssetMeta } from '../../modal.js';
import { saveDraft } from '../../save.js';
import { mountProps } from '../props.js';
import { createVisualAssetPicker } from '../../visual-asset-picker.js';

vi.mock('../../project.js', () => ({
  projectStorage: { getItem: () => null, setItem: vi.fn() },
}));
vi.mock('../../api.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api.js')>()),
  requestJson: vi.fn(),
}));
vi.mock('../../modal.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../modal.js')>()),
  alertModal: vi.fn(),
  askAssetMeta: vi.fn(),
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
vi.mock('../../visual-asset-picker.js', () => ({
  createVisualAssetPicker: vi.fn(() => ({ open: vi.fn(), dispose: vi.fn(), isOpen: () => false })),
}));
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
      '/api/sprites/new-art': createSprite('new-art', 2, 2),
      '/api/animations': { files: ['open-clip'], labels: { 'open-clip': 'Opening' } },
      '/api/palette': null,
      '/api/prop-folders': { folders: [], placements: {} },
    };
    if (!(url in responses)) throw new Error(`Unexpected test request ${url}`);
    return structuredClone(responses[url]) as T;
  });
  vi.mocked(saveDraft).mockImplementation(async (_url, doc) => structuredClone(doc));
});

it('uses the shared asset picker and still resizes the prop footprint after selection', async () => {
  cleanup = mountProps(new PropTestElement() as unknown as HTMLElement);
  await vi.waitFor(() => expect(getElement('prop-status').textContent).toBe('Opened overlay'));
  const picker = vi.mocked(createVisualAssetPicker).mock.results[0].value;
  vi.mocked(picker.open).mockResolvedValueOnce({ type: 'sprite', id: 'new-art', index: 0 });
  getElement('choose-prop-visual').dispatch('click');
  await vi.waitFor(() => expect(getElement('prop-width').value).toBe('2'));
  expect(picker.open).toHaveBeenCalledWith('sprite', prop.visual);
  getElement('save-prop').dispatch('click');
  await vi.waitFor(() =>
    expect(saveDraft).toHaveBeenCalledWith(
      '/api/props/overlay',
      expect.objectContaining({
        visual: { type: 'sprite', id: 'new-art', index: 0 },
        width: 2,
        height: 2,
      }),
      expect.anything(),
    ),
  );
});

it('lets a custom state use a sprite frame, then change to an animation', async () => {
  cleanup = mountProps(new PropTestElement() as unknown as HTMLElement);
  await vi.waitFor(() => expect(getElement('prop-status').textContent).toBe('Opened overlay'));
  const picker = vi.mocked(createVisualAssetPicker).mock.results[0].value;
  const visual = { type: 'sprite', id: 'new-art', index: 2 };
  vi.mocked(picker.open).mockResolvedValueOnce(visual);
  const type = getElement('prop-custom-state-type');
  const form = getElement('prop-custom-state-form');

  getElement('add-prop-state').dispatch('click');
  expect(type.value).toBe('animation');
  getElement('prop-custom-state-name').value = 'open';
  type.value = 'sprite';
  type.dispatch('change');
  expect(getElement('prop-custom-state-animation').hidden).toBe(true);
  expect(getElement('prop-custom-state-sprite').hidden).toBe(false);
  form.dispatch('submit');
  expect(getElement('prop-custom-state-error').textContent).toBe(
    'Select a sprite frame for this state.',
  );
  expect(saveDraft).not.toHaveBeenCalled();

  getElement('choose-prop-state-sprite').dispatch('click');
  expect(picker.open).toHaveBeenCalledWith('sprite', prop.visual);
  await vi.waitFor(() =>
    expect(getElement('prop-custom-state-sprite-label').textContent).toBe('new-art · frame 3'),
  );
  form.dispatch('submit');
  await vi.waitFor(() => expect(getElement('prop-status').textContent).toBe('Saved overlay'));
  expect(saveDraft).toHaveBeenLastCalledWith(
    '/api/props/overlay',
    { ...prop, customAnimations: { open: visual } },
    prop,
  );

  const [edit, , label] = getElement('prop-custom').children[0].children;
  expect(label.textContent).toBe('open · new-art · frame 3');
  edit.dispatch('click');
  expect(type.value).toBe('sprite');
  expect(getElement('prop-custom-state-sprite-label').textContent).toBe('new-art · frame 3');
  type.value = 'animation';
  type.dispatch('change');
  const input = getElement('prop-custom-state-picker').children[0].children[0];
  input.value = 'Opening';
  input.dispatch('input');
  form.dispatch('submit');
  expect(saveDraft).toHaveBeenLastCalledWith(
    '/api/props/overlay',
    { ...prop, customAnimations: { open: 'open-clip' } },
    { ...prop, customAnimations: { open: visual } },
  );
});

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

it('renames a prop in the draft and saves it under the same asset ID', async () => {
  cleanup = mountProps(new PropTestElement() as unknown as HTMLElement);
  await vi.waitFor(() => expect(getElement('prop-status').textContent).toBe('Opened overlay'));
  const rename = getElement('rename-prop');
  expect(rename.disabled).toBe(false);
  vi.mocked(askAssetMeta).mockResolvedValueOnce('  Stage overlay  ');
  rename.dispatch('click');

  expect(askAssetMeta).toHaveBeenCalledWith('PROP', 'overlay', 'overlay');
  await vi.waitFor(() => expect(getElement('prop-id').textContent).toBe('Stage overlay'));
  const tab = getElement('prop-tabs').children[0];
  expect(tab.children[0].textContent).toBe('Stage overlay');
  expect(tab.className).toContain('dirty');
  expect(saveDraft).not.toHaveBeenCalled();

  getElement('save-prop').dispatch('click');
  await vi.waitFor(() =>
    expect(getElement('prop-tabs').children[0].className).not.toContain('dirty'),
  );
  expect(saveDraft).toHaveBeenCalledWith(
    '/api/props/overlay',
    { ...prop, label: 'Stage overlay' },
    prop,
  );
});

it.each([null, '', 'x'.repeat(81)])(
  'leaves the prop unchanged for rename input %j',
  async (label) => {
    cleanup = mountProps(new PropTestElement() as unknown as HTMLElement);
    await vi.waitFor(() => expect(getElement('prop-status').textContent).toBe('Opened overlay'));
    vi.mocked(askAssetMeta).mockResolvedValueOnce(label);
    getElement('rename-prop').dispatch('click');
    await Promise.resolve();

    if (label === null) expect(alertModal).not.toHaveBeenCalled();
    else
      expect(alertModal).toHaveBeenCalledWith(
        'Prop label must be 1 to 80 characters without control characters',
      );
    expect(getElement('prop-id').textContent).toBe('overlay');
    expect(getElement('prop-tabs').children[0].className).not.toContain('dirty');
  },
);

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
