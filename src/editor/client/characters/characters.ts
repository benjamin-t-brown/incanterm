import { getPaletteRgb, type PaletteDocument } from '../../palette.js';
import type { AssetFolders } from '../../asset-folders.js';
import {
  assignCharacterAnimations,
  getCharacterFromAnimationFolder,
} from '../../characters/auto-assign.js';
import { rebaseJsonDraft } from '../../safe-save.js';
import {
  getNeighborCharacterTab,
  OPEN_CHARACTERS_KEY,
  readCharacterTabs,
  type CharacterTabSession,
} from '../../characters/character-tabs.js';
import {
  CHARACTER_STATES,
  getCharacterLabelError,
  createCharacter,
  flattenSprite,
  isAssetId,
  isInvisibleFrame,
  getAnimationFrameFlips,
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
import { askId, createPageShell, setDirtyGuard, setEditorAssetUrl } from '../shell.js';
import { characterListEntries } from './character-list.js';
import { getPortraitAssetLabel } from '../../characters/portrait-label.js';

export function mountCharacters(root: HTMLElement): () => void {
  root.innerHTML = createPageShell(
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
         <label class="character-label">SCRIPT NAME <input id="character-script-name" class="text-input" placeholder="e.g. Eva" spellcheck="false"></label>
         <h2>CONVERSATION PORTRAITS</h2><p class="page-copy">Blank emotion is the default.</p>
         <div id="character-portraits" class="character-state-list"></div>
         <button id="add-character-portrait" type="button">+ PORTRAIT</button>
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
     <dialog id="character-portrait-dialog" aria-labelledby="character-portrait-title">
       <form id="character-portrait-form">
         <h2 id="character-portrait-title">ADD PORTRAIT</h2>
         <label>EMOTION <input id="portrait-emotion" class="text-input" placeholder="Default (blank)" spellcheck="false"></label>
         <label>DIRECTION <select id="portrait-direction" class="text-input"><option value="right">RIGHT</option><option value="left">LEFT</option></select></label>
         <label>SPRITE / ANIMATION <select id="portrait-kind" class="text-input"><option value="sprite">SPRITE</option><option value="animation">ANIMATION</option></select></label>
         <input id="portrait-search" class="text-input" type="search" placeholder="Search sprites…" aria-label="Search portrait assets">
         <div id="portrait-results" class="portrait-results" aria-label="Portrait assets"></div>
         <label id="portrait-frame-label" hidden>SPRITE FRAME <select id="portrait-frame" class="text-input"></select></label>
         <canvas id="portrait-preview" width="320" height="180" aria-label="Selected portrait preview"></canvas>
         <p id="portrait-picker-status" role="status">Select a sprite or animation.</p>
         <div class="portrait-actions"><button id="portrait-okay" type="submit" disabled>OK</button><button id="portrait-cancel" type="button">CANCEL</button></div>
       </form>
     </dialog>
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
  const get$ = <T extends Element>(selector: string): T => {
    const node = root.querySelector<T>(selector);
    if (!node) throw new Error(`Missing ${selector}`);
    return node;
  };
  const list = get$<HTMLElement>('#character-list');
  const search = get$<HTMLInputElement>('#character-search');
  const status = get$<HTMLElement>('#character-status');
  const states = get$<HTMLElement>('#character-states');
  const custom = get$<HTMLElement>('#character-custom');
  const previewState = get$<HTMLSelectElement>('#character-preview-state');
  const canvas = get$<HTMLCanvasElement>('#character-canvas');
  const portraitDialog = get$<HTMLDialogElement>('#character-portrait-dialog');
  const portraitForm = get$<HTMLFormElement>('#character-portrait-form');
  const portraitEmotion = get$<HTMLInputElement>('#portrait-emotion');
  const portraitDirection = get$<HTMLSelectElement>('#portrait-direction');
  const portraitKind = get$<HTMLSelectElement>('#portrait-kind');
  const portraitSearch = get$<HTMLInputElement>('#portrait-search');
  const portraitResults = get$<HTMLElement>('#portrait-results');
  const portraitFrame = get$<HTMLSelectElement>('#portrait-frame');
  const portraitFrameLabel = get$<HTMLElement>('#portrait-frame-label');
  const portraitCanvas = get$<HTMLCanvasElement>('#portrait-preview');
  const portraitStatus = get$<HTMLElement>('#portrait-picker-status');
  const portraitOkay = get$<HTMLButtonElement>('#portrait-okay');
  const drawing = canvas.getContext('2d');
  if (!drawing) throw new Error('Canvas unavailable');
  const ctx: CanvasRenderingContext2D = drawing;
  let alive = true;
  let loading = 0;
  let saving = false;
  let previewToken = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let portraitTimer: ReturnType<typeof setTimeout> | undefined;
  let portraitToken = 0;
  let portraitEditIndex: number | undefined;
  let portraitCharacterId: string | undefined;
  let portraitChoice: { kind: 'sprite' | 'animation'; id: string; index: number } | undefined;
  let files: string[] = [];
  let characterLabels: Record<string, string> = {};
  let clips: string[] = [];
  let spriteFiles: string[] = [];
  let spriteLabels: Record<string, string> = {};
  let clipLabels: Record<string, string> = {};
  let animationFolders: AssetFolders = { folders: [], placements: {} };
  let palette: PaletteDocument | null = null;
  const portraitSprites = new Map<string, Promise<SpriteDocument>>();
  const portraitAnimations = new Map<string, Promise<AnimationDocument>>();
  let current: CharacterDocument | null = null;
  let saved: CharacterDocument | null = null;
  const storedTabs = readCharacterTabs(localStorage);
  let openTabs = storedTabs.tabs;
  const sessions = new Map<string, CharacterTabSession>(Object.entries(storedTabs.drafts));
  let persistTimer: ReturnType<typeof setTimeout> | null = null;
  const isTabDirty = (id: string) => {
    const session = id === current?.id ? { doc: current, saved } : sessions.get(id);
    return !!session && JSON.stringify(session.doc) !== JSON.stringify(session.saved);
  };
  const showMessage = (error: unknown) =>
    error instanceof Error ? error.message : 'Character request failed';
  setDirtyGuard(
    async () =>
      !openTabs.some(isTabDirty) || confirmModal('Discard unsaved character changes?', 'DISCARD'),
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
    const host = get$<HTMLElement>('#character-tabs');
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
      tab.classList.toggle('dirty', isTabDirty(id));
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
    if (portraitDialog.open) portraitDialog.close();
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
    if (isTabDirty(id) && !(await confirmModal('Discard unsaved character changes?', 'DISCARD')))
      return;
    const next = getNeighborCharacterTab(openTabs, id);
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

  function getStateRow(name: string, animation: string, extra: boolean): HTMLElement {
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
    get$<HTMLElement>('#character-fields').hidden = !current;
    get$<HTMLButtonElement>('#save-character').disabled = !current;
    get$<HTMLButtonElement>('#rename-character').disabled = !current;
    get$<HTMLButtonElement>('#delete-character').disabled = !current;
    get$<HTMLElement>('#character-id').textContent = current?.label ?? 'NO CHARACTER';
    get$<HTMLElement>('#character-stable-id').textContent = current ? `ID ${current.id}` : '';
    states.replaceChildren();
    custom.replaceChildren();
    const selected = previewState.value;
    previewState.replaceChildren();
    if (!current) {
      restartPreview();
      return;
    }
    get$<HTMLSelectElement>('#character-facing').value = current.defaultFacing;
    get$<HTMLInputElement>('#character-script-name').value = current.scriptName ?? '';
    const portraitHost = get$<HTMLElement>('#character-portraits');
    portraitHost.replaceChildren();
    for (const [index, entry] of (current.portraits ?? []).entries()) {
      const row = document.createElement('div');
      row.className = 'character-state-row';
      const description = document.createElement('span');
      description.className = 'portrait-entry-description';
      description.textContent = `${entry.emotion || 'Default'} · ${entry.facing.toUpperCase()} · ${getPortraitAssetLabel(entry.portrait, spriteLabels, clipLabels)}`;
      const edit = document.createElement('button');
      edit.type = 'button';
      edit.textContent = 'EDIT';
      edit.addEventListener('click', () => void openPortraitPicker(index));
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.textContent = 'REMOVE';
      remove.addEventListener('click', () => {
        if (!current) return;
        current.portraits = current.portraits?.filter((portrait) => portrait !== entry);
        render();
      });
      row.append(description, edit, remove);
      portraitHost.append(row);
    }
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
      for (const state of names) column.append(getStateRow(state, current.animations[state], false));
    }
    states.append(movement, talking);
    const invisible = document.createElement('div');
    invisible.className = 'character-state-row';
    invisible.textContent = 'INVISIBLE · no animation';
    custom.append(invisible);
    for (const [name, id] of Object.entries(current.customAnimations)) {
      const row = getStateRow(name, id, true);
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
    const info = get$<HTMLElement>('#character-preview-info');
    const editLink = get$<HTMLAnchorElement>('#character-edit-animation');
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
            const flips = getAnimationFrameFlips(clip, frame);
            flattenSprite(sprite, frame.index).forEach((entry, at) => {
              const column = at % sprite.width;
              const row = Math.floor(at / sprite.width);
              const x = x0 + (flips.flipH ? sprite.width - 1 - column : column) * cell.width;
              const y = y0 + (flips.flipV ? sprite.height - 1 - row : row) * cell.height;
              ctx.fillStyle = palette ? (getPaletteRgb(palette, entry.bg) ?? '#000') : '#000';
              fillTerminalCell(ctx, cell, x, y);
              if (entry.ch !== ' ') {
                ctx.fillStyle = palette ? (getPaletteRgb(palette, entry.fg) ?? '#fff') : '#fff';
                drawTerminalGlyph(ctx, cell, entry.ch, x, y);
              }
            });
          }
          info.textContent = `${clip.label} · frame ${index + 1} / ${clip.frames.length}`;
          if (index < clip.frames.length - 1 || clip.loop) {
            index = (index + 1) % clip.frames.length;
            timer = setTimeout(() => {
              void draw().catch((error: unknown) => {
                if (alive && token === previewToken) info.textContent = showMessage(error);
              });
            }, frame.durationMs);
          }
        };
        await draw();
      } catch (error) {
        if (alive && token === previewToken) info.textContent = showMessage(error);
      }
    })();
  }

  function getPortraitSprite(id: string): Promise<SpriteDocument> {
    let pending = portraitSprites.get(id);
    if (!pending) {
      pending = requestJson<SpriteDocument>(`/api/sprites/${encodeURIComponent(id)}`);
      portraitSprites.set(id, pending);
    }
    return pending;
  }

  function getPortraitAnimation(id: string): Promise<AnimationDocument> {
    let pending = portraitAnimations.get(id);
    if (!pending) {
      pending = requestJson<AnimationDocument>(`/api/animations/${encodeURIComponent(id)}`);
      portraitAnimations.set(id, pending);
    }
    return pending;
  }

  async function drawPortraitSprite(
    target: HTMLCanvasElement,
    sprite: SpriteDocument,
    index: number,
    flips: { flipH: boolean; flipV: boolean } = { flipH: false, flipV: false },
  ): Promise<void> {
    const drawing = target.getContext('2d');
    if (!drawing) return;
    await document.fonts.ready;
    if (!alive || !target.isConnected || !portraitDialog.open) return;
    drawing.fillStyle = '#000';
    drawing.fillRect(0, 0, target.width, target.height);
    const native = terminalCellAtZoom(drawing, 1, sprite.font);
    const scale = Math.max(0.1, Math.min(4, (target.width - 12) / (sprite.width * native.width),
      (target.height - 12) / (sprite.height * native.height)));
    const cell = terminalCellAtZoom(drawing, scale, sprite.font);
    const x0 = (target.width - sprite.width * cell.width) / 2;
    const y0 = (target.height - sprite.height * cell.height) / 2;
    flattenSprite(sprite, index).forEach((entry, at) => {
      const column = at % sprite.width;
      const row = Math.floor(at / sprite.width);
      const x = x0 + (flips.flipH ? sprite.width - 1 - column : column) * cell.width;
      const y = y0 + (flips.flipV ? sprite.height - 1 - row : row) * cell.height;
      drawing.fillStyle = palette ? (getPaletteRgb(palette, entry.bg) ?? '#000') : '#000';
      fillTerminalCell(drawing, cell, x, y);
      if (entry.ch !== ' ') {
        drawing.fillStyle = palette ? (getPaletteRgb(palette, entry.fg) ?? '#fff') : '#fff';
        drawTerminalGlyph(drawing, cell, entry.ch, x, y);
      }
    });
  }

  async function drawPortraitAssetThumbnail(
    canvas: HTMLCanvasElement,
    kind: 'sprite' | 'animation',
    id: string,
  ): Promise<void> {
    if (kind === 'sprite') return drawPortraitSprite(canvas, await getPortraitSprite(id), 0);
    const animation = await getPortraitAnimation(id);
    const frame = animation.frames.find((entry) => !isInvisibleFrame(entry));
    if (!frame || isInvisibleFrame(frame)) return;
    await drawPortraitSprite(canvas, await getPortraitSprite(frame.sprite), frame.index,
      getAnimationFrameFlips(animation, frame));
  }

  function renderPortraitResults(): void {
    portraitResults.replaceChildren();
    if (!portraitDialog.open) return;
    const kind = portraitKind.value as 'sprite' | 'animation';
    const query = portraitSearch.value.trim().toLowerCase();
    const ids = kind === 'sprite' ? spriteFiles : clips;
    const labels = kind === 'sprite' ? spriteLabels : clipLabels;
    const matches = ids.filter((id) =>
      id.toLowerCase().includes(query) || (labels[id] ?? '').toLowerCase().includes(query));
    for (const id of matches.slice(0, 36)) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'portrait-asset-card';
      button.classList.toggle('active', portraitChoice?.kind === kind && portraitChoice.id === id);
      button.setAttribute('aria-label', `${labels[id] ?? id} (${kind})`);
      const thumbnail = document.createElement('canvas');
      thumbnail.width = 96;
      thumbnail.height = 60;
      const title = document.createElement('span');
      title.textContent = labels[id] ?? 'Unnamed asset';
      button.append(thumbnail, title);
      button.addEventListener('click', () => {
        portraitResults.querySelectorAll('.portrait-asset-card').forEach((card) => {
          card.classList.toggle('active', card === button);
        });
        void showPortraitChoice({ kind, id, index: 0 });
      });
      portraitResults.append(button);
      void drawPortraitAssetThumbnail(thumbnail, kind, id).catch(() => {
        title.textContent = `${labels[id] ?? id} (unavailable)`;
      });
    }
    if (!matches.length) portraitResults.textContent = 'No matching assets.';
  }

  async function showPortraitChoice(choice: { kind: 'sprite' | 'animation'; id: string; index: number }): Promise<void> {
    portraitChoice = choice;
    const token = ++portraitToken;
    clearTimeout(portraitTimer);
    portraitOkay.disabled = true;
    portraitFrameLabel.hidden = true;
    const drawing = portraitCanvas.getContext('2d');
    if (drawing) {
      drawing.fillStyle = '#000';
      drawing.fillRect(0, 0, portraitCanvas.width, portraitCanvas.height);
    }
    portraitStatus.textContent = `Loading ${(choice.kind === 'sprite' ? spriteLabels : clipLabels)[choice.id] ?? 'asset'}…`;
    try {
      if (choice.kind === 'sprite') {
        const sprite = await getPortraitSprite(choice.id);
        if (!alive || !portraitDialog.open || token !== portraitToken) return;
        portraitFrame.replaceChildren();
        for (let index = 0; index < sprite.sprites.length; index++)
          portraitFrame.append(new Option(`FRAME ${index + 1}`, String(index)));
        if (!sprite.sprites[choice.index]) choice.index = 0;
        portraitFrame.value = String(choice.index);
        portraitFrameLabel.hidden = sprite.sprites.length <= 1;
        portraitOkay.disabled = sprite.sprites.length === 0;
        portraitStatus.textContent = `${sprite.label} · frame ${choice.index + 1} / ${sprite.sprites.length}`;
        await drawPortraitSprite(portraitCanvas, sprite, choice.index);
      } else {
        const animation = await getPortraitAnimation(choice.id);
        if (!alive || !portraitDialog.open || token !== portraitToken) return;
        portraitOkay.disabled = !animation.frames.some((frame) => !isInvisibleFrame(frame));
        let index = 0;
        const drawFrame = async (): Promise<void> => {
          if (!alive || !portraitDialog.open || token !== portraitToken) return;
          const frame = animation.frames[index];
          if (!frame) return;
          if (!isInvisibleFrame(frame))
            await drawPortraitSprite(portraitCanvas, await getPortraitSprite(frame.sprite), frame.index,
              getAnimationFrameFlips(animation, frame));
          else {
            const preview = portraitCanvas.getContext('2d');
            preview?.clearRect(0, 0, portraitCanvas.width, portraitCanvas.height);
          }
          if (!alive || !portraitDialog.open || token !== portraitToken) return;
          portraitStatus.textContent = `${animation.label} · frame ${index + 1} / ${animation.frames.length}`;
          if (index < animation.frames.length - 1 || animation.loop) {
            index = (index + 1) % animation.frames.length;
            portraitTimer = setTimeout(() => void drawFrame().catch((error: unknown) => {
              portraitStatus.textContent = showMessage(error);
              portraitOkay.disabled = true;
            }), frame.durationMs);
          }
        };
        await drawFrame();
      }
    } catch (error) {
      if (alive && portraitDialog.open && token === portraitToken) {
        portraitStatus.textContent = showMessage(error);
        portraitOkay.disabled = true;
      }
    }
  }

  function openPortraitPicker(index?: number): void {
    if (!current || portraitDialog.open || (index === undefined && (current.portraits?.length ?? 0) >= 128)) return;
    portraitEditIndex = index;
    portraitCharacterId = current.id;
    const entry = index === undefined ? undefined : current.portraits?.[index];
    get$<HTMLElement>('#character-portrait-title').textContent = entry ? 'EDIT PORTRAIT' : 'ADD PORTRAIT';
    portraitEmotion.value = entry?.emotion ?? '';
    portraitDirection.value = entry?.facing ?? 'right';
    const spriteMatch = entry && /^(.+)_(\d+)$/.exec(entry.portrait);
    const isSprite = !!spriteMatch && spriteFiles.includes(spriteMatch[1]) && !clips.includes(entry.portrait);
    portraitKind.value = entry && !isSprite ? 'animation' : 'sprite';
    portraitSearch.value = '';
    portraitChoice = undefined;
    portraitOkay.disabled = true;
    portraitFrameLabel.hidden = true;
    portraitStatus.textContent = 'Select a sprite or animation.';
    portraitDialog.showModal();
    renderPortraitResults();
    if (entry) {
      const choice = isSprite && spriteMatch
        ? { kind: 'sprite' as const, id: spriteMatch[1], index: Number(spriteMatch[2]) }
        : { kind: 'animation' as const, id: entry.portrait, index: 0 };
      void showPortraitChoice(choice);
      renderPortraitResults();
    }
    portraitEmotion.focus();
  }

  async function refresh(): Promise<void> {
    const [characters, animations, sprites, colors, folders] = await Promise.all([
      requestJson<{ files: string[]; labels: Record<string, string> }>('/api/characters'),
      requestJson<{ files: string[]; labels: Record<string, string> }>('/api/animations'),
      requestJson<{ files: string[]; labels: Record<string, string> }>('/api/sprites'),
      requestJson<PaletteDocument>('/api/palette'),
      requestJson<AssetFolders>('/api/animation-folders'),
    ]);
    if (!alive) return;
    files = characters.files;
    openTabs = openTabs.filter(
      (id) => files.includes(id) || id === current?.id || (sessions.has(id) && isTabDirty(id)),
    );
    for (const id of sessions.keys()) if (!openTabs.includes(id)) sessions.delete(id);
    characterLabels = characters.labels;
    clips = animations.files;
    clipLabels = animations.labels;
    spriteFiles = sprites.files;
    spriteLabels = sprites.labels;
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
      if (alive && token === loading) status.textContent = showMessage(error);
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
        status.textContent = showMessage(error);
        if (error instanceof ApiError && error.status === 409)
          await alertModal(`${showMessage(error)}. Your unsaved character is still open.`);
      }
    } finally {
      saving = false;
    }
  }

  search.addEventListener('input', renderList);
  const folderPicker = get$<HTMLElement>('#character-folder-picker');
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
  const fromFolderDialog = get$<HTMLDialogElement>('#character-from-folder-dialog');
  const fromFolderPicker = get$<HTMLElement>('#new-character-folder-picker');
  const newCharacterLabel = get$<HTMLInputElement>('#new-character-label');
  const fromFolderError = get$<HTMLElement>('#character-from-folder-error');
  function showFolderError(text: string): void {
    fromFolderError.textContent = text;
    fromFolderError.hidden = false;
  }
  get$<HTMLButtonElement>('#new-character-from-folder').addEventListener('click', () => {
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
        status.textContent = showMessage(error);
      }
    })();
  });
  get$<HTMLButtonElement>('#cancel-character-from-folder').addEventListener('click', () =>
    fromFolderDialog.close(),
  );
  get$<HTMLFormElement>('#character-from-folder-form').addEventListener('submit', (event) => {
    event.preventDefault();
    void (async () => {
      const folder = fromFolderPicker.querySelector<HTMLInputElement>('input')?.value.trim() ?? '';
      const label = newCharacterLabel.value.trim();
      if (!animationFolders.folders.includes(folder))
        return showFolderError('Select an existing animation folder.');
      const labelError = getCharacterLabelError(label);
      if (labelError) return showFolderError(labelError);
      const id = crypto.randomUUID();
      const result = getCharacterFromAnimationFolder(id, folder, animationFolders, clipLabels);
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
  get$<HTMLButtonElement>('#character-fill-folder').addEventListener('click', () => {
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
  get$<HTMLSelectElement>('#character-facing').addEventListener('change', (event) => {
    if (!current) return;
    current.defaultFacing = (event.target as HTMLSelectElement)
      .value as CharacterDocument['defaultFacing'];
    renderTabs();
    scheduleTabs();
  });
  get$<HTMLInputElement>('#character-script-name').addEventListener('input', (event) => {
    if (!current) return;
    current.scriptName = (event.target as HTMLInputElement).value.trim() || undefined;
    scheduleTabs();
  });
  get$<HTMLButtonElement>('#add-character-portrait').addEventListener('click', () => {
    openPortraitPicker();
  });
  portraitKind.addEventListener('change', () => {
    portraitChoice = undefined;
    ++portraitToken;
    clearTimeout(portraitTimer);
    portraitOkay.disabled = true;
    portraitFrameLabel.hidden = true;
    portraitSearch.value = '';
    portraitSearch.placeholder = portraitKind.value === 'sprite' ? 'Search sprites…' : 'Search animations…';
    portraitStatus.textContent = 'Select a sprite or animation.';
    portraitCanvas.getContext('2d')?.clearRect(0, 0, portraitCanvas.width, portraitCanvas.height);
    renderPortraitResults();
  });
  portraitSearch.addEventListener('input', renderPortraitResults);
  portraitFrame.addEventListener('change', () => {
    if (portraitChoice?.kind === 'sprite')
      void showPortraitChoice({ ...portraitChoice, index: Number(portraitFrame.value) });
  });
  portraitForm.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!current || current.id !== portraitCharacterId || !portraitChoice || portraitOkay.disabled) return;
    const emotion = portraitEmotion.value.trim();
    const facing = portraitDirection.value as 'left' | 'right';
    if (!/^[\w-]*$/.test(emotion)) {
      portraitStatus.textContent = 'Emotion must use letters, numbers, hyphens or underscores.';
      return;
    }
    if (current.portraits?.some((entry, index) =>
      index !== portraitEditIndex && entry.facing === facing && entry.emotion === emotion)) {
      portraitStatus.textContent = `A ${facing} portrait for ${emotion || 'the default emotion'} already exists.`;
      return;
    }
    const portrait = portraitChoice.kind === 'sprite'
      ? `${portraitChoice.id}_${portraitChoice.index}` : portraitChoice.id;
    const assignment = { emotion, facing, portrait };
    if (!current.portraits) current.portraits = [];
    if (portraitEditIndex === undefined) current.portraits.push(assignment);
    else current.portraits[portraitEditIndex] = assignment;
    portraitDialog.close();
    render();
  });
  get$<HTMLButtonElement>('#portrait-cancel').addEventListener('click', () => portraitDialog.close());
  portraitDialog.addEventListener('close', () => {
    ++portraitToken;
    clearTimeout(portraitTimer);
    portraitChoice = undefined;
    portraitCharacterId = undefined;
  });
  get$<HTMLButtonElement>('#add-character-state').addEventListener('click', () => {
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
  get$<HTMLButtonElement>('#new-character').addEventListener('click', () => {
    void (async () => {
      const entered = await askId('New character label');
      if (entered === null) return;
      const labelError = getCharacterLabelError(entered);
      if (labelError) return void alertModal(labelError);
      if (!clips.length) return void alertModal('Create an animation before creating a character');
      if (!alive) return;
      const id = crypto.randomUUID();
      ++loading;
      activateCharacter(createCharacter(id, clips[0], entered), null);
      status.textContent = `New character ${entered}`;
    })();
  });
  get$<HTMLButtonElement>('#rename-character').addEventListener('click', () => {
    void (async () => {
      const character = current;
      if (!character) return;
      const entered = await askAssetMeta('CHARACTER', character.label, character.id);
      if (entered === null || !alive || current !== character) return;
      const error = getCharacterLabelError(entered);
      if (error) return void alertModal(error);
      character.label = entered.trim();
      render();
    })();
  });
  get$<HTMLButtonElement>('#save-character').addEventListener('click', () => void save());
  get$<HTMLButtonElement>('#delete-character').addEventListener('click', () => {
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
        if (alive) status.textContent = showMessage(error);
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
      if (alive) status.textContent = showMessage(error);
    });
  return () => {
    alive = false;
    persistTabs();
    ++loading;
    ++previewToken;
    ++portraitToken;
    clearTimeout(timer);
    clearTimeout(portraitTimer);
    if (portraitDialog.open) portraitDialog.close();
    document.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('pagehide', persistTabs);
    setDirtyGuard(null);
  };
}
