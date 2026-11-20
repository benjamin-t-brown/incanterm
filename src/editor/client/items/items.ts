import {
  createItem,
  parseItem,
  type ItemCombination,
  type ItemDocument,
} from '../../items/item-schema.js';
import {
  flattenSprite,
  getAnimationFrameFlips,
  isInvisibleFrame,
  type AnimationDocument,
  type SpriteDocument,
} from '../../schema.js';
import { getPaletteRgb, type PaletteDocument } from '../../palette.js';
import type { AssetFolders } from '../../asset-folders.js';
import { createAssetTree } from '../asset-tree.js';
import { FOLDER_ICON } from '../asset-tree-icons.js';
import { createPanelResizer } from '../panel-resizer.js';
import { createVisualAssetPicker } from '../visual-asset-picker.js';
import { renderTabCloseActions } from '../tab-close-actions.js';
import { renderTabReordering } from '../tab-reordering.js';
import { OPEN_ITEMS_KEY, readItemTabs, type ItemTabSession } from '../../items/item-tabs.js';
import { addOpenTab } from '../../tab-order.js';
import { jsonRequest, requestJson } from '../api.js';
import { confirmModal } from '../modal.js';
import { projectStorage } from '../project.js';
import { saveDraft } from '../save.js';
import { createSearchSelect } from '../search-select.js';
import { askId, createPageShell, setDirtyGuard, setEditorAssetUrl } from '../shell.js';
import { drawTerminalGlyph, fillTerminalCell } from '../terminal-renderer.js';
import { preloadSpriteFonts, terminalCellAtZoom } from '../../terminal-cell.js';

type AssetList = { files: string[]; labels: Record<string, string> };
const DRAFT_KEY = 'incanterm-item-draft';

