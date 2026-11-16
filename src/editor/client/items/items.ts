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
    <aside class="item-library"><input id="item-search" class="text-input" type="search" placeholder="SEARCH ITEMS" aria-label="Search items">
      <button id="item-new-folder" type="button">NEW FOLDER</button><div id="item-list"></div></aside>
    <section class="item-app"><h1>ITEMS</h1>
      <div class="toolbar-row"><button id="item-new" type="button">NEW</button><button id="item-save" type="button" disabled>SAVE</button><button id="item-delete" type="button" disabled>DELETE</button></div>
      <p id="item-status" role="status">Create or open an item.</p>
      <div id="item-fields" hidden><div class="item-form">
        <label>LABEL<input id="item-label" class="text-input" maxlength="80"></label>
        <label>SCRIPT NAME<input id="item-script-name" class="text-input" placeholder="OfficeEnvelope"></label>
        <small>Scripts can use the stable asset ID or this unique name.</small>
        <h2>APPEARANCE</h2><label>VISUAL TYPE<select id="item-visual-type" class="text-input"><option value="sprite">SPRITE</option><option value="animation">ANIMATION</option></select></label>
        <label>ASSET<span id="item-visual"></span></label><label id="item-frame-label">SPRITE FRAME (ZERO BASED)<input id="item-frame" class="text-input" type="number" min="0" max="255"></label>
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

  function isDirty(): boolean {
    return JSON.stringify(current) !== JSON.stringify(base);
  }
  function showError(error: unknown): void {
    if (alive) status.textContent = error instanceof Error ? error.message : 'Item request failed';
  }
  function persistDraft(): void {
    try {
      if (current && isDirty())
        projectStorage.setItem(DRAFT_KEY, JSON.stringify({ doc: current, base }));
      else projectStorage.removeItem(DRAFT_KEY);
    } catch {
      /* A full browser store must not prevent editing. */
    }
  }
  function updateDirty(): void {
    persistDraft();
    get$<HTMLButtonElement>('#item-save').disabled = !current || saving || !isDirty();
  }
  async function canLeave(): Promise<boolean> {
    if (!isDirty()) return true;
    if (saving || !(await confirmModal('Discard unsaved item changes?', 'DISCARD'))) return false;
    current = base ? structuredClone(base) : null;
    persistDraft();
    return true;
  }
  setDirtyGuard(canLeave);
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
      if (change.action === 'delete' && current && change.expectedIds.includes(current.id))
        throw new Error('Close the open item before deleting its folder');
      const folders = await requestJson<AssetFolders>(
        '/api/item-folders',
        jsonRequest('POST', change),
      );
      if (change.action === 'delete') await refreshLibrary();
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
    if (saving || id === current?.id || !(await canLeave())) return;
    const requestToken = ++token;
    const item = await requestJson<ItemDocument>(`/api/items/${encodeURIComponent(id)}`);
    if (!alive || requestToken !== token) return;
    current = item;
    base = structuredClone(item);
    newFolder = '';
    renderFields();
  }
  async function createNewItem(folder = ''): Promise<void> {
    if (saving || !(await canLeave())) return;
    const label = await askId('Item label');
    if (!alive || !label) return;
    const sprite = assets.sprite?.files[0];
    const animation = assets.animation?.files[0];
    if (!sprite && !animation) throw new Error('Create a sprite or animation first');
    ++token;
    current = createItem(
      crypto.randomUUID(),
      sprite
        ? { type: 'sprite', id: sprite, index: 0 }
        : { type: 'animation', id: animation ?? '' },
      label,
    );
    base = null;
    newFolder = folder;
    renderFields();
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
    get$<HTMLElement>('#item-frame-label').hidden = item.visual.type !== 'sprite';
    get$<HTMLElement>('#item-visual').replaceChildren(
      createSearchSelect({
        value: item.visual.id,
        choices: list?.files ?? [],
        labels: list?.labels,
        placeholder: 'Choose appearance…',
        ariaLabel: 'Item visual asset',
        onInput: (value) => {
          item.visual.id = value.trim();
          updateDirty();
          void loadPreview().catch(showError);
        },
      }),
    );
  }
  function renderFields(): void {
    get$<HTMLElement>('#item-fields').hidden = !current;
    get$<HTMLButtonElement>('#item-delete').disabled = !base || saving;
    setEditorAssetUrl(current?.id ?? null);
    tree.select(current?.id ?? null);
    if (!current) {
      preview = [];
      updateDirty();
      return;
    }
    status.textContent = current.id;
    get$<HTMLInputElement>('#item-label').value = current.label;
    get$<HTMLInputElement>('#item-script-name').value = current.scriptName ?? '';
    get$<HTMLSelectElement>('#item-visual-type').value = current.visual.type;
    get$<HTMLInputElement>('#item-frame').value = String(
      current.visual.type === 'sprite' ? current.visual.index : 0,
    );
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
    if (!frame || !palette || !frame.sprite.sprites[frame.index]) return;
    const { sprite } = frame;
    const cell = terminalCellAtZoom(
      context,
      Math.max(0.25, Math.min(2, 30 / sprite.width, 10 / sprite.height)),
      sprite.font,
    );
    const cells = flattenSprite(sprite, frame.index);
    for (let y = 0; y < sprite.height; y++)
      for (let x = 0; x < sprite.width; x++) {
        const sourceX = frame.flipH ? sprite.width - x - 1 : x;
        const sourceY = frame.flipV ? sprite.height - y - 1 : y;
        const value = cells[sourceY * sprite.width + sourceX];
        const px = (canvas.width - sprite.width * cell.width) / 2 + x * cell.width;
        const py = (canvas.height - sprite.height * cell.height) / 2 + y * cell.height;
        context.fillStyle = getPaletteRgb(palette, value.bg) ?? '#000000';
        fillTerminalCell(context, cell, px, py);
        context.fillStyle = getPaletteRgb(palette, value.fg) ?? '#ffffff';
        drawTerminalGlyph(context, cell, value.ch, px, py);
      }
  }
  async function saveItem(): Promise<void> {
    if (!current || saving) return;
    const parsed = parseItem(current);
    if (!parsed.ok) throw new Error(parsed.error);
    saving = true;
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
      status.textContent = `Saved ${result.label}`;
    } finally {
      saving = false;
      if (alive) {
        get$<HTMLElement>('#item-fields').inert = false;
        renderFields();
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
        current = base = null;
        renderFields();
        await refreshLibrary();
      })().catch(showError),
  );
  get$<HTMLInputElement>('#item-label').addEventListener('input', (event) => {
    if (current) current.label = (event.target as HTMLInputElement).value;
    updateDirty();
  });
  get$<HTMLInputElement>('#item-script-name').addEventListener('input', (event) => {
    if (current) current.scriptName = (event.target as HTMLInputElement).value.trim() || undefined;
    updateDirty();
  });
  get$<HTMLSelectElement>('#item-visual-type').addEventListener('change', (event) => {
    if (!current) return;
    current.visual =
      (event.target as HTMLSelectElement).value === 'sprite'
        ? { type: 'sprite', id: assets.sprite?.files[0] ?? '', index: 0 }
        : { type: 'animation', id: assets.animation?.files[0] ?? '' };
    renderVisualPicker();
    updateDirty();
    void loadPreview().catch(showError);
  });
  get$<HTMLInputElement>('#item-frame').addEventListener('change', (event) => {
    if (current?.visual.type === 'sprite')
      current.visual.index = Number((event.target as HTMLInputElement).value);
    updateDirty();
    void loadPreview().catch(showError);
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
    let restored = false;
    try {
      const draft = JSON.parse(projectStorage.getItem(DRAFT_KEY) ?? 'null');
      if (draft?.doc) {
        const parsed = parseItem(draft.doc);
        const saved = draft.base === null ? null : parseItem(draft.base);
        if (parsed.ok && (saved === null || saved.ok)) {
          current = parsed.value;
          base = saved?.value ?? null;
          restored = true;
        }
      }
    } catch {
      /* Ignore corrupt local drafts. */
    }
    if (restored) renderFields();
    else {
      const id = new URLSearchParams(location.search).get('id');
      if (id && files.files.includes(id)) await openItem(id);
    }
  }
  void loadItemEditorAssets().catch(showError);
  const timer = setInterval(drawPreview, 50);
  return () => {
    persistDraft();
    alive = false;
    ++token;
    ++previewToken;
    clearInterval(timer);
    setDirtyGuard(null);
  };
}
