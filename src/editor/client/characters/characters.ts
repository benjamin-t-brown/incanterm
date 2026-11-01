import { paletteRgb, type PaletteDocument } from '../../palette.js';
import type { AssetFolders } from '../../asset-folders.js';
import {
  assignCharacterAnimations,
  characterFromAnimationFolder,
} from '../../characters/auto-assign.js';
import { rebaseJsonDraft } from '../../safe-save.js';
import {
  neighborCharacterTab,
  OPEN_CHARACTERS_KEY,
  readCharacterTabs,
  type CharacterTabSession,
} from '../../characters/character-tabs.js';
import {
  CHARACTER_STATES,
  characterLabelError,
  createCharacter,
  flattenSprite,
  isAssetId,
  isInvisibleFrame,
  animationFrameFlips,
  type AnimationDocument,
  type CharacterDocument,
  type SpriteDocument,
} from '../../schema.js';
import { preloadSpriteFonts, terminalCellAtZoom } from '../../terminal-cell.js';
import { drawTerminalGlyph, fillTerminalCell } from '../terminal-renderer.js';
import { ApiError, requestJson } from '../api.js';
import { alertModal, askAssetMeta, confirmModal } from '../modal.js';
import { saveDraft } from '../save.js';
import { createSearchSelect } from '../search-select.js';
import { askId, pageShell, setDirtyGuard, setEditorAssetUrl } from '../shell.js';
import { characterListEntries } from './character-list.js';

