import { isScriptFileId } from '../../schema.js';
import { projectStorage } from '../project.js';
import { renderTabCloseActions } from '../tab-close-actions.js';
import { renderTabReordering } from '../tab-reordering.js';

type ScriptDraft = { source: string; saved: string };
const key = 'incanterm-script-tabs';

export function readScriptTabs() {
  const drafts = new Map<string, ScriptDraft>();
  let tabs: string[] = [];
  let active: string | null = null;
  try {
    const data = JSON.parse(projectStorage.getItem(key) ?? '{}');
    if (Array.isArray(data.tabs)) tabs = [...new Set<string>(data.tabs.filter((id: unknown) => typeof id === 'string' && isScriptFileId(id)))];
    if (tabs.includes(data.active)) active = data.active;
    for (const id of tabs) {
      const draft = data.drafts?.[id];
      if (typeof draft?.source === 'string' && typeof draft.saved === 'string') drafts.set(id, draft);
    }
  } catch { /* Storage is optional. */ }
  return { tabs, active, drafts };
}

export function saveScriptTabs(tabs: string[], active: string | null, sessions: Map<string, ScriptDraft>) {
  try {
    const drafts = Object.fromEntries([...sessions].filter(([, draft]) => draft.source !== draft.saved));
    projectStorage.setItem(key, JSON.stringify({ tabs, active, drafts }));
  } catch { /* Keep in-memory drafts if storage is full. */ }
}

export function renderScriptTabs(host: HTMLElement, tabs: string[], active: string | null,
  isDirty: (id: string) => boolean, openTab: (id: string) => void, closeTab: (id: string) => Promise<void>,
  reorder: (tabs: string[]) => void) {
  renderTabCloseActions(host, { tabs, active, closeTab });
  host.replaceChildren();
  for (const id of tabs) {
    const tab = document.createElement('div');
    tab.className = 'prop-tab editor-document-tab';
    tab.dataset.tabId = id;
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-selected', String(id === active));
    tab.classList.toggle('current', id === active);
    tab.classList.toggle('dirty', isDirty(id));
    const label = document.createElement('button');
    label.type = 'button';
    label.className = 'prop-tab-label';
    label.textContent = id;
    const mark = document.createElement('span');
    mark.className = 'prop-dirty-mark';
    mark.textContent = ' ●';
    label.append(mark);
    label.onclick = () => openTab(id);
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'prop-tab-close';
    close.setAttribute('aria-label', `Close ${id}`);
    close.textContent = '×';
    close.onclick = () => void closeTab(id);
    tab.onauxclick = event => {
      if (event.button === 1) { event.preventDefault(); void closeTab(id); }
    };
    tab.append(label, close);
    host.append(tab);
  }
  renderTabReordering(host, { tabs, onReorder: reorder });
}
