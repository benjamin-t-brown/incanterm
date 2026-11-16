import type { AssetFolders } from '../../asset-folders.js';
import type { SpriteDocument } from '../../schema.js';
import { createAssetTree } from '../asset-tree.js';

export type EntityPickerPreview = {
  sprite: SpriteDocument;
  index: number;
  flips?: { flipH: boolean; flipV: boolean };
};

export type EntityPickerSelection<T> = {
  asset: T;
  name: string;
  description: string;
  preview?: EntityPickerPreview;
};

type EntityPickerOptions<T> = {
  dialog: HTMLDialogElement;
  search: HTMLInputElement;
  list: HTMLElement;
  preview: HTMLElement;
  status: HTMLElement;
  addButton: HTMLButtonElement;
  label: string;
  storageKey: string;
  loadInventory: () => Promise<{
    files: string[];
    labels?: Record<string, string>;
    folders: AssetFolders;
  }>;
  loadSelection: (id: string) => Promise<EntityPickerSelection<T>>;
  drawPreview: (canvas: HTMLCanvasElement, preview: EntityPickerPreview) => void;
};

export function createSceneEntityPicker<T>(options: EntityPickerOptions<T>) {
  let token = 0;
  let disposed = false;
  let selected: EntityPickerSelection<T> | null = null;
  const tree = createAssetTree({
    list: options.list,
    search: options.search,
    label: options.label,
    storageKey: options.storageKey,
    readOnly: true,
    onSelect: (id) => void selectAsset(id),
  });

  function clearSelection(message: string): void {
    selected = null;
    options.addButton.disabled = true;
    options.preview.replaceChildren();
    const note = document.createElement('p');
    note.textContent = message;
    options.preview.append(note);
  }

  function isCurrent(request: number): boolean {
    return !disposed && options.dialog.open && request === token;
  }

  async function selectAsset(id: string): Promise<void> {
    const request = ++token;
    tree.select(id);
    clearSelection('Loading preview…');
    try {
      const selection = await options.loadSelection(id);
      if (!isCurrent(request)) return;
      options.preview.replaceChildren();
      const name = document.createElement('h3');
      name.textContent = selection.name;
      options.preview.append(name);
      if (selection.preview) {
        const canvas = document.createElement('canvas');
        canvas.width = 400;
        canvas.height = 280;
        canvas.setAttribute('aria-label', `${selection.name} preview`);
        options.drawPreview(canvas, selection.preview);
        options.preview.append(canvas);
      }
      const description = document.createElement('p');
      description.textContent = selection.description;
      options.preview.append(description);
      selected = selection;
      options.addButton.disabled = false;
    } catch (error) {
      if (isCurrent(request))
        clearSelection(error instanceof Error ? error.message : 'Preview unavailable');
    }
  }

  async function open(): Promise<void> {
    if (disposed) return;
    const request = ++token;
    options.search.value = '';
    tree.select(null);
    tree.setData([], { folders: [], placements: {} });
    clearSelection('Select an asset on the left to preview it.');
    options.status.textContent = `Loading ${options.label.toLowerCase()}…`;
    options.dialog.showModal();
    options.search.focus();
    try {
      const inventory = await options.loadInventory();
      if (!isCurrent(request)) return;
      tree.setData(inventory.files, inventory.folders, inventory.labels);
      options.status.textContent = inventory.files.length
        ? `${inventory.files.length} ${options.label.toLowerCase()}`
        : `No ${options.label.toLowerCase()} available.`;
    } catch (error) {
      if (isCurrent(request))
        options.status.textContent =
          error instanceof Error ? error.message : 'Could not load assets';
    }
  }

  function close(): void {
    ++token;
    clearSelection('Select an asset on the left to preview it.');
  }

  options.dialog.addEventListener('close', close);
  return {
    open,
    getSelection(): T | null {
      return selected?.asset ?? null;
    },
    cleanup(): void {
      disposed = true;
      close();
      options.dialog.removeEventListener('close', close);
      if (options.dialog.open) options.dialog.close();
    },
  };
}
