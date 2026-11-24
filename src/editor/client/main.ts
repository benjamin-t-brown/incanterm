import faviconUrl from '../resources/editor-favicon.png';
import { mountAnimation } from './animation/animation.js';
import { mountArt } from './art/art.js';
import { mountGame } from './game/game.js';
import { mountIndex } from './index/index.js';
import { mountScenes } from './scenes/scenes.js';
import { mountProps } from './props/props.js';
import { mountItems } from './items/items.js';
import { mountCharacters } from './characters/characters.js';
import { mountScripts } from './scripts/scripts.js';
import { allowLeave, setDirtyGuard, setupThemeToggle } from './shell.js';
import { requestJson, jsonRequest } from './api.js';
import {
  clearProjectSelection,
  getOpenedProject,
  getSavedProjectPath,
  saveProjectSelection,
  setOpenedProject,
  type EditorProject,
} from './project.js';
import { mountSoundboard } from './soundboard/soundboard.js';
import { mountVoiceStudio } from './voice/voice.js';

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
  '/items': 'Incanterm Editor - Items',
  '/characters': 'Incanterm Editor - Characters',
  '/soundboard': 'Incanterm Editor - Soundboard',
  '/voice': 'Incanterm Editor - Voice Studio',
  '/scripts': 'Incanterm Editor - Script Writer',
  '/scenes': 'Incanterm Editor - Scene',
  '/game': 'Incanterm Editor - Game',
};

const routes: Record<string, (root: HTMLElement) => void | (() => void)> = {
  '/': mountIndex,
  '/art': mountArt,
  '/animation': mountAnimation,
  '/props': mountProps,
  '/items': mountItems,
  '/characters': mountCharacters,
  '/soundboard': mountSoundboard,
  '/voice': mountVoiceStudio,
  '/scripts': mountScripts,
  '/scenes': mountScenes,
  '/game': mountGame,
};

const appNode = document.querySelector('#app');
if (!(appNode instanceof HTMLElement)) throw new Error('Missing #app');
const app: HTMLElement = appNode;

let cleanup: (() => void) | undefined;
let renderedEntry = Number.isSafeInteger(history.state?.editorEntry)
  ? Number(history.state.editorEntry)
  : 0;
history.replaceState({ ...history.state, editorEntry: renderedEntry }, '');
let checkingHistory = false;
let restoringHistory = false;
let renderedUrl = location.href;

function getCurrentPath(): string {
  const path = location.pathname.replace(/\/$/, '');
  return path.length === 0 ? '/' : path;
}

function render(): void {
  if (!Number.isSafeInteger(history.state?.editorEntry))
    history.replaceState({ ...history.state, editorEntry: renderedEntry }, '');
  renderedEntry = history.state.editorEntry;
  renderedUrl = location.href;
  cleanup?.();
  cleanup = undefined;
  setDirtyGuard(null);
  app.replaceChildren();
  const mount = getOpenedProject() ? (routes[getCurrentPath()] ?? mountIndex) : mountIndex;
  const result = mount(app);
  if (typeof result === 'function') cleanup = result;
  const active = getCurrentPath();
  // Art binds its own toggle so it can redraw the canvas when the theme changes.
  if (active !== '/art' || !getOpenedProject()) setupThemeToggle(app);
  document.title = `${getOpenedProject()?.name ?? 'Projects'} — ${titles[active] ?? 'Incanterm Editor'}`;
  for (const link of app.querySelectorAll<HTMLAnchorElement>('a[href]')) {
    if (link.getAttribute('href') === active) link.setAttribute('aria-current', 'page');
  }
}

async function navigate(url: URL): Promise<void> {
  if (url.pathname === getCurrentPath() && url.search === location.search) return;
  if (!(await allowLeave())) return;
  history.pushState({ editorEntry: renderedEntry + 1 }, '', `${url.pathname}${url.search}`);
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

window.addEventListener('popstate', () => {
  void navigateBack();
});

async function navigateBack(): Promise<void> {
  // Back/Forward changes the URL before popstate fires. A declined dirty guard
  // must restore the mounted editor's existing entry, including its asset query.
  if (restoringHistory && history.state?.editorEntry === renderedEntry) {
    restoringHistory = false;
    return;
  }
  if (checkingHistory) return;
  checkingHistory = true;
  try {
    if (await allowLeave()) {
      restoringHistory = false;
      render();
    } else {
      if (!Number.isSafeInteger(history.state?.editorEntry)) {
        history.pushState({ editorEntry: renderedEntry }, '', renderedUrl);
        return;
      }
      const delta = renderedEntry - history.state.editorEntry;
      if (delta) {
        restoringHistory = true;
        history.go(delta);
      }
    }
  } finally {
    checkingHistory = false;
  }
}

async function startEditor(): Promise<void> {
  const selected = getSavedProjectPath();
  if (selected) {
    try {
      const project = await requestJson<EditorProject>(
        '/api/projects/open',
        jsonRequest('POST', { path: selected }),
      );
      setOpenedProject(project);
      saveProjectSelection(project.manifestPath);
    } catch (error) {
      console.error('Could not reopen project:', error);
      clearProjectSelection();
    }
  }
  render();
}

void startEditor();
