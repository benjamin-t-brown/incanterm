import {
  getAnimationFrameFlips,
  isInvisibleFrame,
  type AnimationDocument,
  type PropVisual,
  type SpriteDocument,
  type VisibleAnimationFrame,
} from '../schema.js';
import { getAnimationsUsingSheet } from '../props/prop-picker.js';
import { requestJson } from './api.js';

type AssetList = { files: string[]; labels: Record<string, string> };
type PickerOptions = {
  root: HTMLElement;
  loadSheet: (id: string) => Promise<SpriteDocument>;
  paintSprite: (
    canvas: HTMLCanvasElement,
    sprite: SpriteDocument,
    index: number,
    flips?: { flipH: boolean; flipV: boolean },
  ) => void;
};

/** The sprite-frame / animation chooser shared by props and inventory items. */
export function createVisualAssetPicker(options: PickerOptions) {
  const dialog = document.createElement('dialog');
  dialog.className = 'prop-asset-dialog';
  dialog.setAttribute('aria-label', 'Choose visual asset');
  dialog.innerHTML = `
    <div class="dialog-heading"><span data-picker="title">CHOOSE SPRITE</span><button data-picker="close" type="button" aria-label="Close">×</button></div>
    <div class="prop-picker-body">
      <section class="prop-picker-sheets" aria-label="Sprite sheets"><label>SPRITE SHEETS<input data-picker="search" class="text-input" type="search" placeholder="SEARCH" autocomplete="off"></label><div data-picker="sheets" class="asset-list visual-picker-sheets"></div></section>
      <section class="prop-picker-results" aria-label="Assets"><h3 data-picker="results-title">SPRITES</h3><div data-picker="results" class="prop-picker-grid"></div></section>
    </div>
    <p data-picker="status" class="prop-picker-status" role="status"></p>
    <div class="prop-picker-actions"><button data-picker="ok" type="button" disabled>OK</button><button data-picker="cancel" type="button">CANCEL</button></div>`;
  options.root.append(dialog);
  function getElement<T extends HTMLElement>(name: string): T {
    const element = dialog.querySelector<T>(`[data-picker="${name}"]`);
    if (!element) throw new Error(`Missing visual picker ${name}`);
    return element;
  }
  const search = getElement<HTMLInputElement>('search');
  const sheets = getElement('sheets');
  const results = getElement('results');
  const status = getElement('status');
  const ok = getElement<HTMLButtonElement>('ok');
  let alive = true;
  let token = 0;
  let type: PropVisual['type'] = 'sprite';
  let inventory: AssetList = { files: [], labels: {} };
  let clips: AnimationDocument[] = [];
  let sheetId: string | null = null;
  let choice: PropVisual | null = null;
  let resolveChoice: ((visual: PropVisual | null) => void) | null = null;

  function showError(error: unknown): void {
    status.textContent = error instanceof Error ? error.message : 'Could not load assets';
  }
  function renderSheets(): void {
    sheets.replaceChildren();
    const query = search.value.trim().toLowerCase();
    const visible = inventory.files.filter((id) =>
      (inventory.labels[id] ?? id).toLowerCase().includes(query),
    );
    if (!visible.length) {
      const empty = document.createElement('p');
      empty.textContent = inventory.files.length ? 'No matches.' : 'No sprite sheets.';
      sheets.append(empty);
    }
    for (const id of visible) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = inventory.labels[id] ?? id;
      button.classList.toggle('active', sheetId === id);
      button.addEventListener('click', () => {
        if (sheetId === id) return;
        sheetId = id;
        choice = null;
        renderSheets();
        void renderResults();
      });
      sheets.append(button);
    }
  }
  async function renderResults(): Promise<void> {
    const requestToken = ++token;
    results.replaceChildren();
    ok.disabled = true;
    if (!sheetId) return;
    const id = sheetId;
    status.textContent = 'Loading previews…';
    const entries = type === 'animation' ? getAnimationsUsingSheet(clips, id) : [];
    if (type === 'animation' && !entries.length) {
      status.textContent = 'No animations use this sprite sheet.';
      return;
    }
    try {
      const sheet = await options.loadSheet(id);
      if (!alive || !dialog.open || requestToken !== token) return;
      status.textContent = '';
      const items: {
        visual: PropVisual;
        frame: number;
        title: string;
        flips?: { flipH: boolean; flipV: boolean };
      }[] =
        type === 'sprite'
          ? sheet.sprites.map((_frame, index) => ({
              visual: { type: 'sprite', id, index },
              frame: index,
              title: `FRAME ${index + 1}`,
            }))
          : entries.map(({ animation, frame }) => ({
              visual: { type: 'animation', id: animation.id },
              frame: frame.index,
              flips: getAnimationFrameFlips(animation, frame),
              title: animation.label,
            }));
      for (const item of items) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'prop-picker-card';
        button.title = item.title;
        const thumb = document.createElement('canvas');
        thumb.width = 144;
        thumb.height = 100;
        options.paintSprite(thumb, sheet, item.frame, item.flips);
        const label = document.createElement('span');
        label.textContent = item.title;
        button.append(thumb, label);
        button.classList.toggle('active', JSON.stringify(choice) === JSON.stringify(item.visual));
        button.addEventListener('click', () => {
          choice = item.visual;
          results.querySelectorAll('.prop-picker-card').forEach((card) => {
            card.classList.toggle('active', card === button);
          });
          ok.disabled = false;
        });
        results.append(button);
      }
      ok.disabled =
        !choice || !items.some((item) => JSON.stringify(item.visual) === JSON.stringify(choice));
      if (!items.length) status.textContent = 'No sprites in this sheet.';
    } catch (error) {
      if (alive && dialog.open && requestToken === token) showError(error);
    }
  }
  async function loadAssets(existing: PropVisual): Promise<void> {
    const requestToken = ++token;
    try {
      const [sprites, animations] = await Promise.all([
        requestJson<AssetList>('/api/sprites'),
        type === 'animation'
          ? requestJson<AssetList>('/api/animations')
          : Promise.resolve({ files: [], labels: {} }),
      ]);
      if (!alive || !dialog.open || requestToken !== token) return;
      inventory = sprites;
      const loaded = await Promise.allSettled(
        animations.files.map((id) =>
          requestJson<AnimationDocument>(`/api/animations/${encodeURIComponent(id)}`),
        ),
      );
      if (!alive || !dialog.open || requestToken !== token) return;
      clips = loaded.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []));
      sheetId =
        existing.type === 'sprite' && type === 'sprite' && sprites.files.includes(existing.id)
          ? existing.id
          : type === 'animation' && existing.type === 'animation'
            ? (clips
                .find((clip) => clip.id === existing.id)
                ?.frames.find(
                  (frame): frame is VisibleAnimationFrame =>
                    !isInvisibleFrame(frame) && sprites.files.includes(frame.sprite),
                )?.sprite ??
              sprites.files[0] ??
              null)
            : (sprites.files[0] ?? null);
      if (
        existing.type === type &&
        (type === 'sprite'
          ? sheetId === existing.id
          : clips.some(
              (clip) =>
                clip.id === existing.id &&
                getAnimationsUsingSheet([clip], sheetId ?? '').length > 0,
            ))
      )
        choice = { ...existing };
      renderSheets();
      if (!sheetId) status.textContent = 'Create a sprite sheet first.';
      else void renderResults();
    } catch (error) {
      if (alive && dialog.open && requestToken === token) showError(error);
    }
  }
  function finishChoice(visual: PropVisual | null): void {
    ++token;
    const resolve = resolveChoice;
    resolveChoice = null;
    resolve?.(visual);
  }
  function closePicker(): void {
    finishChoice(null);
    dialog.close();
  }
  search.addEventListener('input', renderSheets);
  getElement('close').addEventListener('click', closePicker);
  getElement('cancel').addEventListener('click', closePicker);
  dialog.addEventListener('close', () => finishChoice(null));
  ok.addEventListener('click', () => {
    if (!choice || ok.disabled) return;
    finishChoice(choice);
    dialog.close();
  });
  function openPicker(
    visualType: PropVisual['type'],
    existing: PropVisual,
  ): Promise<PropVisual | null> {
    if (!alive || dialog.open) return Promise.resolve(null);
    type = visualType;
    choice = null;
    sheetId = null;
    clips = [];
    search.value = '';
    getElement('title').textContent = type === 'sprite' ? 'CHOOSE SPRITE' : 'CHOOSE ANIMATION';
    getElement('results-title').textContent = type === 'sprite' ? 'SPRITES' : 'ANIMATIONS';
    status.textContent = 'Loading assets…';
    results.replaceChildren();
    sheets.replaceChildren();
    ok.disabled = true;
    const pending = new Promise<PropVisual | null>((resolve) => {
      resolveChoice = resolve;
    });
    dialog.showModal();
    void loadAssets(existing);
    return pending;
  }
  function cleanupPicker(): void {
    alive = false;
    closePicker();
    dialog.remove();
  }
  function isOpen(): boolean {
    return dialog.open;
  }
  return { open: openPicker, dispose: cleanupPicker, isOpen };
}
