import type { ScriptDiagnostic } from '../../rpgscript/diagnostic.js';
import { isScriptFileId } from '../../schema.js';
import { ApiError, jsonRequest, requestJson } from '../api.js';
import { mergeText } from '../../safe-save.js';
import { saveDraft } from '../save.js';
import { alertModal, confirmModal } from '../modal.js';
import { askId, createPageShell, setDirtyGuard } from '../shell.js';
import { setSelectedVoiceRequests } from './voice-request.js';
import { assignMissingVoiceIds } from '../../../game/rpgscript/voice-ids.js';
import { renderScriptHighlight } from './highlight.js';
import { readScriptTabs, renderScriptTabs, saveScriptTabs } from './script-tabs.js';
import { showEditorToast } from '../save-toast.js';
import { createPanelResizer } from '../panel-resizer.js';
import { formatRpgScript } from '../../../game/rpgscript/format.js';

type ScriptFile = { id: string; source: string };

export function mountScripts(root: HTMLElement): () => void {
  root.innerHTML = createPageShell(
    'Script writer',
    `<nav class="menubar" aria-label="Script editor">
      <details class="menu"><summary>File</summary><div class="menu-panel">
        <button id="save-script">Save <kbd>Ctrl+S</kbd></button><button id="new-script">New</button>
        <button id="duplicate-script">Duplicate</button><button id="delete-script">Delete</button>
      </div></details>
      <details class="menu"><summary>Edit</summary><div class="menu-panel"><button id="format-script">Format (rpgformat)</button></div></details>
      <details class="menu"><summary>Compile</summary><div class="menu-panel"><button id="generate-voice-ids">Generate Voice IDs</button></div></details>
    </nav>
    <div class="script-workspace">
      <aside class="script-library"><h2>Scripts</h2><div id="script-list" class="asset-list"></div></aside>
      <section class="script-document">
        <div id="script-tabs" class="prop-tabs" role="tablist" aria-label="Open scripts"></div>
        <strong id="script-id">No script</strong>
        <div class="toolbar-row">
           <span>Dialogue at cursor or in selection:</span>
          <button type="button" id="request-voice">Request voice</button>
          <button type="button" id="no-voice">No voice requested</button>
         </div>
         <span id="voice-id-status" role="status"></span>
        <div id="script-columns"><div class="script-editor">
          <div class="script-highlight" aria-hidden="true"><pre id="script-colors"></pre></div>
          <textarea id="script-source" class="script-box" aria-label="RPGScript source" wrap="off" spellcheck="false"></textarea>
        </div>
        <div id="script-divider" class="panel-resizer" role="separator" aria-label="Resize script and diagnostics" aria-orientation="vertical" tabindex="0" title="Drag to resize; double-click to reset"></div>
        <aside class="script-errors"><h2>Diagnostics</h2><div id="diagnostics" class="diagnostics"></div></aside></div>
      </section>
    </div><div id="toast-stack" class="toast-stack" aria-live="polite"></div>`,
  );
  const listNode = root.querySelector<HTMLElement>('#script-list');
  const sourceNode = root.querySelector<HTMLTextAreaElement>('#script-source');
  const diagnosticsNode = root.querySelector<HTMLElement>('#diagnostics');
  const titleNode = root.querySelector('#script-id');
  const requestVoice = root.querySelector<HTMLButtonElement>('#request-voice');
  const noVoice = root.querySelector<HTMLButtonElement>('#no-voice');
  const generateIds = root.querySelector<HTMLButtonElement>('#generate-voice-ids');
  if (!listNode || !sourceNode || !diagnosticsNode || !titleNode || !requestVoice || !noVoice || !generateIds) return () => undefined;
  const list: HTMLElement = listNode;
  const source: HTMLTextAreaElement = sourceNode;
  const diagnostics: HTMLElement = diagnosticsNode;
  const title: Element = titleNode;
  const colors = root.querySelector<HTMLElement>('#script-colors');
  const voiceButtons = [requestVoice, noVoice, generateIds];
  const voiceIdStatus = root.querySelector<HTMLElement>('#voice-id-status');
  const tabsHost = root.querySelector<HTMLElement>('#script-tabs');
  const stack = root.querySelector<HTMLElement>('#toast-stack');
  root.querySelector('.simple-main')?.classList.add('script-main');
  const columns = root.querySelector<HTMLElement>('#script-columns');
  const panel = root.querySelector<HTMLElement>('.script-editor');
  const divider = root.querySelector<HTMLElement>('#script-divider');
  const disposeResize = columns && panel && divider ? createPanelResizer({
    container: columns, panel, handle: divider, defaultWidth: Math.round((columns.clientWidth - 6) * 0.75),
    minWidth: 100, reserve: 100, storageKey: 'incanterm-script-source-width',
  }) : undefined;
  const restored = readScriptTabs();
  let tabs = restored.tabs;
  const sessions = restored.drafts;
  let openToken = 0;
  let alive = true;
  const listeners = new AbortController();

  let files: string[] = [];
  let currentId: string | null = null;
  let saved = '';
  let hasSavedVersion = false;
  let saving = false;
  let diagnoseTimer = 0;

  function showToast(message: string, error = false) {
    if (alive && stack) showEditorToast(stack, message, error);
  }
  function isTabDirty(id: string) {
    const tab = sessions.get(id);
    return !!tab && tab.source !== tab.saved;
  }
  function refreshTabs() {
    if (currentId) sessions.set(currentId, { source: source.value, saved });
    saveScriptTabs(tabs, currentId, sessions);
    if (tabsHost) renderScriptTabs(tabsHost, tabs, currentId, isTabDirty, openScript, closeTab,
      (order) => { tabs = order; refreshTabs(); });
  }
  async function closeTab(id: string, deleted = false) {
    if (saving || !tabs.includes(id)) return;
    if (!deleted && isTabDirty(id) && !(await confirmModal(`Discard unsaved changes to ${id}?`, 'DISCARD'))) return;
    const index = tabs.indexOf(id);
    tabs = tabs.filter(tab => tab !== id);
    sessions.delete(id);
    if (currentId === id) {
      openToken++;
      currentId = null;
      saved = source.value = '';
      highlightSource();
      title.textContent = 'No script';
      diagnostics.replaceChildren();
      updateVoiceControls();
      const next = tabs[Math.min(index, tabs.length - 1)];
      if (next) await openScript(next);
    }
    refreshTabs();
    renderList();
  }

  function syncScroll(): void {
    if (colors) colors.style.transform = `translate(${-source.scrollLeft}px, ${-source.scrollTop}px)`;
  }
  function highlightSource(): void {
    if (voiceIdStatus) voiceIdStatus.textContent = '';
    if (colors) colors.innerHTML = renderScriptHighlight(source.value);
    syncScroll();
  }
  source.addEventListener('scroll', syncScroll);

  function updateVoiceControls(): void {
    for (const button of voiceButtons) button.disabled = saving || currentId === null;
    source.disabled = !currentId;
    for (const id of ['save-script', 'format-script', 'duplicate-script', 'delete-script']) {
      const button = root.querySelector<HTMLButtonElement>(`#${id}`);
      if (button) button.disabled = !currentId || saving;
    }
  }
  updateVoiceControls();

  setDirtyGuard(async () => !saving && (!tabs.some(isTabDirty) || confirmModal('Leave scripts with unsaved changes?', 'LEAVE')));

  async function reload(): Promise<void> {
    files = (await requestJson<{ files: string[] }>('/api/scripts')).files;
    renderList();
  }
  function renderList() {
    list.replaceChildren();
    for (const id of files) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = id;
      button.classList.toggle('active', id === currentId);
      button.addEventListener('click', () => void openScript(id));
      list.append(button);
    }
  }

  async function openScript(id: string): Promise<void> {
    const token = ++openToken;
    if (currentId === id) return;
    let tab = sessions.get(id);
    if (!tab) {
      try {
        const file = await requestJson<ScriptFile>(`/api/scripts/${encodeURIComponent(id)}`);
        tab = { source: file.source, saved: file.source };
      } catch (error) { showToast(error instanceof Error ? error.message : 'Could not open script', true); return; }
    }
    if (!alive || token !== openToken) return;
    if (currentId) sessions.set(currentId, { source: source.value, saved });
    currentId = id;
    if (!tabs.includes(id)) tabs = [...tabs, id];
    updateVoiceControls();
    source.value = tab.source;
    highlightSource();
    saved = tab.saved;
    hasSavedVersion = true;
    title.textContent = id;
    diagnostics.replaceChildren();
    refreshTabs();
    renderList();
    await diagnose();
  }

  async function diagnose(): Promise<void> {
    if (!currentId) {
      diagnostics.replaceChildren();
      return;
    }
    const id = currentId;
    const draft = source.value;
    const result = await requestJson<{ diagnostics: ScriptDiagnostic[] }>(
      '/api/scripts/diagnose',
      jsonRequest('POST', { id, source: draft }),
    );
    if (id !== currentId || draft !== source.value) return;
    diagnostics.replaceChildren();
    if (result.diagnostics.length === 0) {
      diagnostics.innerHTML = '<div class="diagnostic">No diagnostics.</div>';
      return;
    }
    for (const item of result.diagnostics) {
      const row = document.createElement('div');
      row.className = `diagnostic ${item.severity}`;
      row.textContent = `Line ${item.line}: ${item.message}`;
      diagnostics.append(row);
    }
  }

  function scheduleDiagnose(): void {
    window.clearTimeout(diagnoseTimer);
    diagnoseTimer = window.setTimeout(() => void diagnose(), 300);
  }

  async function save(successMessage?: string): Promise<void> {
    if (!currentId || saving) return;
    const id = currentId;
    const sent = source.value;
    const base: ScriptFile | null = hasSavedVersion ? { id, source: saved } : null;
    refreshTabs();
    saving = true;
    updateVoiceControls();
    try {
      const stored = await saveDraft<ScriptFile>(
        `/api/scripts/${encodeURIComponent(id)}`,
        { id, source: sent },
        base,
      );
      const latest = currentId === id ? source.value : sessions.get(id)?.source ?? sent;
      const rebased = mergeText(sent, latest, stored.source);
      const draft = rebased.ok ? rebased.value : latest;
      sessions.set(id, { source: draft, saved: stored.source });
      if (currentId === id) {
        if (source.value !== draft) { source.value = draft; highlightSource(); }
        saved = stored.source;
        hasSavedVersion = true;
      }
      refreshTabs();
      showToast(rebased.ok ? successMessage ?? `Saved ${id}.` : `Saved ${id}, but newer edits could not be merged. Review your draft.`, !rebased.ok);
      if (currentId === id) scheduleDiagnose();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not save script';
      showToast(
        error instanceof ApiError && error.status === 409
          ? `${message}. Your unsaved script remains open.`
          : message, true,
      );
    } finally {
      saving = false;
      updateVoiceControls();
    }
  }

  async function setVoiceRequest(requested: boolean) {
    if (!currentId || saving) return;
    const start = source.selectionStart;
    const end = source.selectionEnd;
    const preceding = source.value.slice(0, start);
    const first = preceding.split('\n').length;
    // A selection ending at column one does not include that next line.
    const last = first + source.value.slice(start, Math.max(start, end - 1)).split('\n').length - 1;
    try {
      const result = setSelectedVoiceRequests(source.value, first, last, requested);
      if (result.count) {
        source.value = result.source;
        highlightSource();
        const lineStart = preceding.lastIndexOf('\n') + 1;
        const selectionEnd = end === start ? lineStart : result.source.split('\n').slice(0, last).join('\n').length;
        source.setSelectionRange(lineStart, selectionEnd);
        source.focus();
      }
      if (voiceIdStatus) {
        const skipped = result.skipped.map(({ line }) => line).join(', ');
        voiceIdStatus.textContent = `Updated ${result.count} dialogue ${result.count === 1 ? 'line' : 'lines'}.` +
          (skipped ? ` Skipped ${skipped}: ${result.skipped[0].reason}` : '');
      }
      if (result.count) await save();
    } catch (error) {
      await alertModal(error instanceof Error ? error.message : 'Could not change this voice request.');
    }
  }

  requestVoice.addEventListener('click', () => void setVoiceRequest(true));
  noVoice.addEventListener('click', () => void setVoiceRequest(false));
  generateIds.addEventListener('click', async () => {
    if (!currentId || saving) return;
    try {
      const updated = assignMissingVoiceIds(source.value, `${currentId}.rpgscript`);
      if (updated === source.value) {
        showToast('No missing voice IDs in this script.');
        return;
      }
      source.value = updated;
      highlightSource();
      refreshTabs();
      await save(`Generated voice IDs and saved ${currentId}.`);
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not generate voice IDs.', true);
    }
  });
  source.addEventListener('input', () => {
    highlightSource();
    refreshTabs();
    scheduleDiagnose();
  });
  root.querySelector('#save-script')?.addEventListener('click', () => void save());
  root.querySelector('#format-script')?.addEventListener('click', () => {
    if (!currentId || saving) return;
    try {
      const formatted = formatRpgScript(source.value);
      if (source.value === formatted) return showToast('Script is already formatted.');
      source.value = formatted;
      highlightSource();
      refreshTabs();
      scheduleDiagnose();
      showToast(`Formatted ${currentId}. Save to write changes.`);
    } catch (error) { showToast(error instanceof Error ? error.message : 'Could not format script', true); }
  });
  root.querySelector('#new-script')?.addEventListener('click', () => {
    void (async () => {
      const id = await askId('New script id');
      if (!id) return;
      if (!isScriptFileId(id))
        return void alertModal('Use a short script id with letters, numbers, hyphens, or underscores');
      if (files.includes(id)) {
        await alertModal('An asset with that id already exists');
        return;
      }
      try {
        await saveDraft(`/api/scripts/${encodeURIComponent(id)}`, { id, source: `@${id}\n` }, null);
        await reload();
        await openScript(id);
      } catch (error) {
        await alertModal(error instanceof Error ? error.message : 'Could not create script');
      }
    })();
  });
  root.querySelector('#duplicate-script')?.addEventListener('click', () => {
    if (!currentId) return;
    const from = currentId;
    void (async () => {
      const id = await askId('Duplicate as', `${from}-copy`);
      if (!id) return;
      if (!isScriptFileId(id))
        return void alertModal('Use a short script id with letters, numbers, hyphens, or underscores');
      try {
        await requestJson('/api/duplicate', jsonRequest('POST', { kind: 'script', from, id }));
        await reload();
        await openScript(id);
      } catch (error) {
        await alertModal(error instanceof Error ? error.message : 'Could not duplicate script');
      }
    })();
  });
  root.querySelector('#delete-script')?.addEventListener('click', () => {
    if (!currentId) return;
    const id = currentId;
    void (async () => {
      if (!(await confirmModal(`Delete ${id}?`, 'DELETE'))) return;
      try {
        await requestJson(`/api/scripts/${encodeURIComponent(id)}`, { method: 'DELETE' });
        await closeTab(id, true);
        await reload();
      } catch (error) { showToast(error instanceof Error ? error.message : 'Could not delete script', true); }
    })();
  });
  window.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      void save();
    }
  }, { signal: listeners.signal });

  const menus = root.querySelectorAll<HTMLDetailsElement>('.menubar .menu');
  for (const menu of menus) {
    menu.addEventListener('toggle', () => {
      if (menu.open) for (const other of menus) if (other !== menu) other.open = false;
    });
  }
  document.addEventListener('click', event => {
    if (event.target instanceof Element && !event.target.closest('.menubar summary'))
      for (const menu of menus) menu.open = false;
  }, { signal: listeners.signal });
  void reload().then(async () => {
    if (!alive || openToken) return;
    tabs = tabs.filter(id => files.includes(id) || isTabDirty(id));
    const active = restored.active && tabs.includes(restored.active) ? restored.active : tabs[0];
    if (active) await openScript(active);
    else refreshTabs();
  }).catch(error => showToast(error instanceof Error ? error.message : 'Could not load scripts', true));
  return () => {
    alive = false;
    listeners.abort();
    disposeResize?.();
    window.clearTimeout(diagnoseTimer);
    setDirtyGuard(null);
  };
}
