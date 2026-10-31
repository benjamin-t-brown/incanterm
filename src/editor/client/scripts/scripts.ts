import type { ScriptDiagnostic } from '../../rpgscript/diagnose.js';
import { isAssetId } from '../../schema.js';
import { ApiError, jsonRequest, requestJson } from '../api.js';
import { mergeText } from '../../safe-save.js';
import { saveDraft } from '../save.js';
import { alertModal, confirmModal } from '../modal.js';
import { askId, pageShell, setDirtyGuard } from '../shell.js';

type ScriptFile = { id: string; source: string };

export function mountScripts(root: HTMLElement): () => void {
  root.innerHTML = pageShell(
    'Script writer',
    `<h1 class="page-title">Script writer</h1>
    <p class="page-copy">Edit RPGScript. Parse errors and missing callScript targets are errors. Unknown commands are warnings.</p>
    <div class="split">
      <div>
        <div class="toolbar-row"><button type="button" id="new-script">NEW</button></div>
        <div id="script-list" class="asset-list"></div>
      </div>
      <div>
        <div class="toolbar-row">
          <strong id="script-id">No script</strong>
          <button type="button" id="save-script">SAVE</button>
          <button type="button" id="duplicate-script">DUPLICATE</button>
          <button type="button" id="delete-script">DELETE</button>
        </div>
        <textarea id="script-source" class="script-box" spellcheck="false"></textarea>
        <div id="diagnostics" class="diagnostics"></div>
      </div>
    </div>`,
  );
  const listNode = root.querySelector<HTMLElement>('#script-list');
  const sourceNode = root.querySelector<HTMLTextAreaElement>('#script-source');
  const diagnosticsNode = root.querySelector<HTMLElement>('#diagnostics');
  const titleNode = root.querySelector('#script-id');
  if (!listNode || !sourceNode || !diagnosticsNode || !titleNode) return () => undefined;
  const list: HTMLElement = listNode;
  const source: HTMLTextAreaElement = sourceNode;
  const diagnostics: HTMLElement = diagnosticsNode;
  const title: Element = titleNode;

  let files: string[] = [];
  let currentId: string | null = null;
  let saved = '';
  let hasSavedVersion = false;
  let saving = false;
  let diagnoseTimer = 0;

  const dirty = () => currentId !== null && source.value !== saved;
  setDirtyGuard(async () => !dirty() || confirmModal('Discard unsaved script changes?', 'DISCARD'));

  async function reload(): Promise<void> {
    files = (await requestJson<{ files: string[] }>('/api/scripts')).files;
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
    if (dirty() && !(await confirmModal('Discard unsaved script changes?', 'DISCARD'))) return;
    const file = await requestJson<ScriptFile>(`/api/scripts/${encodeURIComponent(id)}`);
    currentId = file.id;
    source.value = file.source;
    saved = file.source;
    hasSavedVersion = true;
    title.textContent = file.id;
    await diagnose();
    await reload();
  }

  async function diagnose(): Promise<void> {
    if (!currentId) {
      diagnostics.replaceChildren();
      return;
    }
    const result = await requestJson<{ diagnostics: ScriptDiagnostic[] }>(
      '/api/scripts/diagnose',
      jsonRequest('POST', { id: currentId, source: source.value }),
    );
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

  async function save(): Promise<void> {
    if (!currentId || saving) return;
    const id = currentId;
    const sent = source.value;
    const base: ScriptFile | null = hasSavedVersion ? { id, source: saved } : null;
    saving = true;
    try {
      const stored = await saveDraft<ScriptFile>(
        `/api/scripts/${encodeURIComponent(id)}`,
        { id, source: sent },
        base,
      );
      if (currentId === id) {
        const rebased = mergeText(sent, source.value, stored.source);
        if (rebased.ok) {
          source.value = rebased.value;
          saved = stored.source;
          hasSavedVersion = true;
          await diagnose();
        } else await alertModal('Saved, but newer edits could not be rebased. Review your draft.');
      }
      await reload();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not save script';
      await alertModal(
        error instanceof ApiError && error.status === 409
          ? `${message}. Your unsaved script remains open.`
          : message,
      );
    } finally {
      saving = false;
    }
  }

  source.addEventListener('input', scheduleDiagnose);
  root.querySelector('#save-script')?.addEventListener('click', () => void save());
  root.querySelector('#new-script')?.addEventListener('click', () => {
    void (async () => {
      const id = await askId('New script id');
      if (!id || !isAssetId(id)) return;
      if (files.includes(id)) {
        await alertModal('An asset with that id already exists');
        return;
      }
      if (dirty() && !(await confirmModal('Discard unsaved script changes?', 'DISCARD'))) return;
      try {
        await saveDraft(`/api/scripts/${encodeURIComponent(id)}`, { id, source: `@${id}\n` }, null);
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
      if (!id || !isAssetId(id)) return;
      void requestJson('/api/duplicate', jsonRequest('POST', { kind: 'script', from, id })).then(
        () => openScript(id),
      );
    })();
  });
  root.querySelector('#delete-script')?.addEventListener('click', () => {
    if (!currentId) return;
    const id = currentId;
    void (async () => {
      if (!(await confirmModal(`Delete ${id}?`, 'DELETE'))) return;
      await requestJson(`/api/scripts/${encodeURIComponent(id)}`, { method: 'DELETE' });
      currentId = null;
      source.value = '';
      saved = '';
      hasSavedVersion = false;
      title.textContent = 'No script';
      diagnostics.replaceChildren();
      await reload();
    })();
  });
  root.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      void save();
    }
  });

  void reload();
  return () => {
    window.clearTimeout(diagnoseTimer);
    setDirtyGuard(null);
  };
}