export function mountCharacters(root: HTMLElement): () => void {
  root.innerHTML = pageShell(
    'Characters',
    `<aside class="anim-library character-library" aria-label="Characters">
    <input id="character-search" class="text-input" type="search" placeholder="SEARCH" aria-label="Search characters">
    <div id="character-list" class="asset-list anim-library-list"></div>
  </aside><section class="character-app" aria-label="Character editor">
    <div id="character-tabs" class="prop-tabs" role="tablist" aria-label="Open characters"></div>
    <div class="toolbar-row"><button id="new-character" type="button">NEW</button>
      <button id="new-character-from-folder" type="button">NEW FROM ANIMATION FOLDER</button>
      <button id="rename-character" type="button" disabled>RENAME</button>
      <button id="save-character" type="button" disabled>SAVE</button>
      <button id="delete-character" type="button" disabled>DELETE</button>
      <strong id="character-id">NO CHARACTER</strong><small id="character-stable-id"></small></div>
    <p id="character-status" class="page-copy" role="status">Create a character or select one from the list.</p>
    <div id="character-fields" class="character-fields" hidden>
      <div class="character-settings"><label class="character-label">DEFAULT FACING <select id="character-facing" class="text-input">
        <option value="up">UP</option><option value="down">DOWN</option>
        <option value="left">LEFT</option><option value="right">RIGHT</option></select></label>
        <h2>IDLE, WALK &amp; TALKING</h2><p class="page-copy">Assign an animation clip for each direction of every state. Diagonal walking uses horizontal facing.</p>
        <div class="character-folder-fill"><label class="character-label">ANIMATION FOLDER
          <span id="character-folder-picker"></span></label>
          <button id="character-fill-folder" type="button">FILL FROM FOLDER</button></div>
        <div id="character-states" class="character-state-list"></div>
        <h2>OTHER STATES</h2><div id="character-custom" class="character-state-list"></div>
        <button id="add-character-state" type="button">+ CUSTOM STATE</button>
      </div><div class="character-preview"><h2>PREVIEW</h2>
        <label class="character-label">STATE <select id="character-preview-state" class="text-input"></select></label>
        <canvas id="character-canvas" width="360" height="240" aria-label="Character animation preview"></canvas>
        <p id="character-preview-info" class="page-copy"></p>
        <p class="page-copy">Animation clips and sprites can be edited in their own tools.</p>
        <a id="character-edit-animation" href="/animation" target="_blank" rel="noopener noreferrer">EDIT ANIMATION ↗</a>
       </div></div>
    <dialog id="character-from-folder-dialog" aria-labelledby="character-from-folder-title">
      <form id="character-from-folder-form">
        <h2 id="character-from-folder-title">NEW FROM ANIMATION FOLDER</h2>
        <p class="page-copy">Choose a folder with all 12 idle, walk, and talking animations.</p>
        <label class="character-label">ANIMATION FOLDER<span id="new-character-folder-picker"></span></label>
        <label class="character-label">CHARACTER LABEL<input id="new-character-label" class="text-input" type="text" maxlength="80" autocomplete="off" spellcheck="false" required></label>
        <p id="character-from-folder-error" class="page-copy" role="alert" hidden></p>
        <div class="character-from-folder-actions"><button id="cancel-character-from-folder" type="button">CANCEL</button><button type="submit">CREATE CHARACTER</button></div>
      </form>
    </dialog>
  </section>`,
  );
  root.querySelector('.simple-main')?.classList.add('prop-main');
  const $ = <T extends Element>(selector: string): T => {
    const node = root.querySelector<T>(selector);
    if (!node) throw new Error(`Missing ${selector}`);
    return node;
  };
  const list = $<HTMLElement>('#character-list');
  const search = $<HTMLInputElement>('#character-search');
  const status = $<HTMLElement>('#character-status');
  const states = $<HTMLElement>('#character-states');
  const custom = $<HTMLElement>('#character-custom');
  const previewState = $<HTMLSelectElement>('#character-preview-state');
  const canvas = $<HTMLCanvasElement>('#character-canvas');
  const drawing = canvas.getContext('2d');
  if (!drawing) throw new Error('Canvas unavailable');
  const ctx: CanvasRenderingContext2D = drawing;
  let alive = true;
  let loading = 0;
  let saving = false;
  let previewToken = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let files: string[] = [];
  let characterLabels: Record<string, string> = {};
  let clips: string[] = [];
  let clipLabels: Record<string, string> = {};
  let animationFolders: AssetFolders = { folders: [], placements: {} };
  let palette: PaletteDocument | null = null;
  let current: CharacterDocument | null = null;
  let saved: CharacterDocument | null = null;
  const storedTabs = readCharacterTabs(localStorage);
  let openTabs = storedTabs.tabs;
  const sessions = new Map<string, CharacterTabSession>(Object.entries(storedTabs.drafts));
  let persistTimer: ReturnType<typeof setTimeout> | null = null;
  const tabDirty = (id: string) => {
    const session = id === current?.id ? { doc: current, saved } : sessions.get(id);
    return !!session && JSON.stringify(session.doc) !== JSON.stringify(session.saved);
  };
  const message = (error: unknown) =>
    error instanceof Error ? error.message : 'Character request failed';
  setDirtyGuard(
    async () =>
      !openTabs.some(tabDirty) || confirmModal('Discard unsaved character changes?', 'DISCARD'),
  );

  function persistTabs(): void {
    if (persistTimer) clearTimeout(persistTimer);
    persistTimer = null;
    const drafts: Record<string, CharacterTabSession> = {};
    for (const id of openTabs) {
      const session = id === current?.id && current ? { doc: current, saved } : sessions.get(id);
      if (session && JSON.stringify(session.doc) !== JSON.stringify(session.saved))
        drafts[id] = session;
    }
    try {
      localStorage.setItem(
        OPEN_CHARACTERS_KEY,
        JSON.stringify({ version: 1, tabs: openTabs, active: current?.id ?? null, drafts }),
      );
    } catch {
      status.textContent = 'Could not store open character drafts locally';
    }
  }
  function scheduleTabs(): void {
    if (persistTimer) clearTimeout(persistTimer);
    persistTimer = setTimeout(persistTabs, 400);
  }
  function renderTabs(): void {
    const host = $<HTMLElement>('#character-tabs');
    host.replaceChildren();
    if (!openTabs.length) {
      const empty = document.createElement('span');
      empty.className = 'prop-tabs-empty';
      empty.textContent = 'NO CHARACTER';
      host.append(empty);
    }
    for (const id of openTabs) {
      const tab = document.createElement('div');
      tab.className = 'prop-tab';
      tab.setAttribute('role', 'tab');
      tab.setAttribute('aria-selected', String(current?.id === id));
      tab.classList.toggle('current', current?.id === id);
      tab.classList.toggle('dirty', tabDirty(id));
      const label = document.createElement('button');
      label.type = 'button';
      label.className = 'prop-tab-label';
      label.textContent =
        id === current?.id
          ? current.label
          : (sessions.get(id)?.doc.label ?? characterLabels[id] ?? id);
      const mark = document.createElement('span');
      mark.className = 'prop-dirty-mark';
      mark.textContent = ' ●';
      label.append(mark);
      label.addEventListener('click', () => void open(id));
      const close = document.createElement('button');
      close.type = 'button';
      close.className = 'prop-tab-close';
      close.setAttribute('aria-label', `Close ${label.textContent}`);
      close.textContent = '×';
      close.addEventListener('click', () => void closeTab(id));
      tab.addEventListener('auxclick', (event) => {
        if (event.button === 1) {
          event.preventDefault();
          void closeTab(id);
        }
      });
      tab.append(label, close);
      host.append(tab);
    }
  }
  function activateCharacter(doc: CharacterDocument, baseline: CharacterDocument | null): void {
    if (current) sessions.set(current.id, { doc: current, saved });
    sessions.delete(doc.id);
    current = doc;
    saved = baseline;
    if (!openTabs.includes(doc.id)) openTabs.push(doc.id);
    setEditorAssetUrl(baseline ? doc.id : null);
    render();
    persistTabs();
  }
  async function closeTab(id: string): Promise<void> {
    if (!openTabs.includes(id) || saving) return;
    if (tabDirty(id) && !(await confirmModal('Discard unsaved character changes?', 'DISCARD')))
      return;
    const next = neighborCharacterTab(openTabs, id);
    openTabs = openTabs.filter((tab) => tab !== id);
    sessions.delete(id);
    if (current?.id === id) {
      ++loading;
      current = null;
      saved = null;
      setEditorAssetUrl(null);
      if (next) await open(next);
      else {
        status.textContent = 'Open a character from the list.';
        render();
      }
    } else renderTabs();
    persistTabs();
  }

  function renderList(): void {
    list.replaceChildren();
    const matches = characterListEntries(files, characterLabels, current, search.value);
    if (!matches.length)
      list.textContent = files.length || current ? 'No matches.' : 'No characters.';
    for (const { id, label } of matches) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = label;
      button.classList.toggle('active', id === current?.id);
      button.addEventListener('click', () => void open(id));
      list.append(button);
    }
  }

  function stateRow(name: string, animation: string, extra: boolean): HTMLElement {
    const row = document.createElement('div');
    row.className = 'character-state-row';
    const label = document.createElement('label');
    label.textContent = name.toUpperCase();
    const display = (id: string) =>
      clips.includes(id) ? `${clipLabels[id] ?? id} · ${id}` : `${id} (missing)`;
    const choices = [...new Set([...clips, animation])];
    const byDisplay = new Map(choices.map((id) => [display(id), id]));
    const picker = createSearchSelect({
      value: display(animation),
      choices: [...byDisplay.keys()],
      ariaLabel: `${name} animation`,
      placeholder: 'Search animations…',
      onInput: () => {},
      onCommit: (value) => {
        if (!current) return;
        const id = byDisplay.get(value);
        const input = picker.querySelector('input') as HTMLInputElement;
        if (!id) {
          input.value = display(
            extra
              ? current.customAnimations[name]
              : current.animations[name as (typeof CHARACTER_STATES)[number]],
          );
          return;
        }
        if (extra) current.customAnimations[name] = id;
        else current.animations[name as (typeof CHARACTER_STATES)[number]] = id;
        renderTabs();
        scheduleTabs();
        restartPreview();
      },
    });
    label.append(picker);
    row.append(label);
    if (extra) {
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.textContent = 'REMOVE';
      remove.setAttribute('aria-label', `Remove ${name}`);
      remove.addEventListener('click', () => {
        if (!current) return;
        delete current.customAnimations[name];
        render();
      });
      row.append(remove);
    }
    return row;
  }

  function render(): void {
    renderList();
    renderTabs();
    scheduleTabs();
    $<HTMLElement>('#character-fields').hidden = !current;
    $<HTMLButtonElement>('#save-character').disabled = !current;
    $<HTMLButtonElement>('#rename-character').disabled = !current;
    $<HTMLButtonElement>('#delete-character').disabled = !current;
    $<HTMLElement>('#character-id').textContent = current?.label ?? 'NO CHARACTER';
    $<HTMLElement>('#character-stable-id').textContent = current ? `ID ${current.id}` : '';
    states.replaceChildren();
    custom.replaceChildren();
    const selected = previewState.value;
    previewState.replaceChildren();
    if (!current) {
      restartPreview();
      return;
    }
    $<HTMLSelectElement>('#character-facing').value = current.defaultFacing;
    const movement = document.createElement('div');
    movement.className = 'character-state-column';
    const talking = document.createElement('div');
    talking.className = 'character-state-column';
    for (const [group, names, column] of [
      ['IDLE', CHARACTER_STATES.slice(0, 4), movement],
      ['WALK', CHARACTER_STATES.slice(4, 8), movement],
      ['TALKING', CHARACTER_STATES.slice(8), talking],
    ] as const) {
      const heading = document.createElement('h3');
      heading.textContent = group;
      column.append(heading);
      for (const state of names) column.append(stateRow(state, current.animations[state], false));
    }
    states.append(movement, talking);
    const invisible = document.createElement('div');
    invisible.className = 'character-state-row';
    invisible.textContent = 'INVISIBLE · no animation';
    custom.append(invisible);
    for (const [name, id] of Object.entries(current.customAnimations)) {
      const row = stateRow(name, id, true);
      if (name === 'invisible')
        row.querySelector('label')?.prepend('LEGACY INVISIBLE ANIMATION (NOT USED) · ');
      custom.append(row);
    }
    for (const state of [
      ...CHARACTER_STATES,
      'invisible',
      ...Object.keys(current.customAnimations).filter((name) => name !== 'invisible'),
    ]) {
      const option = document.createElement('option');
      option.value = state;
      option.textContent = state.toUpperCase();
      previewState.append(option);
    }
    previewState.value =
      [...CHARACTER_STATES, ...Object.keys(current.customAnimations)].includes(selected) ||
      selected === 'invisible'
        ? selected
        : `idle-${current.defaultFacing}`;
    restartPreview();
  }

  function restartPreview(): void {
    clearTimeout(timer);
    const token = ++previewToken;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const character = current;
    if (!character) return;
    const state = previewState.value;
    const info = $<HTMLElement>('#character-preview-info');
    const editLink = $<HTMLAnchorElement>('#character-edit-animation');
    editLink.hidden = state === 'invisible';
    if (state === 'invisible') {
      info.textContent = 'Invisible · no animation';
      return;
    }
    const id =
      character.animations[state as (typeof CHARACTER_STATES)[number]] ??
      character.customAnimations[state];
    editLink.href = `/animation?id=${encodeURIComponent(id)}`;
    info.textContent = `Loading ${clipLabels[id] ?? id}…`;
    void (async () => {
      try {
        const clip = await requestJson<AnimationDocument>(
          `/api/animations/${encodeURIComponent(id)}`,
        );
        if (!alive || token !== previewToken) return;
        if (!clip.frames.length) {
          info.textContent = 'This animation has no frames.';
          return;
        }
        const sheets = new Map<string, SpriteDocument>();
        let index = 0;
        const draw = async () => {
          const frame = clip.frames[index];
          ctx.fillStyle = '#000';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          if (!isInvisibleFrame(frame)) {
            let sprite = sheets.get(frame.sprite);
            if (!sprite) {
              sprite = await requestJson<SpriteDocument>(
                `/api/sprites/${encodeURIComponent(frame.sprite)}`,
              );
              sheets.set(frame.sprite, sprite);
            }
            await document.fonts.ready;
            if (!alive || token !== previewToken) return;
            const cell = terminalCellAtZoom(
              ctx,
              Math.min(
                4,
                (canvas.width - 16) /
                  (sprite.width * terminalCellAtZoom(ctx, 1, sprite.font).width),
                (canvas.height - 16) /
                  (sprite.height * terminalCellAtZoom(ctx, 1, sprite.font).height),
              ),
              sprite.font,
            );
            const x0 = Math.floor((canvas.width - sprite.width * cell.width) / 2);
            const y0 = Math.floor((canvas.height - sprite.height * cell.height) / 2);
            const flips = animationFrameFlips(clip, frame);
            flattenSprite(sprite, frame.index).forEach((entry, at) => {
              const column = at % sprite.width;
              const row = Math.floor(at / sprite.width);
              const x = x0 + (flips.flipH ? sprite.width - 1 - column : column) * cell.width;
              const y = y0 + (flips.flipV ? sprite.height - 1 - row : row) * cell.height;
              ctx.fillStyle = palette ? (paletteRgb(palette, entry.bg) ?? '#000') : '#000';
              fillTerminalCell(ctx, cell, x, y);
              if (entry.ch !== ' ') {
                ctx.fillStyle = palette ? (paletteRgb(palette, entry.fg) ?? '#fff') : '#fff';
                drawTerminalGlyph(ctx, cell, entry.ch, x, y);
              }
            });
          }
          info.textContent = `${clip.label} · frame ${index + 1} / ${clip.frames.length}`;
          if (index < clip.frames.length - 1 || clip.loop) {
            index = (index + 1) % clip.frames.length;
            timer = setTimeout(() => {
              void draw().catch((error: unknown) => {
                if (alive && token === previewToken) info.textContent = message(error);
              });
            }, frame.durationMs);
          }
        };
        await draw();
      } catch (error) {
        if (alive && token === previewToken) info.textContent = message(error);
      }
    })();
  }

  async function refresh(): Promise<void> {
    const [characters, animations, colors, folders] = await Promise.all([
      requestJson<{ files: string[]; labels: Record<string, string> }>('/api/characters'),
      requestJson<{ files: string[]; labels: Record<string, string> }>('/api/animations'),
      requestJson<PaletteDocument>('/api/palette'),
      requestJson<AssetFolders>('/api/animation-folders'),
    ]);
    if (!alive) return;
    files = characters.files;
    openTabs = openTabs.filter(
      (id) => files.includes(id) || id === current?.id || (sessions.has(id) && tabDirty(id)),
    );
    for (const id of sessions.keys()) if (!openTabs.includes(id)) sessions.delete(id);
    characterLabels = characters.labels;
    clips = animations.files;
    clipLabels = animations.labels;
    animationFolders = folders;
    palette = colors;
    renderFolderPicker();
    render();
  }

  async function open(id: string): Promise<void> {
    if (current?.id === id || saving) return;
    const token = ++loading;
    const cached = sessions.get(id);
    if (cached) {
      activateCharacter(cached.doc, cached.saved);
      status.textContent = `Opened ${id}`;
      return;
    }
    try {
      const doc = await requestJson<CharacterDocument>(`/api/characters/${encodeURIComponent(id)}`);
      if (!alive || token !== loading) return;
      activateCharacter(doc, structuredClone(doc));
      status.textContent = `Opened ${id}`;
    } catch (error) {
      if (alive && token === loading) status.textContent = message(error);
    }
  }

  async function save(): Promise<void> {
    if (!current || saving) return;
    const sent = structuredClone(current);
    const base = saved;
    saving = true;
    try {
      const stored = await saveDraft(`/api/characters/${encodeURIComponent(sent.id)}`, sent, base);
      if (alive && current?.id === sent.id) {
        const merged = rebaseJsonDraft(sent, current, stored);
        saved = merged.ok ? merged.value.baseline : structuredClone(stored);
        if (merged.ok) current = merged.value.draft;
        status.textContent = merged.ok
          ? `Saved ${sent.id}`
          : `Saved ${sent.id}; newer edits need review`;
        setEditorAssetUrl(sent.id);
        renderTabs();
        scheduleTabs();
        await refresh();
      }
    } catch (error) {
      if (alive) {
        status.textContent = message(error);
        if (error instanceof ApiError && error.status === 409)
          await alertModal(`${message(error)}. Your unsaved character is still open.`);
      }
    } finally {
      saving = false;
    }
  }

  search.addEventListener('input', renderList);
  const folderPicker = $<HTMLElement>('#character-folder-picker');
  function renderFolderPicker(): void {
    const previous = folderPicker.querySelector<HTMLInputElement>('input')?.value ?? '';
    folderPicker.replaceChildren(
      createSearchSelect({
        value: previous,
        choices: animationFolders.folders,
        placeholder: 'Search animation folders…',
        ariaLabel: 'Animation folder',
        onInput: () => {},
      }),
    );
  }
  renderFolderPicker();
  const fromFolderDialog = $<HTMLDialogElement>('#character-from-folder-dialog');
  const fromFolderPicker = $<HTMLElement>('#new-character-folder-picker');
  const newCharacterLabel = $<HTMLInputElement>('#new-character-label');
  const fromFolderError = $<HTMLElement>('#character-from-folder-error');
  function showFolderError(text: string): void {
    fromFolderError.textContent = text;
    fromFolderError.hidden = false;
  }
  $<HTMLButtonElement>('#new-character-from-folder').addEventListener('click', () => {
    void (async () => {
      try {
        await refresh();
        if (!alive) return;
        newCharacterLabel.value = '';
        fromFolderError.hidden = true;
        fromFolderPicker.replaceChildren(
          createSearchSelect({
            value: '',
            choices: animationFolders.folders,
            placeholder: 'Search animation folders…',
            ariaLabel: 'New character animation folder',
            onInput: () => {},
            onCommit: (folder) => {
              if (animationFolders.folders.includes(folder)) {
                const name = folder.split('/').at(-1) ?? '';
                if (!newCharacterLabel.value.trim()) newCharacterLabel.value = name;
              }
            },
          }),
        );
        fromFolderDialog.showModal();
        fromFolderPicker.querySelector('input')?.focus();
      } catch (error) {
        status.textContent = message(error);
      }
    })();
  });
  $<HTMLButtonElement>('#cancel-character-from-folder').addEventListener('click', () =>
    fromFolderDialog.close(),
  );
  $<HTMLFormElement>('#character-from-folder-form').addEventListener('submit', (event) => {
    event.preventDefault();
    void (async () => {
      const folder = fromFolderPicker.querySelector<HTMLInputElement>('input')?.value.trim() ?? '';
      const label = newCharacterLabel.value.trim();
      if (!animationFolders.folders.includes(folder))
        return showFolderError('Select an existing animation folder.');
      const labelError = characterLabelError(label);
      if (labelError) return showFolderError(labelError);
      const id = crypto.randomUUID();
      const result = characterFromAnimationFolder(id, folder, animationFolders, clipLabels);
      if (!result.character)
        return showFolderError(
          [
            result.missing.length ? `Missing: ${result.missing.join(', ')}.` : '',
            result.ambiguous.length ? `Ambiguous: ${result.ambiguous.join(', ')}.` : '',
          ]
            .filter(Boolean)
            .join(' '),
        );
      if (!alive) return;
      ++loading;
      result.character.label = label;
      activateCharacter(result.character, null);
      fromFolderDialog.close();
      status.textContent = `New character ${label} from ${folder} · save to keep it`;
    })();
  });
  $<HTMLButtonElement>('#character-fill-folder').addEventListener('click', () => {
    if (!current) return;
    const folder = folderPicker.querySelector<HTMLInputElement>('input')?.value.trim() ?? '';
    if (!animationFolders.folders.includes(folder)) {
      status.textContent = 'Select an existing animation folder.';
      return;
    }
    const result = assignCharacterAnimations(current, folder, animationFolders, clipLabels);
    current.animations = result.animations;
    render();
    status.textContent = `Assigned ${result.matched} of ${CHARACTER_STATES.length} animations from ${folder}.${result.ambiguous.length ? ` Ambiguous: ${result.ambiguous.join(', ')}.` : ''}`;
  });
  previewState.addEventListener('change', restartPreview);
  $<HTMLSelectElement>('#character-facing').addEventListener('change', (event) => {
    if (!current) return;
    current.defaultFacing = (event.target as HTMLSelectElement)
      .value as CharacterDocument['defaultFacing'];
    renderTabs();
    scheduleTabs();
  });
  $<HTMLButtonElement>('#add-character-state').addEventListener('click', () => {
    void (async () => {
      if (!current) return;
      const id = await askId('Custom state name');
      if (!id) return;
      if (
        !isAssetId(id) ||
        id in current.customAnimations ||
        id === 'invisible' ||
        CHARACTER_STATES.includes(id as (typeof CHARACTER_STATES)[number])
      )
        return void alertModal('Use a unique lowercase state name');
      if (Object.keys(current.customAnimations).length >= 64)
        return void alertModal('Maximum 64 custom states');
      current.customAnimations[id] = clips[0] ?? current.animations['idle-down'];
      render();
    })();
  });
  $<HTMLButtonElement>('#new-character').addEventListener('click', () => {
    void (async () => {
      const entered = await askId('New character label');
      if (entered === null) return;
      const labelError = characterLabelError(entered);
      if (labelError) return void alertModal(labelError);
      if (!clips.length) return void alertModal('Create an animation before creating a character');
      if (!alive) return;
      const id = crypto.randomUUID();
      ++loading;
      activateCharacter(createCharacter(id, clips[0], entered), null);
      status.textContent = `New character ${entered}`;
    })();
  });
  $<HTMLButtonElement>('#rename-character').addEventListener('click', () => {
    void (async () => {
      const character = current;
      if (!character) return;
      const entered = await askAssetMeta('CHARACTER', character.label, character.id);
      if (entered === null || !alive || current !== character) return;
      const error = characterLabelError(entered);
      if (error) return void alertModal(error);
      character.label = entered.trim();
      render();
    })();
  });
  $<HTMLButtonElement>('#save-character').addEventListener('click', () => void save());
  $<HTMLButtonElement>('#delete-character').addEventListener('click', () => {
    void (async () => {
      if (!current || !(await confirmModal(`Delete ${current.id}?`, 'DELETE'))) return;
      const id = current.id;
      try {
        if (saved)
          await requestJson(`/api/characters/${encodeURIComponent(id)}`, { method: 'DELETE' });
        if (!alive || current?.id !== id) return;
        ++loading;
        openTabs = openTabs.filter((tab) => tab !== id);
        sessions.delete(id);
        current = null;
        saved = null;
        setEditorAssetUrl(null);
        status.textContent = 'Character deleted';
        await refresh();
        const next = openTabs[openTabs.length - 1];
        if (next) await open(next);
        else persistTabs();
      } catch (error) {
        if (alive) status.textContent = message(error);
      }
    })();
  });
  const onKeyDown = (event: KeyboardEvent) => {
    if (!root.isConnected || !(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 's')
      return;
    event.preventDefault();
    void save();
  };
  document.addEventListener('keydown', onKeyDown);
  window.addEventListener('pagehide', persistTabs);
  void preloadSpriteFonts()
    .then(async () => {
      await refresh();
      if (!alive) return;
      const id = new URLSearchParams(location.search).get('id');
      if (id) {
        if (isAssetId(id) && (files.includes(id) || sessions.has(id))) await open(id);
        else status.textContent = `Character ${id} not found`;
      } else {
        const preferred =
          storedTabs.active && openTabs.includes(storedTabs.active)
            ? storedTabs.active
            : openTabs[openTabs.length - 1];
        if (preferred) await open(preferred);
      }
    })
    .catch((error: unknown) => {
      if (alive) status.textContent = message(error);
    });
  return () => {
    alive = false;
    persistTabs();
    ++loading;
    ++previewToken;
    clearTimeout(timer);
    document.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('pagehide', persistTabs);
    setDirtyGuard(null);
  };
}
