import { projectStorage } from './project.js';
import { FOLDER_ICON } from './asset-tree-icons.js';
import {
  getFolderAncestors,
  getParentFolder,
  type AssetFolders,
  type AssetFolderChange,
} from '../asset-folders.js';

export type TreeChange = AssetFolderChange;

type TreeOptions = {
  list: HTMLElement;
  search: HTMLInputElement;
  label: string;
  assetName?: string;
  storageKey: string;
  onSelect: (id: string) => void;
  onCreateAsset?: (folder: string) => void;
} & (
  | {
      readOnly: true;
      onChange?: never;
      askName?: never;
      confirmDelete?: never;
      onError?: never;
    }
  | {
      readOnly?: false;
      onChange: (change: TreeChange) => Promise<AssetFolders>;
      askName: (label: string, suggestion?: string) => Promise<string | null>;
      confirmDelete: (
        folder: string,
        animations: { id: string; label: string }[],
        subfolders: string[],
      ) => Promise<boolean>;
      onError: (message: string) => void;
    }
);

export function createAssetTree(options: TreeOptions) {
  const { list, search } = options;
  list.classList.add('asset-tree-list');
  let files: string[] = [];
  let labels: Record<string, string> = {};
  let tree: AssetFolders = { folders: [], placements: {} };
  let selected: string | null = null;
  let busy = false;
  let dragging = false;
  let draggedFolder: string | null = null;
  let expanded: Set<string>;
  try {
    const stored = JSON.parse(projectStorage.getItem(options.storageKey) ?? '[]') as unknown;
    expanded = new Set(
      Array.isArray(stored)
        ? stored.filter((item): item is string => typeof item === 'string')
        : [],
    );
  } catch {
    expanded = new Set();
  }

  function persist(): void {
    try {
      projectStorage.setItem(options.storageKey, JSON.stringify([...expanded]));
    } catch {
      /* storage unavailable */
    }
  }

  function reveal(id: string): void {
    const folder = tree.placements[id];
    if (folder) for (const path of getFolderAncestors(folder)) expanded.add(path);
    persist();
  }

  async function change(operation: TreeChange): Promise<void> {
    if (options.readOnly || busy) return;
    busy = true;
    try {
      tree = await options.onChange(operation);
      if (operation.action === 'create') {
        expanded.add(operation.folder ? `${operation.folder}/${operation.name}` : operation.name);
        if (operation.folder) expanded.add(operation.folder);
      }
      if (operation.action === 'rename' || operation.action === 'move-folder') {
        const replacement =
          operation.action === 'move-folder' ? operation.parent : getParentFolder(operation.folder);
        const name =
          operation.action === 'move-folder'
            ? operation.folder.slice(operation.folder.lastIndexOf('/') + 1)
            : operation.name;
        const to = replacement ? `${replacement}/${name}` : name;
        expanded = new Set(
          [...expanded].map((path) =>
            path === operation.folder || path.startsWith(`${operation.folder}/`)
              ? to + path.slice(operation.folder.length)
              : path,
          ),
        );
        if (operation.action === 'move-folder' && replacement)
          for (const path of getFolderAncestors(replacement)) expanded.add(path);
      }
      if (selected) reveal(selected);
      persist();
    } catch (error) {
      options.onError(error instanceof Error ? error.message : 'Could not update folders');
    } finally {
      busy = false;
      render();
    }
  }

  function setData(
    nextFiles: string[],
    nextTree: AssetFolders,
    nextLabels: Record<string, string> = {},
  ): void {
    files = nextFiles;
    labels = nextLabels;
    tree = nextTree;
    render();
  }

  function setLabels(nextLabels: Record<string, string>): void {
    labels = nextLabels;
    render();
  }

  function select(id: string | null): void {
    if (selected === id) return;
    selected = id;
    if (id) reveal(id);
    render();
    if (id && !search.value.trim()) {
      const row = [...list.querySelectorAll<HTMLButtonElement>('.asset-tree-file')].find(
        (button) => button.dataset.id === id,
      );
      row?.scrollIntoView({ block: 'nearest' });
    }
  }

  function setDragging(active: boolean): void {
    dragging = active;
    for (const root of list.querySelectorAll('.asset-tree-root'))
      root.classList.toggle('asset-tree-root-drop-zone', active);
    for (const hint of list.querySelectorAll<HTMLElement>('.asset-tree-root-hint'))
      hint.hidden = !active;
  }

  function clearDropTargets(except?: HTMLElement): void {
    if (list !== except) list.classList.remove('drop-target');
    list.querySelectorAll('.drop-target').forEach((target) => {
      if (target !== except) target.classList.remove('drop-target');
    });
  }

  function dropZone(row: HTMLElement, folder: string): void {
    if (options.readOnly) return;
    row.addEventListener('dragover', (event) => {
      const transfer = event.dataTransfer;
      if (!transfer) return;
      if (transfer.types.includes('application/x-incanterm-folder')) {
        event.stopPropagation();
        if (!draggedFolder || !canMoveFolder(draggedFolder, folder) || busy) {
          transfer.dropEffect = 'none';
          clearDropTargets();
          return;
        }
      } else if (!transfer.types.includes('application/x-incanterm-asset') || busy) return;
      event.preventDefault();
      event.stopPropagation();
      transfer.dropEffect = 'move';
      clearDropTargets(row);
      row.classList.add('drop-target');
    });
    row.addEventListener('dragleave', (event) => {
      if (!event.relatedTarget || !row.contains(event.relatedTarget as Node))
        row.classList.remove('drop-target');
    });
    row.addEventListener('drop', (event) => {
      setDragging(false);
      clearDropTargets();
      if (event.dataTransfer?.types.includes('application/x-incanterm-folder')) {
        event.preventDefault();
        event.stopPropagation();
        const source = event.dataTransfer.getData('application/x-incanterm-folder');
        if (source === draggedFolder && canMoveFolder(source, folder))
          void change({ action: 'move-folder', folder: source, parent: folder });
        draggedFolder = null;
        return;
      }
      const id = event.dataTransfer?.getData('application/x-incanterm-asset');
      if (!id || !files.includes(id)) return;
      event.preventDefault();
      event.stopPropagation();
      if ((tree.placements[id] ?? '') !== folder) void change({ action: 'move', id, folder });
    });
  }
  function canMoveFolder(source: string, parent: string): boolean {
    return (
      tree.folders.includes(source) &&
      (parent === '' || tree.folders.includes(parent)) &&
      parent !== source &&
      !parent.startsWith(`${source}/`) &&
      getParentFolder(source) !== parent
    );
  }
  dropZone(list, '');
  list.addEventListener('dragend', () => {
    setDragging(false);
    draggedFolder = null;
    clearDropTargets();
  });

  function render(): void {
    syncToggleAll();
    list.replaceChildren();
    const query = search.value.trim().toLowerCase();
    const matching = files.filter(
      (id) =>
        !query ||
        id.toLowerCase().includes(query) ||
        (labels[id] ?? id).toLowerCase().includes(query) ||
        (tree.placements[id] ?? '').toLowerCase().includes(query),
    );
    const visibleFolders = new Set<string>();
    for (const folder of tree.folders) {
      if (!query || folder.toLowerCase().includes(query))
        for (const ancestor of getFolderAncestors(folder)) visibleFolders.add(ancestor);
    }
    if (query) {
      for (const id of matching) {
        const folder = tree.placements[id];
        if (folder) for (const ancestor of getFolderAncestors(folder)) visibleFolders.add(ancestor);
      }
    }
    const folders = tree.folders.filter((folder) => visibleFolders.has(folder));
    const addLevel = (parent: string, depth: number, container: HTMLElement) => {
      for (const folder of folders.filter((path) => getParentFolder(path) === parent).sort()) {
        const row = document.createElement('div');
        row.className = 'asset-tree-folder-row';
        row.dataset.folder = folder;
        row.style.setProperty('--depth', String(depth));
        const toggle = document.createElement('button');
        toggle.type = 'button';
        toggle.className = 'asset-tree-folder';
        const open = query ? true : expanded.has(folder);
        toggle.setAttribute('aria-expanded', String(open));
        toggle.title = options.readOnly ? folder : `${folder} · Drag to move · F2 to rename`;
        toggle.draggable = !options.readOnly;
        toggle.addEventListener('dragstart', (event) => {
          if (options.readOnly || busy) {
            event.preventDefault();
            return;
          }
          draggedFolder = folder;
          setDragging(true);
          event.dataTransfer?.setData('application/x-incanterm-folder', folder);
          if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
        });
        const arrow = document.createElement('span');
        arrow.className = 'asset-tree-arrow';
        arrow.textContent = open ? '▾' : '▸';
        const icon = document.createElement('span');
        icon.className = 'asset-tree-icon';
        icon.textContent = open ? '▱' : '▰';
        const label = document.createElement('span');
        label.className = 'asset-tree-label';
        label.textContent = folder.slice(parent.length ? parent.length + 1 : 0);
        toggle.append(arrow, icon, label);
        toggle.addEventListener('click', () => {
          if (expanded.has(folder)) expanded.delete(folder);
          else expanded.add(folder);
          persist();
          render();
          const next = [...list.querySelectorAll<HTMLElement>('.asset-tree-folder-row')].find(
            (item) => item.dataset.folder === folder,
          );
          next?.querySelector<HTMLButtonElement>('.asset-tree-folder')?.focus();
        });
        row.addEventListener('keydown', (event) => {
          if (options.readOnly || event.key !== 'F2' || event.target instanceof HTMLInputElement)
            return;
          event.preventDefault();
          renameFolder(row, toggle, folder);
        });
        const actions = document.createElement('span');
        actions.className = 'asset-tree-actions';
        const createActionButton = (symbol: string, title: string, callback: () => void) => {
          const button = document.createElement('button');
          button.type = 'button';
          button.textContent = symbol;
          button.title = title;
          button.setAttribute('aria-label', title);
          button.addEventListener('click', callback);
          actions.append(button);
          return button;
        };
        if (!options.readOnly) {
          const newFolderButton = createActionButton(
            '',
            `New folder in ${folder}`,
            () => void createFolder(folder),
          );
          newFolderButton.innerHTML = FOLDER_ICON;
          const createAsset = options.onCreateAsset;
          if (createAsset)
            createActionButton('+', `New ${options.assetName ?? 'animation'} in ${folder}`, () =>
              createAsset(folder),
            );
          createActionButton('×', `Delete ${folder}`, () => void deleteFolder(folder));
        }
        row.append(toggle, actions);
        dropZone(row, folder);
        container.append(row);
        if (open) {
          const contents = document.createElement('div');
          contents.className = 'asset-tree-contents';
          contents.dataset.folder = folder;
          dropZone(contents, folder);
          container.append(contents);
          addLevel(folder, depth + 1, contents);
        }
      }
      for (const id of matching
        .filter((file) => (tree.placements[file] ?? '') === parent)
        .sort((a, b) => (labels[a] ?? a).localeCompare(labels[b] ?? b))) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'asset-tree-file';
        button.style.setProperty('--depth', String(depth));
        button.dataset.id = id;
        button.title = labels[id] ?? id;
        button.draggable = !options.readOnly;
        button.classList.toggle('active', selected === id);
        if (selected === id) button.setAttribute('aria-current', 'true');
        const icon = document.createElement('span');
        icon.className = 'asset-tree-file-icon';
        icon.textContent = '◇';
        const label = document.createElement('span');
        label.className = 'asset-tree-label';
        label.textContent = labels[id] ?? id;
        button.append(icon, label);
        button.addEventListener('click', () => options.onSelect(id));
        button.addEventListener('dragstart', (event) => {
          if (options.readOnly || busy) {
            event.preventDefault();
            return;
          }
          setDragging(true);
          event.dataTransfer?.setData('application/x-incanterm-asset', id);
          if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
        });
        container.append(button);
      }
    };
    const root = document.createElement('div');
    root.className = 'asset-tree-root';
    root.textContent = options.label;
    root.title = options.readOnly
      ? options.label
      : 'Drop assets or folders here to move them to the top level';
    if (!options.readOnly) {
      root.classList.toggle('asset-tree-root-drop-zone', dragging);
      const hint = document.createElement('span');
      hint.className = 'asset-tree-root-hint';
      hint.textContent = '↑ Drop here for top level';
      hint.hidden = !dragging;
      root.append(hint);
    }
    dropZone(root, '');
    list.append(root);
    const rootContents = document.createElement('div');
    rootContents.className = 'asset-tree-contents asset-tree-root-contents';
    dropZone(rootContents, '');
    list.append(rootContents);
    addLevel('', 0, rootContents);
    if (matching.length === 0 && folders.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'anim-picker-empty';
      empty.textContent =
        files.length === 0 && !query ? `No ${options.label.toLowerCase()}.` : 'No matches.';
      list.append(empty);
    }
  }

  async function createFolder(parent = ''): Promise<void> {
    if (options.readOnly) return;
    const name = await options.askName('New folder name');
    if (name) await change({ action: 'create', folder: parent, name });
  }
  function renameFolder(row: HTMLElement, toggle: HTMLButtonElement, folder: string): void {
    if (options.readOnly) return;
    const original = folder.split('/').at(-1) ?? folder;
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'asset-tree-rename text-input';
    input.value = original;
    input.maxLength = 64;
    input.setAttribute('aria-label', `Rename folder ${folder}`);
    input.style.setProperty('--depth', row.style.getPropertyValue('--depth'));
    row.classList.add('editing');
    toggle.replaceWith(input);
    input.focus();
    input.select();
    let finished = false;
    const cancel = (restoreFocus: boolean) => {
      if (finished) return;
      finished = true;
      input.replaceWith(toggle);
      row.classList.remove('editing');
      if (restoreFocus) toggle.focus();
    };
    const commit = (restoreFocus: boolean) => {
      if (finished) return;
      const name = input.value.trim();
      if (!name || name === original) {
        cancel(restoreFocus);
        return;
      }
      finished = true;
      void change({ action: 'rename', folder, name }).then(() => {
        if (!restoreFocus) return;
        const parent = getParentFolder(folder);
        const renamed = parent ? `${parent}/${name}` : name;
        const next = [...list.querySelectorAll<HTMLElement>('.asset-tree-folder-row')].find(
          (item) => item.dataset.folder === renamed,
        );
        next?.querySelector<HTMLButtonElement>('.asset-tree-folder')?.focus();
      });
    };
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        commit(true);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        cancel(true);
      }
      event.stopPropagation();
    });
    input.addEventListener('blur', () => commit(false));
  }
  async function deleteFolder(folder: string): Promise<void> {
    if (options.readOnly) return;
    const expectedFolders = tree.folders.filter(
      (path) => path === folder || path.startsWith(`${folder}/`),
    );
    const expectedIds = files.filter((id) => {
      const placement = tree.placements[id];
      return placement === folder || placement?.startsWith(`${folder}/`);
    });
    const animations = expectedIds.map((id) => ({ id, label: labels[id] ?? id }));
    if (await options.confirmDelete(folder, animations, expectedFolders.slice(1)))
      await change({ action: 'delete', folder, expectedIds, expectedFolders });
  }
  search.addEventListener('input', render);
  const toggleAll = document.createElement('button');
  toggleAll.type = 'button';
  toggleAll.className = 'asset-tree-toggle-all';
  function syncToggleAll(): void {
    const hasOpen = tree.folders.some((folder) => expanded.has(folder));
    toggleAll.textContent = hasOpen ? '⊟' : '⊞';
    toggleAll.title = hasOpen ? 'Collapse all folders' : 'Expand all folders';
    toggleAll.setAttribute('aria-label', toggleAll.title);
    toggleAll.disabled = tree.folders.length === 0;
  }
  toggleAll.addEventListener('click', () => {
    if (tree.folders.some((folder) => expanded.has(folder))) expanded.clear();
    else expanded = new Set(tree.folders);
    persist();
    render();
  });
  list.previousElementSibling?.querySelector('.asset-tree-toolbar-actions')?.prepend(toggleAll);
  function expand(folder: string): void {
    for (const path of getFolderAncestors(folder)) expanded.add(path);
    persist();
    render();
  }
  function getAssetFolder(id: string): string | undefined {
    return Object.hasOwn(tree.placements, id) ? tree.placements[id] : undefined;
  }
  return { setData, setLabels, select, createFolder, expand, getAssetFolder };
}
