import { afterEach, expect, it, vi } from 'vitest';
import { createAssetEditorTopbar, createPageShell, setupThemeToggle } from '../shell.js';

afterEach(() => vi.unstubAllGlobals());

it('uses the same editor header on simple pages', () => {
  const header = createAssetEditorTopbar();
  expect(createPageShell('Index', 'Home')).toContain(header);
  expect(header).toContain('href="/art"');
  expect(header).toContain('href="/game"');
  expect(header).toContain('id="theme-toggle"');
});

it('restores and persists the theme when toggled', () => {
  const classes = new Set<string>();
  const classList = {
    contains: (name: string) => classes.has(name),
    toggle: (name: string, force?: boolean) => {
      if (force ?? !classes.has(name)) classes.add(name);
      else classes.delete(name);
    },
  };
  const saved = new Map([['incanterm-editor-theme', 'light']]);
  vi.stubGlobal('document', { body: { classList } });
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => saved.get(key) ?? null,
    setItem: (key: string, value: string) => saved.set(key, value),
  });
  const button = {
    textContent: '',
    addEventListener: (_type: string, listener: () => void) => {
      button.click = listener;
    },
    click: () => {},
  };
  const root = { querySelector: () => button } as unknown as HTMLElement;
  const onChange = vi.fn();

  setupThemeToggle(root, onChange);
  expect(classes.has('light')).toBe(true);
  expect(button.textContent).toBe('◐ DARK MODE');

  button.click();
  expect(classes.has('light')).toBe(false);
  expect(button.textContent).toBe('☼ LIGHT MODE');
  expect(saved.get('incanterm-editor-theme')).toBe('dark');
  expect(onChange).toHaveBeenCalledOnce();
});
