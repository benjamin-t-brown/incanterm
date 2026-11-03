import faviconUrl from '../../../assets/editor-favicon.png';
import { mountAnimation } from './animation/animation.js';
import { mountArt } from './art/art.js';
import { mountGame } from './game/game.js';
import { mountIndex } from './index/index.js';
import { mountScenes } from './scenes/scenes.js';
import { mountProps } from './props/props.js';
import { mountCharacters } from './characters/characters.js';
import { mountScripts } from './scripts/scripts.js';
import { allowLeave, setupThemeToggle } from './shell.js';
import { mountSoundboard } from './soundboard/soundboard.js';

const icon = document.createElement('link');
icon.rel = 'icon';
icon.type = 'image/png';
icon.href = faviconUrl;
document.head.append(icon);

const titles: Record<string, string> = {
  '/': 'Incanterm Editor',
  '/art': 'Incanterm Editor - Art',
  '/animation': 'Incanterm Editor - Animation',
  '/props': 'Incanterm Editor - Props',
  '/characters': 'Incanterm Editor - Characters',
  '/soundboard': 'Incanterm Editor - Soundboard',
  '/scripts': 'Incanterm Editor - Script Writer',
  '/scenes': 'Incanterm Editor - Scene',
  '/game': 'Incanterm Editor - Game',
};

const routes: Record<string, (root: HTMLElement) => void | (() => void)> = {
  '/': mountIndex,
  '/art': mountArt,
  '/animation': mountAnimation,
  '/props': mountProps,
  '/characters': mountCharacters,
  '/soundboard': mountSoundboard,
  '/scripts': mountScripts,
  '/scenes': mountScenes,
  '/game': mountGame,
};

const appNode = document.querySelector('#app');
if (!(appNode instanceof HTMLElement)) throw new Error('Missing #app');
const app: HTMLElement = appNode;

let cleanup: (() => void) | undefined;

function getCurrentPath(): string {
  const path = location.pathname.replace(/\/$/, '');
  return path.length === 0 ? '/' : path;
}

function render(): void {
  cleanup?.();
  cleanup = undefined;
  app.replaceChildren();
  const mount = routes[getCurrentPath()] ?? mountIndex;
  const result = mount(app);
  if (typeof result === 'function') cleanup = result;
  const active = getCurrentPath();
  // Art binds its own toggle so it can redraw the canvas when the theme changes.
  if (active !== '/art') setupThemeToggle(app);
  document.title = titles[active] ?? 'Incanterm Editor';
  for (const link of app.querySelectorAll<HTMLAnchorElement>('a[href]')) {
    if (link.getAttribute('href') === active) link.setAttribute('aria-current', 'page');
  }
}

async function navigate(url: URL): Promise<void> {
  if (url.pathname === getCurrentPath() && url.search === location.search) return;
  if (!(await allowLeave())) return;
  history.pushState(null, '', `${url.pathname}${url.search}`);
  render();
}

document.addEventListener('click', (event) => {
  if (
    event.defaultPrevented ||
    event.button !== 0 ||
    event.ctrlKey ||
    event.metaKey ||
    event.shiftKey ||
    event.altKey ||
    !(event.target instanceof Element)
  )
    return;
  const link = event.target.closest('a');
  if (!(link instanceof HTMLAnchorElement) || link.origin !== location.origin) return;
  if (link.target && link.target !== '_self') return;
  const url = new URL(link.href);
  const path = url.pathname.replace(/\/$/, '') || '/';
  if (!(path in routes)) return;
  event.preventDefault();
  void navigate(url);
});

window.addEventListener('popstate', render);

render();
