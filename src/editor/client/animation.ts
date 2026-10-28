import { paletteRgb, type PaletteDocument } from '../palette.js';
import {
  flattenSprite,
  isAssetId,
  type AnimationDocument,
  type SpriteDocument,
} from '../schema.js';
import { jsonRequest, requestJson } from './api.js';
import { alertModal, confirmModal } from './modal.js';
import { askId, pageShell, setDirtyGuard } from './shell.js';

type Frame = { sprite: string; durationMs: number };

export function mountAnimation(root: HTMLElement): () => void {
  root.innerHTML = pageShell(
    'Animation',
    `<h1 class="page-title">Animation</h1>
    <p class="page-copy">Build a flat clip from sprites. Set a duration on each frame, then play it back.</p>
    <div class="split">
      <div>
        <div class="toolbar-row"><button type="button" id="new-animation">NEW</button></div>
        <div id="animation-list" class="asset-list"></div>
      </div>
      <div id="animation-editor"></div>
    </div>`,
  );
  const listNode = root.querySelector<HTMLElement>('#animation-list');
  const editorNode = root.querySelector<HTMLElement>('#animation-editor');
  if (!listNode || !editorNode) return () => undefined;
  const list: HTMLElement = listNode;
  const editor: HTMLElement = editorNode;

  let animations: string[] = [];
  let sprites: string[] = [];
  let palette: PaletteDocument | null = null;
  let current: AnimationDocument | null = null;
  let saved = '';
  let timer = 0;
  const spriteCache = new Map<string, SpriteDocument>();

  const dirty = () => current !== null && JSON.stringify(current) !== saved;
  setDirtyGuard(
    async () => !dirty() || confirmModal('Discard unsaved animation changes?', 'DISCARD'),
  );

  async function reloadLists(): Promise<void> {
    const [animationFiles, spriteFiles, colors] = await Promise.all([
      requestJson<{ files: string[] }>('/api/animations'),
      requestJson<{ files: string[] }>('/api/sprites'),
      requestJson<PaletteDocument>('/api/palette'),
    ]);
    animations = animationFiles.files;
    sprites = spriteFiles.files;
    palette = colors;
    list.replaceChildren();
    for (const id of animations) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = id;
      button.classList.toggle('active', current?.id === id);
      button.addEventListener('click', () => void openAnimation(id));
      list.append(button);
    }
  }

  async function openAnimation(id: string): Promise<void> {
    if (dirty() && !(await confirmModal('Discard unsaved animation changes?', 'DISCARD'))) return;
    stop();
    current = await requestJson<AnimationDocument>(`/api/animations/${encodeURIComponent(id)}`);
    saved = JSON.stringify(current);
    renderEditor();
    await reloadLists();
  }

  function renderEditor(): void {
    if (!current) {
      editor.innerHTML = '<p class="page-copy">Create an animation or open one from the list.</p>';
      return;
    }
    const animation = current;
    editor.innerHTML = `<div class="toolbar-row">
        <strong>${animation.id}</strong>
        <label><input id="loop" type="checkbox" ${animation.loop ? 'checked' : ''}> LOOP</label>
        <button type="button" id="play">PLAY</button>
        <button type="button" id="stop">STOP</button>
        <button type="button" id="save">SAVE</button>
        <button type="button" id="duplicate">DUPLICATE</button>
        <button type="button" id="delete">DELETE</button>
      </div>
      <canvas id="preview" class="preview-canvas" width="640" height="280"></canvas>
      <div id="frames" class="frame-list"></div>
      <div class="toolbar-row">
        <select id="sprite-choice" class="text-select"></select>
        <input id="duration" class="text-input" type="number" min="1" max="600000" value="100">
        <button type="button" id="add-frame">ADD FRAME</button>
      </div>
      <p id="animation-status" class="page-copy"></p>`;
    const select = editor.querySelector<HTMLSelectElement>('#sprite-choice');
    if (select) {
      for (const sprite of sprites) {
        const option = document.createElement('option');
        option.value = sprite;
        option.textContent = sprite;
        select.append(option);
      }
    }
    const frames = editor.querySelector<HTMLElement>('#frames');
    animation.frames.forEach((frame, index) => {
      const row = document.createElement('div');
      row.className = 'frame-row';
      const missing = sprites.includes(frame.sprite) ? '' : ' (missing)';
      row.innerHTML = `<span>${index + 1}. ${frame.sprite}${missing}</span><span>${frame.durationMs} ms</span>`;
      const up = button('UP', () => move(index, -1));
      const down = button('DOWN', () => move(index, 1));
      const remove = button('REMOVE', () => {
        animation.frames.splice(index, 1);
        renderEditor();
      });
      const edit = document.createElement('a');
      edit.href = `/art?id=${encodeURIComponent(frame.sprite)}`;
      edit.textContent = 'EDIT SPRITE';
      row.append(up, down, remove, edit);
      frames?.append(row);
    });
    editor.querySelector('#loop')?.addEventListener('change', (event) => {
      animation.loop = (event.target as HTMLInputElement).checked;
    });
    editor.querySelector('#add-frame')?.addEventListener('click', () => {
      const sprite = editor.querySelector<HTMLSelectElement>('#sprite-choice')?.value;
      const duration = Number(editor.querySelector<HTMLInputElement>('#duration')?.value);
      if (!sprite || !Number.isInteger(duration) || duration < 1) return;
      animation.frames.push({ sprite, durationMs: duration });
      renderEditor();
    });
    editor.querySelector('#play')?.addEventListener('click', () => void play());
    editor.querySelector('#stop')?.addEventListener('click', stop);
    editor.querySelector('#save')?.addEventListener('click', () => void save());
    editor.querySelector('#duplicate')?.addEventListener('click', () => void duplicate());
    editor.querySelector('#delete')?.addEventListener('click', () => void removeAnimation());
    void drawFrame(animation.frames[0]);
  }

  function button(label: string, action: () => void): HTMLButtonElement {
    const element = document.createElement('button');
    element.type = 'button';
    element.textContent = label;
    element.addEventListener('click', action);
    return element;
  }

  function move(index: number, direction: number): void {
    if (!current) return;
    const next = index + direction;
    if (next < 0 || next >= current.frames.length) return;
    const frames = current.frames;
    const [frame] = frames.splice(index, 1);
    if (frame) frames.splice(next, 0, frame);
    renderEditor();
  }

  async function drawFrame(frame: Frame | undefined): Promise<void> {
    const canvas = editor.querySelector<HTMLCanvasElement>('#preview');
    const status = editor.querySelector('#animation-status');
    if (!canvas || !palette) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = paletteRgb(palette, 'black') ?? '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (!frame) {
      if (status) status.textContent = 'This clip has no frames.';
      return;
    }
    if (!sprites.includes(frame.sprite)) {
      if (status)
        status.textContent = `Missing sprite ${frame.sprite}. Save is blocked until every frame has a sprite.`;
      return;
    }
    const sprite =
      spriteCache.get(frame.sprite) ??
      (await requestJson<SpriteDocument>(`/api/sprites/${encodeURIComponent(frame.sprite)}`));
    spriteCache.set(frame.sprite, sprite);
    const zoom = Math.max(
      1,
      Math.min(
        4,
        Math.floor(canvas.width / (sprite.width * 16)),
        Math.floor(canvas.height / (sprite.height * 22)),
      ),
    );
    const originX = Math.floor((canvas.width - sprite.width * 16 * zoom) / 2);
    const originY = Math.floor((canvas.height - sprite.height * 22 * zoom) / 2);
    ctx.font = `${16 * zoom}px 'Courier New', monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    flattenSprite(sprite).forEach((cell, index) => {
      const x = originX + (index % sprite.width) * 16 * zoom;
      const y = originY + Math.floor(index / sprite.width) * 22 * zoom;
      ctx.fillStyle = paletteRgb(palette!, cell.bg) ?? '#000';
      ctx.fillRect(x, y, 16 * zoom, 22 * zoom);
      if (cell.ch !== ' ') {
        ctx.fillStyle = paletteRgb(palette!, cell.fg) ?? '#fff';
        ctx.fillText(cell.ch, x + 8 * zoom, y + 12 * zoom);
      }
    });
    if (status) status.textContent = `${sprite.width} × ${sprite.height} · ${frame.durationMs} ms`;
  }

  async function play(): Promise<void> {
    stop();
    if (!current || current.frames.length === 0) return;
    let index = 0;
    const step = async () => {
      if (!current) return;
      const frame = current.frames[index];
      await drawFrame(frame);
      index += 1;
      if (!current) return;
      if (index >= current.frames.length) {
        if (!current.loop) return;
        index = 0;
      }
      timer = window.setTimeout(() => void step(), frame?.durationMs ?? 100);
    };
    await step();
  }

  function stop(): void {
    window.clearTimeout(timer);
  }

  async function save(): Promise<void> {
    if (!current) return;
    const status = editor.querySelector('#animation-status');
    try {
      const stored = await requestJson<AnimationDocument>(
        `/api/animations/${encodeURIComponent(current.id)}`,
        jsonRequest('PUT', current),
      );
      current = stored;
      saved = JSON.stringify(stored);
      if (status) status.textContent = `Saved ${stored.id}`;
    } catch (error) {
      if (status) status.textContent = error instanceof Error ? error.message : 'Save failed';
    }
  }

  async function duplicate(): Promise<void> {
    if (!current) return;
    const id = await askId('Duplicate as', `${current.id}-copy`);
    if (!id || !isAssetId(id)) return;
    current = await requestJson<AnimationDocument>(
      '/api/duplicate',
      jsonRequest('POST', { kind: 'animation', from: current.id, id }),
    );
    saved = JSON.stringify(current);
    await reloadLists();
    renderEditor();
  }

  async function removeAnimation(): Promise<void> {
    if (!current || !(await confirmModal(`Delete ${current.id}?`, 'DELETE'))) return;
    await requestJson(`/api/animations/${encodeURIComponent(current.id)}`, { method: 'DELETE' });
    current = null;
    saved = '';
    stop();
    await reloadLists();
    renderEditor();
  }

  root.querySelector('#new-animation')?.addEventListener('click', () => {
    void (async () => {
      const id = await askId('New animation id');
      if (!id || !isAssetId(id)) return;
      if (animations.includes(id)) {
        await alertModal('An asset with that id already exists');
        return;
      }
      if (dirty() && !(await confirmModal('Discard unsaved animation changes?', 'DISCARD'))) return;
      current = { format: 'incanterm-animation', version: 1, id, loop: true, frames: [] };
      saved = '';
      renderEditor();
      void save().then(() => reloadLists());
    })();
  });

  void reloadLists().then(renderEditor);
  return () => {
    stop();
    setDirtyGuard(null);
  };
}