export function mountItems(root: HTMLElement): () => void {
  root.innerHTML = createPageShell(
    'Items',
    `
    <aside class="anim-library item-library" aria-label="Items"><input id="item-search" class="text-input" type="search" placeholder="SEARCH" aria-label="Search items" autocomplete="off" spellcheck="false">
      <div class="asset-tree-toolbar"><span>FOLDERS</span><div class="asset-tree-toolbar-actions"><button id="item-new-folder" type="button" title="New folder" aria-label="New folder">${FOLDER_ICON}</button></div></div>
      <div id="item-list" class="anim-library-list"></div></aside>
    <div id="item-library-resizer" class="panel-resizer" role="separator" aria-label="Resize item folders" aria-orientation="vertical" aria-controls="item-list" tabindex="0" title="Drag to resize; double-click to reset"></div>
    <section class="item-app prop-app" aria-label="Item editor">
      <div class="toolbar-row asset-create-header"><button id="item-new" type="button">NEW</button></div>
      <div id="item-tabs" class="prop-tabs" role="tablist" aria-label="Open items"></div>
      <div class="toolbar-row"><button id="item-save" type="button" disabled>SAVE</button><button id="item-delete" type="button" disabled>DELETE</button></div>
      <p id="item-status" role="status">Create or open an item.</p>
      <div id="item-fields" hidden><div class="item-form">
        <label>LABEL<input id="item-label" class="text-input" maxlength="80"></label>
        <small>Scripts can reference this item by its label or stable asset ID.</small>
        <h2>APPEARANCE</h2><label>VISUAL TYPE<select id="item-visual-type" class="text-input"><option value="sprite">SPRITE</option><option value="animation">ANIMATION</option></select></label>
        <div class="prop-asset-field"><span>ASSET</span><span id="item-visual"></span><button id="item-choose-visual" type="button">CHOOSE ASSET…</button></div>
        <canvas id="item-preview" width="360" height="180" aria-label="Item visual preview"></canvas>
        <h2>SCRIPTS</h2><label>EXAMINE<span id="item-examine"></span></label><label>COMBINATION FAILED<span id="item-fail"></span></label>
        <small>Scripts are zero-argument @scripts. They control consuming ingredients and granting results.</small>
        <h2>COMBINATIONS</h2><div id="item-rules"></div><button id="item-add-rule" type="button">ADD COMBINATION</button>
        <small>Targets are asset IDs. Item-to-item recipes also work in reverse; a rule on the selected item takes priority.</small>
      </div></div></section>`,
  );
  root.querySelector('.simple-main')?.classList.add('item-main');
  const get$ = <T extends Element>(selector: string): T => {
    const node = root.querySelector<T>(selector);
    if (!node) throw new Error(`Missing ${selector}`);
    return node;
  };
  const disposeResizer = createPanelResizer({
    container: get$<HTMLElement>('.item-main'),
    panel: get$<HTMLElement>('.item-library'),
    handle: get$<HTMLElement>('#item-library-resizer'),
    storageKey: 'incanterm-item-library-width',
    defaultWidth: 200,
  });
  let alive = true;
  let token = 0;
  let saving = false;
  let current: ItemDocument | null = null;
  let base: ItemDocument | null = null;
  let files: AssetList = { files: [], labels: {} };
  const assets: Record<string, AssetList> = {};
  let scriptNames: string[] = [];
  const status = get$<HTMLElement>('#item-status');
  const canvas = get$<HTMLCanvasElement>('#item-preview');
  const context = canvas.getContext('2d');
  let preview: (
    | { sprite: SpriteDocument; index: number; flipH: boolean; flipV: boolean }
    | undefined
  )[] = [];
  let durations: number[] = [];
  let previewLoop = true;
  let palette: PaletteDocument | undefined;
  let previewStarted = Date.now();
  let previewToken = 0;
  let newFolder = '';
  const storedTabs = readItemTabs(projectStorage);
  let openTabs = storedTabs.tabs;
  const sessions = new Map<string, ItemTabSession>(Object.entries(storedTabs.drafts));
  const assetPicker = createVisualAssetPicker({
    root,
    loadSheet: (id) => requestJson<SpriteDocument>(`/api/sprites/${encodeURIComponent(id)}`),
    paintSprite,
  });

  function isDirty(): boolean {
    return JSON.stringify(current) !== JSON.stringify(base);
  }
  function showError(error: unknown): void {
    if (alive) status.textContent = error instanceof Error ? error.message : 'Item request failed';
  }
  function persistDraft(): void {
    try {
      const drafts: Record<string, ItemTabSession> = {};
      for (const id of openTabs) {
        const session = getSession(id);
        if (session && (isTabDirty(id) || session.folder)) drafts[id] = session;
      }
      projectStorage.setItem(
        OPEN_ITEMS_KEY,
        JSON.stringify({
          version: 1,
          tabs: openTabs,
          active: current?.id ?? null,
          drafts,
        }),
      );
    } catch {
      /* A full browser store must not prevent editing. */
    }
  }
  function updateDirty(): void {
    persistDraft();
    renderTabs();
    get$<HTMLButtonElement>('#item-save').disabled =
      !current || saving || (!isDirty() && !newFolder);
  }
  function getSession(id: string): ItemTabSession | undefined {
    return id === current?.id && current
      ? { doc: current, base, folder: newFolder }
      : sessions.get(id);
  }
  function isTabDirty(id: string): boolean {
    const session = getSession(id);
    return !!session && JSON.stringify(session.doc) !== JSON.stringify(session.base);
  }
  setDirtyGuard(
    async () =>
      !openTabs.some(isTabDirty) ||
      (!saving && (await confirmModal('Discard unsaved item changes?', 'DISCARD'))),
  );
  function renderTabs(): void {
    const host = get$<HTMLElement>('#item-tabs');
    renderTabCloseActions(host, { tabs: openTabs, active: current?.id ?? null, closeTab });
    host.replaceChildren();
    if (!openTabs.length) {
      const empty = document.createElement('span');
      empty.className = 'prop-tabs-empty';
      empty.textContent = 'NO ITEM';
      host.append(empty);
    }
    for (const id of openTabs) {
      const tab = document.createElement('div');
      tab.className = 'prop-tab editor-document-tab';
      tab.dataset.tabId = id;
      tab.setAttribute('role', 'tab');
      tab.setAttribute('aria-selected', String(current?.id === id));
      tab.classList.toggle('current', current?.id === id);
      tab.classList.toggle('dirty', isTabDirty(id));
      const label = document.createElement('button');
      label.type = 'button';
      label.className = 'prop-tab-label';
      label.textContent = getSession(id)?.doc.label ?? files.labels[id] ?? id;
      const mark = document.createElement('span');
      mark.className = 'prop-dirty-mark';
      mark.textContent = ' ●';
      label.append(mark);
      label.addEventListener('click', () => void openItem(id).catch(showError));
      const close = document.createElement('button');
      close.type = 'button';
      close.className = 'prop-tab-close';
      close.setAttribute('aria-label', `Close ${id}`);
      close.textContent = '×';
      close.addEventListener('click', () => void closeTab(id).catch(showError));
      tab.addEventListener('auxclick', (event) => {
        if (event.button !== 1) return;
        event.preventDefault();
        void closeTab(id).catch(showError);
      });
      tab.append(label, close);
      host.append(tab);
    }
    renderTabReordering(host, {
      tabs: openTabs,
      onReorder: (tabs) => {
        openTabs = tabs;
        persistDraft();
        renderTabs();
      },
    });
  }
  function activateItem(session: ItemTabSession): void {
    if (current) sessions.set(current.id, { doc: current, base, folder: newFolder });
    current = session.doc;
    base = session.base;
    newFolder = session.folder;
    sessions.delete(current.id);
    openTabs = addOpenTab(openTabs, current.id);
    renderFields();
  }
  async function closeTab(id: string): Promise<void> {
    if (saving || !openTabs.includes(id)) return;
    if (isTabDirty(id) && !(await confirmModal('Discard unsaved item changes?', 'DISCARD'))) return;
    const index = openTabs.indexOf(id);
    const next = openTabs[index + 1] ?? openTabs[index - 1];
    openTabs = openTabs.filter((tab) => tab !== id);
    sessions.delete(id);
    if (current?.id === id) {
      ++token;
      current = base = null;
      newFolder = '';
      renderFields();
      if (next) await openItem(next);
    } else updateDirty();
  }
  const tree = createAssetTree({
    list: get$<HTMLElement>('#item-list'),
    search: get$<HTMLInputElement>('#item-search'),
    label: 'ITEMS',
    assetName: 'item',
    storageKey: 'incanterm-item-folders-expanded',
    onSelect: (id) => void openItem(id).catch(showError),
    onCreateAsset: (folder) => {
      void createNewItem(folder).catch(showError);
    },
    onChange: async (change) => {
      if (
        change.action === 'delete' &&
        (change.expectedIds.some(isTabDirty) ||
          openTabs.some((id) => {
            const folder = getSession(id)?.folder;
            return folder && (folder === change.folder || folder.startsWith(`${change.folder}/`));
          }))
      )
        throw new Error('Save or close unsaved item drafts before deleting this folder');
      const folders = await requestJson<AssetFolders>(
        '/api/item-folders',
        jsonRequest('POST', change),
      );
      if (change.action === 'delete') {
        for (const id of change.expectedIds) sessions.delete(id);
        openTabs = openTabs.filter((id) => !change.expectedIds.includes(id));
        if (current && change.expectedIds.includes(current.id)) {
          ++token;
          current = base = null;
          newFolder = '';
        }
        renderFields();
        await refreshLibrary();
        const next = openTabs[openTabs.length - 1];
        if (!current && next) await openItem(next);
      }
      return folders;
    },
    askName: askId,
    confirmDelete: (folder, entries) =>
      confirmModal(`Delete ${folder} and ${entries.length} items?`, 'DELETE'),
    onError: (message) => showError(new Error(message)),
  });

  async function refreshLibrary(): Promise<void> {
    const [list, folders] = await Promise.all([
      requestJson<AssetList>('/api/items'),
      requestJson<AssetFolders>('/api/item-folders'),
    ]);
    if (!alive) return;
    files = list;
    assets.item = list;
    tree.setData(list.files, folders, list.labels);
    tree.select(current?.id ?? null);
  }
  async function openItem(id: string): Promise<void> {
    if (saving || id === current?.id) return;
    const requestToken = ++token;
    const session = sessions.get(id);
    if (session) {
      activateItem(session);
      return;
    }
    const item = await requestJson<ItemDocument>(`/api/items/${encodeURIComponent(id)}`);
    if (!alive || requestToken !== token) return;
    activateItem({ doc: item, base: structuredClone(item), folder: '' });
  }
  async function createNewItem(folder = ''): Promise<void> {
    if (saving) return;
    const label = await askId('Item label');
    if (!alive || saving || !label) return;
    const sprite = assets.sprite?.files[0];
    const animation = assets.animation?.files[0];
    if (!sprite && !animation) throw new Error('Create a sprite or animation first');
    ++token;
    const item = createItem(
      crypto.randomUUID(),
      sprite
        ? { type: 'sprite', id: sprite, index: 0 }
        : { type: 'animation', id: animation ?? '' },
      label,
    );
    activateItem({ doc: item, base: null, folder });
  }
  function renderScriptPicker(
    host: HTMLElement,
    value: string,
    onChange: (value: string) => void,
  ): void {
    host.replaceChildren(
      createSearchSelect({
        value,
        choices: scriptNames,
        placeholder: 'Search or paste @script name…',
        ariaLabel: 'RPGScript name',
        onInput: (value) => {
          onChange(value.trim().replace(/^@/, ''));
          updateDirty();
        },
      }),
    );
  }
  function renderRules(): void {
    const host = get$<HTMLElement>('#item-rules');
    host.replaceChildren();
    const item = current;
    if (!item) return;
    item.combinations.forEach((rule, index) => {
      const row = document.createElement('div');
      row.className = 'item-rule';
      const type = document.createElement('select');
      type.setAttribute('aria-label', 'Combination target type');
      for (const kind of ['item', 'prop', 'character'])
        type.append(new Option(kind.toUpperCase(), kind));
      type.value = rule.targetType;
      type.addEventListener('change', () => {
        rule.targetType = type.value as ItemCombination['targetType'];
        rule.target = '';
        updateDirty();
        renderRules();
      });
      const targetLabel = document.createElement('label');
      targetLabel.textContent = 'TARGET ASSET';
      const inventory = assets[rule.targetType];
      targetLabel.append(
        createSearchSelect({
          value: rule.target,
          choices: inventory?.files ?? [],
          labels: inventory?.labels,
          placeholder: 'Choose target asset…',
          ariaLabel: 'Combination target asset',
          onInput: (value) => {
            rule.target = value.trim();
            updateDirty();
          },
        }),
      );
      const scriptLabel = document.createElement('label');
      scriptLabel.textContent = 'SCRIPT';
      const picker = document.createElement('span');
      renderScriptPicker(picker, rule.script, (value) => {
        rule.script = value;
      });
      scriptLabel.append(picker);
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.textContent = 'REMOVE RULE';
      remove.addEventListener('click', () => {
        item.combinations.splice(index, 1);
        updateDirty();
        renderRules();
      });
      row.append(type, targetLabel, scriptLabel, remove);
      host.append(row);
    });
  }
  function renderVisualPicker(): void {
    const item = current;
    if (!item) return;
    const list = assets[item.visual.type];
    get$<HTMLSelectElement>('#item-visual-type').value = item.visual.type;
    get$<HTMLElement>('#item-visual').textContent =
      (list?.labels[item.visual.id] ?? item.visual.id) +
      (item.visual.type === 'sprite' ? ` · FRAME ${item.visual.index + 1}` : '');
  }
  async function chooseVisual(type: ItemDocument['visual']['type']): Promise<void> {
    const item = current;
    if (!item || saving) return;
    const visual = await assetPicker.open(type, item.visual);
    if (!visual || !alive || current !== item || saving) return;
    item.visual = visual;
    renderVisualPicker();
    updateDirty();
    void loadPreview().catch(showError);
  }
  function renderFields(): void {
    get$<HTMLElement>('#item-fields').hidden = !current;
    get$<HTMLButtonElement>('#item-delete').disabled = !base || saving;
    setEditorAssetUrl(current?.id ?? null);
    tree.select(current?.id ?? null);
    if (!current) {
      preview = [];
      ++previewToken;
      status.textContent = 'Create or open an item.';
      updateDirty();
      return;
    }
    status.textContent = current.id;
    get$<HTMLInputElement>('#item-label').value = current.label;
    renderVisualPicker();
    renderScriptPicker(get$('#item-examine'), current.examineScript ?? '', (value) => {
      if (current) current.examineScript = value || undefined;
    });
    renderScriptPicker(get$('#item-fail'), current.combineFailScript ?? '', (value) => {
      if (current) current.combineFailScript = value || undefined;
    });
    renderRules();
    updateDirty();
    void loadPreview().catch(showError);
  }
  async function loadPreview(): Promise<void> {
    const item = current;
    const requestToken = ++previewToken;
    preview = [];
    if (!item?.visual.id) return;
    const visual = structuredClone(item.visual);
    const clip =
      visual.type === 'animation'
        ? await requestJson<AnimationDocument>(`/api/animations/${encodeURIComponent(visual.id)}`)
        : undefined;
    const frames = clip?.frames ?? [
      { sprite: visual.id, index: visual.type === 'sprite' ? visual.index : 0, durationMs: 1000 },
    ];
    const loaded = await Promise.all(
      frames.map(async (frame) => {
        if (isInvisibleFrame(frame)) return undefined;
        const sprite = await requestJson<SpriteDocument>(
          `/api/sprites/${encodeURIComponent(frame.sprite)}`,
        );
        return {
          sprite,
          index: frame.index,
          ...(clip ? getAnimationFrameFlips(clip, frame) : { flipH: false, flipV: false }),
        };
      }),
    );
    if (!alive || requestToken !== previewToken) return;
    // Invisible frames retain their timing; an empty sprite is drawn for those frames.
    preview = loaded;
    durations = frames.map((frame) => frame.durationMs);
    previewLoop = clip?.loop ?? true;
    previewStarted = Date.now();
    drawPreview();
  }
  function drawPreview(): void {
    if (!context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    const total = durations.reduce((sum, duration) => sum + duration, 0);
    let elapsed =
      previewLoop && total ? (Date.now() - previewStarted) % total : Date.now() - previewStarted;
    let frameIndex = 0;
    while (frameIndex < durations.length - 1 && elapsed >= durations[frameIndex])
      elapsed -= durations[frameIndex++];
    const frame = preview[frameIndex];
    if (frame) paintSprite(canvas, frame.sprite, frame.index, frame);
  }
  function paintSprite(
    target: HTMLCanvasElement,
    sprite: SpriteDocument,
    index: number,
    flips?: { flipH: boolean; flipV: boolean },
  ): void {
    const context = target.getContext('2d');
    if (!context) return;
    context.clearRect(0, 0, target.width, target.height);
    if (!palette || !sprite.sprites[index]) return;
    const cell = terminalCellAtZoom(
      context,
      Math.max(
        0.1,
        Math.min(2, target.width / (sprite.width * 12), target.height / (sprite.height * 24)),
      ),
      sprite.font,
    );
    const cells = flattenSprite(sprite, index);
    for (let y = 0; y < sprite.height; y++)
      for (let x = 0; x < sprite.width; x++) {
        const sourceX = flips?.flipH ? sprite.width - x - 1 : x;
        const sourceY = flips?.flipV ? sprite.height - y - 1 : y;
        const value = cells[sourceY * sprite.width + sourceX];
        const px = (target.width - sprite.width * cell.width) / 2 + x * cell.width;
        const py = (target.height - sprite.height * cell.height) / 2 + y * cell.height;
        context.fillStyle = getPaletteRgb(palette, value.bg) ?? '#000000';
        fillTerminalCell(context, cell, px, py);
        context.fillStyle = getPaletteRgb(palette, value.fg) ?? '#ffffff';
        drawTerminalGlyph(context, cell, value.ch, px, py);
      }
  }
  async function saveItem(): Promise<void> {
    if (!current || saving || (!isDirty() && !newFolder)) return;
    const parsed = parseItem(current);
    if (!parsed.ok) throw new Error(parsed.error);
    saving = true;
    ++token;
    get$<HTMLElement>('#item-fields').inert = true;
    updateDirty();
    const draft = structuredClone(parsed.value);
    try {
      const result = await saveDraft<ItemDocument>(
        `/api/items/${encodeURIComponent(draft.id)}`,
        draft,
        base,
      );
      if (!alive) return;
      // Inputs are disabled while saving so the accepted snapshot is the current draft.
      base = result;
      current = structuredClone(result);
      if (newFolder) {
        await requestJson(
          '/api/item-folders',
          jsonRequest('POST', { action: 'move', id: result.id, folder: newFolder }),
        );
        newFolder = '';
      }
      await refreshLibrary();
    } finally {
      saving = false;
      if (alive) {
        get$<HTMLElement>('#item-fields').inert = false;
        renderFields();
        if (!isDirty()) status.textContent = `Saved ${current?.label}`;
      }
    }
  }
  get$<HTMLButtonElement>('#item-new').addEventListener(
    'click',
    () => void createNewItem().catch(showError),
  );
  get$<HTMLButtonElement>('#item-save').addEventListener('click', () => {
    void saveItem().catch(showError);
  });
  get$<HTMLButtonElement>('#item-new-folder').addEventListener(
    'click',
    () => void tree.createFolder(),
  );
  get$<HTMLButtonElement>('#item-delete').addEventListener(
    'click',
    () =>
      void (async () => {
        if (!current || saving || !(await confirmModal(`Delete ${current.label}?`, 'DELETE')))
          return;
        await requestJson(`/api/items/${encodeURIComponent(current.id)}`, { method: 'DELETE' });
        if (!alive) return;
        ++token;
        const deletedId = current.id;
        const index = openTabs.indexOf(deletedId);
        const next = openTabs[index + 1] ?? openTabs[index - 1];
        openTabs = openTabs.filter((id) => id !== deletedId);
        sessions.delete(deletedId);
        current = base = null;
        newFolder = '';
        renderFields();
        await refreshLibrary();
        if (next) await openItem(next);
      })().catch(showError),
  );
  get$<HTMLInputElement>('#item-label').addEventListener('input', (event) => {
    if (current) current.label = (event.target as HTMLInputElement).value;
    updateDirty();
  });
  get$<HTMLSelectElement>('#item-visual-type').addEventListener('change', (event) => {
    if (!current) return;
    const type = (event.target as HTMLSelectElement).value === 'animation' ? 'animation' : 'sprite';
    get$<HTMLSelectElement>('#item-visual-type').value = current.visual.type;
    void chooseVisual(type).catch(showError);
  });
  get$<HTMLButtonElement>('#item-choose-visual').addEventListener('click', () => {
    if (current) void chooseVisual(current.visual.type).catch(showError);
  });
  get$<HTMLButtonElement>('#item-add-rule').addEventListener('click', () => {
    current?.combinations.push({ targetType: 'item', target: '', script: '' });
    updateDirty();
    renderRules();
  });
  async function loadItemEditorAssets(): Promise<void> {
    await preloadSpriteFonts();
    const [sprites, animations, props, characters, scripts, colors] = await Promise.all([
      requestJson<AssetList>('/api/sprites'),
      requestJson<AssetList>('/api/animations'),
      requestJson<AssetList>('/api/props'),
      requestJson<AssetList>('/api/characters'),
      requestJson<{ sources: Record<string, string[]> }>('/api/scripts/names'),
      requestJson<PaletteDocument>('/api/palette'),
    ]);
    if (!alive) return;
    Object.assign(assets, {
      sprite: sprites,
      animation: animations,
      prop: props,
      character: characters,
    });
    scriptNames = Object.keys(scripts.sources).sort();
    palette = colors;
    await refreshLibrary();
    if (!alive) return;
    openTabs = openTabs.filter((id) => files.files.includes(id) || sessions.has(id));
    let restored = false;
    try {
      const draft = openTabs.length
        ? null
        : JSON.parse(projectStorage.getItem(DRAFT_KEY) ?? 'null');
      if (draft?.doc) {
        const parsed = parseItem(draft.doc);
        const saved = draft.base === null ? null : parseItem(draft.base);
        if (parsed.ok && (saved === null || saved.ok)) {
          activateItem({ doc: parsed.value, base: saved?.value ?? null, folder: '' });
          projectStorage.removeItem(DRAFT_KEY);
          restored = true;
        }
      }
    } catch {
      /* Ignore corrupt local drafts. */
    }
    if (!restored) {
      const id = new URLSearchParams(location.search).get('id');
      const preferred =
        id && (files.files.includes(id) || sessions.has(id))
          ? id
          : storedTabs.active && openTabs.includes(storedTabs.active)
            ? storedTabs.active
            : openTabs[openTabs.length - 1];
      if (preferred) await openItem(preferred);
      else renderFields();
    }
  }
  function handleKeyDown(event: KeyboardEvent): void {
    if (!(event.ctrlKey || event.metaKey) || event.altKey || event.key.toLowerCase() !== 's')
      return;
    event.preventDefault();
    if (!assetPicker.isOpen()) void saveItem().catch(showError);
  }
  document.addEventListener('keydown', handleKeyDown);
  window.addEventListener('pagehide', persistDraft);
  void loadItemEditorAssets().catch(showError);
  const timer = setInterval(drawPreview, 50);
  return () => {
    persistDraft();
    alive = false;
    ++token;
    ++previewToken;
    clearInterval(timer);
    disposeResizer();
    assetPicker.dispose();
    document.removeEventListener('keydown', handleKeyDown);
    window.removeEventListener('pagehide', persistDraft);
    setDirtyGuard(null);
  };
}
