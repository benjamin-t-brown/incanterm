import { beforeEach, expect, it, vi } from 'vitest';
import { createProjectStorage, importLegacyEditorState, type EditorProject } from '../project.js';

beforeEach(() => vi.resetModules());

function createEditorProject(key: string): EditorProject {
  return {
    key,
    id: 'same-manifest-id',
    name: key,
    root: `/projects/${key}`,
    manifestPath: `/projects/${key}/incanterm.json`,
    entryScene: 'start',
  };
}

it('requires an opened project and scopes every asset API including audio and image URLs', async () => {
  const { getProjectApiUrl, setOpenedProject } = await import('../project.js');
  expect(() => getProjectApiUrl('/api/scenes')).toThrow('Open a project');
  expect(getProjectApiUrl('/api/projects')).toBe('/api/projects');
  setOpenedProject(createEditorProject('first'));
  expect(getProjectApiUrl('/api/scenes/start')).toBe('/api/projects/first/assets/scenes/start');
  expect(getProjectApiUrl('/api/references/picture/image?t=123')).toBe(
    '/api/projects/first/assets/references/picture/image?t=123',
  );
  expect(getProjectApiUrl('/api/audio/voice.wav')).toBe(
    '/api/projects/first/assets/audio/voice.wav',
  );
});

it('keeps an editor context immutable so late async callbacks cannot save into a newly opened project', async () => {
  const { getProjectApiUrl, setOpenedProject } = await import('../project.js');
  setOpenedProject(createEditorProject('first'));
  expect(() => setOpenedProject(createEditorProject('second'))).toThrow('Reload the editor');
  expect(getProjectApiUrl('/api/sprites/hero')).toBe('/api/projects/first/assets/sprites/hero');
});

it('separates tabs, drafts and preferences even when two projects use the same asset IDs', () => {
  const values = new Map<string, string>();
  const storage = {
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      values.set(key, value);
    },
    removeItem(key: string) {
      values.delete(key);
    },
  };
  const a = createProjectStorage(storage, 'a');
  const b = createProjectStorage(storage, 'b');
  a.setItem('open-sprites', 'hero with unsaved changes');
  b.setItem('open-sprites', 'other hero');
  expect(a.getItem('open-sprites')).toBe('hero with unsaved changes');
  expect(b.getItem('open-sprites')).toBe('other hero');
  b.removeItem('open-sprites');
  expect(a.getItem('open-sprites')).toBe('hero with unsaved changes');
  expect(b.getItem('open-sprites')).toBeNull();
  expect(storage.getItem('open-sprites')).toBeNull();
});

it('only imports legacy editor state explicitly, preserving both original data and existing project drafts', () => {
  const values = new Map([
    ['incanterm-editor-open-sprites', 'legacy draft'],
    ['incanterm-editor-open-scenes', 'legacy tabs'],
    ['incanterm-editor-theme', 'light'],
    ['unrelated', 'other application'],
  ]);
  const storage: Storage = {
    get length() {
      return values.size;
    },
    key(index) {
      return [...values.keys()][index] ?? null;
    },
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, value);
    },
    removeItem(key) {
      values.delete(key);
    },
    clear() {
      values.clear();
    },
  };
  const scoped = createProjectStorage(storage, 'selected');
  scoped.setItem('incanterm-editor-open-sprites', 'newer project draft');
  expect(importLegacyEditorState(storage, 'selected')).toBe(1);
  expect(scoped.getItem('incanterm-editor-open-sprites')).toBe('newer project draft');
  expect(scoped.getItem('incanterm-editor-open-scenes')).toBe('legacy tabs');
  expect(scoped.getItem('incanterm-editor-theme')).toBeNull();
  expect(storage.getItem('incanterm-editor-open-sprites')).toBe('legacy draft');
  expect(importLegacyEditorState(storage, 'selected')).toBe(0);
});
