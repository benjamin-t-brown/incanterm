import faviconUrl from '../../../assets/editor-favicon.png';
import { promptModal } from './modal.js';

let guard: (() => Promise<boolean>) | null = null;

export function setDirtyGuard(next: (() => Promise<boolean>) | null): void {
  guard = next;
}

export async function allowLeave(): Promise<boolean> {
  if (guard === null) return true;
  return guard();
}

export function brandLink(section: string): string {
  return `<a class="brand brand-link" href="/"><img class="brand-mark" src="${faviconUrl}" alt=""> INCANTERM <small>${section}</small></a>`;
}
export function pageShell(title: string, main: string): string {
  return `<div class="simple-layout">
    <header class="topbar">
      ${brandLink('ASSET EDITOR')}
      <nav class="editor-nav" aria-label="Editor tools">
        <a href="/">INDEX</a>
        <a href="/art">ART</a>
        <a href="/animation">ANIMATION</a>
        <a href="/soundboard">SOUNDBOARD</a>
        <a href="/scripts">SCRIPTS</a>
        <a href="/scenes">SCENE</a>
        <a href="/game">GAME</a>
      </nav>
    </header>
    <main class="simple-main" aria-label="${title}">${main}</main>
  </div>`;
}

export async function askId(label: string, suggestion = ''): Promise<string | null> {
  const entered = await promptModal(label, suggestion);
  if (entered === null) return null;
  return entered.trim();
}
