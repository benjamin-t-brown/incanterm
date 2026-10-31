import faviconUrl from '../../../assets/editor-favicon.png';
import { editorAssetUrl } from '../asset-url.js';
import { promptModal } from './modal.js';

let guard: (() => Promise<boolean>) | null = null;

export function setDirtyGuard(next: (() => Promise<boolean>) | null): void {
  guard = next;
}

export function setEditorAssetUrl(id: string | null): void {
  history.replaceState(history.state, '', editorAssetUrl(location.href, id));
}

export async function allowLeave(): Promise<boolean> {
  if (guard === null) return true;
  return guard();
}

export function brandLink(section: string): string {
  return `<a class="brand brand-link" href="/"><img class="brand-mark" src="${faviconUrl}" alt=""> INCANTERM <small>${section}</small></a>`;
}
export function editorNav(): string {
  return `<nav class="editor-nav" aria-label="Editor tools">
        <a href="/">INDEX</a>
        <a href="/art">ART</a>
        <a href="/animation">ANIMATION</a>
        <a href="/props">PROPS</a>
        <a href="/soundboard">SOUNDBOARD</a>
        <a href="/scripts">SCRIPTS</a>
        <a href="/scenes">SCENE</a>
        <a href="/game">GAME</a>
      </nav>`;
}
export function assetEditorTopbar(): string {
  return `<header class="topbar">
      ${brandLink('ASSET EDITOR')}
      <div class="top-right">${editorNav()}<button id="theme-toggle" class="text-button" type="button">☼ LIGHT MODE</button></div>
    </header>`;
}

export function setupThemeToggle(root: HTMLElement, onChange?: () => void): void {
  const button = root.querySelector<HTMLButtonElement>('#theme-toggle');
  if (!button) throw new Error('Missing #theme-toggle');
  const update = () => {
    const light = document.body.classList.contains('light');
    button.textContent = light ? '◐ DARK MODE' : '☼ LIGHT MODE';
  };
  document.body.classList.toggle(
    'light',
    localStorage.getItem('incanterm-editor-theme') === 'light',
  );
  update();
  button.addEventListener('click', () => {
    document.body.classList.toggle('light');
    update();
    localStorage.setItem(
      'incanterm-editor-theme',
      document.body.classList.contains('light') ? 'light' : 'dark',
    );
    onChange?.();
  });
}

export function pageShell(title: string, main: string): string {
  return `<div class="simple-layout">
    ${assetEditorTopbar()}
    <main class="simple-main" aria-label="${title}">${main}</main>
  </div>`;
}

export async function askId(label: string, suggestion = ''): Promise<string | null> {
  const entered = await promptModal(label, suggestion);
  if (entered === null) return null;
  return entered.trim();
}
