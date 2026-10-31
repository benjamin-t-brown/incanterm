import { paletteRgb, type PaletteDocument } from '../../palette.js';
import type { AssetFolders } from '../../asset-folders.js';
import { assignCharacterAnimations } from '../../characters/auto-assign.js';
import { mergeJson } from '../../safe-save.js';
import {
  CHARACTER_STATES,
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
import { alertModal, confirmModal } from '../modal.js';
import { saveDraft } from '../save.js';
import { createSearchSelect } from '../search-select.js';
import { askId, pageShell, setDirtyGuard, setEditorAssetUrl } from '../shell.js';

export function mountCharacters(root: HTMLElement): () => void {
  root.innerHTML = pageShell(
    'Characters',
    `<aside class="anim-library character-library" aria-label="Characters">
    <input id="character-search" class="text-input" type="search" placeholder="SEARCH" aria-label="Search characters">
    <div id="character-list" class="asset-list anim-library-list"></div>
  </aside><section class="character-app" aria-label="Character editor">
    <div class="toolbar-row"><button id="new-character" type="button">NEW</button>
      <button id="save-character" type="button" disabled>SAVE</button>
      <button id="delete-character" type="button" disabled>DELETE</button>
      <strong id="character-id">NO CHARACTER</strong></div>
    <p id="character-status" class="page-copy" role="status">Create a character or select one from the list.</p>
    <div id="character-fields" class="character-fields" hidden>
      <div><label class="character-label">DEFAULT FACING <select id="character-facing" class="text-input">
        <option value="up">UP</option><option value="down">DOWN</option>
        <option value="left">LEFT</option><option value="right">RIGHT</option></select></label>
        <h2>IDLE, WALK &amp; TALKING</h2><p class="page-copy">Assign an animation clip to each state. Diagonal walking uses horizontal facing.</p>
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
  let clips: string[] = [];
  let clipLabels: Record<string, string> = {};
  let animationFolders: AssetFolders = { folders: [], placements: {} };
  let palette: PaletteDocument | null = null;
  let current: CharacterDocument | null = null;
  let saved: CharacterDocument | null = null;
  const dirty = () => current !== null && JSON.stringify(current) !== JSON.stringify(saved);
  const message = (error: unknown) =>
    error instanceof Error ? error.message : 'Character request failed';
  setDirtyGuard(
    async () => !dirty() || confirmModal('Discard unsaved character changes?', 'DISCARD'),
  );

  function renderList(): void {
    list.replaceChildren();
    const matches = files.filter((id) => id.includes(search.value.trim().toLowerCase()));
    if (!matches.length) list.textContent = files.length ? 'No matches.' : 'No characters.';
    for (const id of matches) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = id;
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
    $<HTMLElement>('#character-fields').hidden = !current;
    $<HTMLButtonElement>('#save-character').disabled = !current;
    $<HTMLButtonElement>('#delete-character').disabled = !current;
    $<HTMLElement>('#character-id').textContent = current?.id ?? 'NO CHARACTER';
    states.replaceChildren();
    custom.replaceChildren();
    const selected = previewState.value;
    previewState.replaceChildren();
    if (!current) {
      restartPreview();
      return;
    }
    $<HTMLSelectElement>('#character-facing').value = current.defaultFacing;
    for (const state of CHARACTER_STATES)
      states.append(stateRow(state, current.animations[state], false));
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
      requestJson<{ files: string[] }>('/api/characters'),
      requestJson<{ files: string[]; labels: Record<string, string> }>('/api/animations'),
      requestJson<PaletteDocument>('/api/palette'),
      requestJson<AssetFolders>('/api/animation-folders'),
    ]);
    if (!alive) return;
    files = characters.files;
    clips = animations.files;
    clipLabels = animations.labels;
    animationFolders = folders;
    palette = colors;
    renderFolderPicker();
    render();
  }

  async function open(id: string): Promise<void> {
    if (current?.id === id) return;
    if (dirty() && !(await confirmModal('Discard unsaved character changes?', 'DISCARD'))) return;
    const token = ++loading;
    try {
      const doc = await requestJson<CharacterDocument>(`/api/characters/${encodeURIComponent(id)}`);
      if (!alive || token !== loading) return;
      current = doc;
      saved = structuredClone(doc);
      setEditorAssetUrl(id);
      status.textContent = `Opened ${id}`;
      render();
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
        const merged = mergeJson(sent, current, stored);
        saved = stored;
        if (merged.ok) current = merged.value;
        status.textContent = merged.ok
          ? `Saved ${sent.id}`
          : `Saved ${sent.id}; newer edits need review`;
        setEditorAssetUrl(sent.id);
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
      const id = await askId('New character id');
      if (!id) return;
      if (!isAssetId(id)) return void alertModal('Use a short lowercase id');
      if (files.includes(id)) return void alertModal('An asset with that id already exists');
      if (!clips.length) return void alertModal('Create an animation before creating a character');
      if (dirty() && !(await confirmModal('Discard unsaved character changes?', 'DISCARD'))) return;
      ++loading;
      current = createCharacter(id, clips[0]);
      saved = null;
      setEditorAssetUrl(null);
      status.textContent = `New character ${id}`;
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
        current = null;
        saved = null;
        setEditorAssetUrl(null);
        status.textContent = 'Character deleted';
        await refresh();
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
  void preloadSpriteFonts()
    .then(async () => {
      await refresh();
      if (!alive) return;
      const id = new URLSearchParams(location.search).get('id');
      if (id) {
        if (isAssetId(id) && files.includes(id)) await open(id);
        else status.textContent = `Character ${id} not found`;
      }
    })
    .catch((error: unknown) => {
      if (alive) status.textContent = message(error);
    });
  return () => {
    alive = false;
    ++loading;
    ++previewToken;
    clearTimeout(timer);
    document.removeEventListener('keydown', onKeyDown);
    setDirtyGuard(null);
  };
}
