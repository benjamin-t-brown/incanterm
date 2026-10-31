import { folderAncestors, parentFolder, type AssetFolders } from '../asset-folders.js';

export type TreeChange =
  | { action: 'create' | 'rename'; folder: string; name: string }
  | { action: 'delete'; folder: string; expectedIds: string[]; expectedFolders: string[] }
  | { action: 'move'; id: string; folder: string };

type TreeOptions = {
  list: HTMLElement;
  search: HTMLInputElement;
  label: string;
  storageKey: string;
  onSelect: (id: string) => void;
  onCreateAsset?: (folder: string) => void;
  onChange: (change: TreeChange) => Promise<AssetFolders>;
  askName: (label: string, suggestion?: string) => Promise<string | null>;
  confirmDelete: (folder: string, animations: { id: string; label: string }[], subfolders: string[]) => Promise<boolean>;
  onError: (message: string) => void;
};

export function createAssetTree(options: TreeOptions) {
  const { list, search } = options;
  let files: string[] = [];
  let labels: Record<string, string> = {};
  let tree: AssetFolders = { folders: [], placements: {} };
  let selected: string | null = null;
  let busy = false;
  let expanded: Set<string>;
  try {
    const stored = JSON.parse(localStorage.getItem(options.storageKey) ?? '[]') as unknown;
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
      localStorage.setItem(options.storageKey, JSON.stringify([...expanded]));
    } catch {
      /* storage unavailable */
    }
  }

  function reveal(id: string): void {
    const folder = tree.placements[id];
    if (folder) for (const path of folderAncestors(folder)) expanded.add(path);
    persist();
  }

  async function change(operation: TreeChange): Promise<void> {
    if (busy) return;
    busy = true;
    try {
      tree = await options.onChange(operation);
      if (operation.action === 'create') {
        expanded.add(operation.folder ? `${operation.folder}/${operation.name}` : operation.name);
        if (operation.folder) expanded.add(operation.folder);
      }
      if (operation.action === 'rename') {
        const replacement = parentFolder(operation.folder);
        const to = replacement ? `${replacement}/${operation.name}` : operation.name;
        expanded = new Set(
          [...expanded].map((path) =>
            path === operation.folder || path.startsWith(`${operation.folder}/`)
              ? to + path.slice(operation.folder.length)
              : path,
          ),
        );
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

  function setData(nextFiles: string[], nextTree: AssetFolders, nextLabels: Record<string, string> = {}): void {
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

  function dropZone(row: HTMLElement, folder: string): void {
    row.addEventListener('dragover', (event) => {
      if (!event.dataTransfer?.types.includes('application/x-incanterm-asset')) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      row.classList.add('drop-target');
    });
    row.addEventListener('dragleave', () => row.classList.remove('drop-target'));
    row.addEventListener('drop', (event) => {
      row.classList.remove('drop-target');
      const id = event.dataTransfer?.getData('application/x-incanterm-asset');
      if (!id || !files.includes(id)) return;
      event.preventDefault();
      event.stopPropagation();
      if ((tree.placements[id] ?? '') !== folder) void change({ action: 'move', id, folder });
    });
  }

  function render(): void {
    list.replaceChildren();
    const query = search.value.trim().toLowerCase();
    const matching = files.filter(
      (id) =>
        !query ||
        (labels[id] ?? id).toLowerCase().includes(query) ||
        (tree.placements[id] ?? '').toLowerCase().includes(query),
    );
    const visibleFolders = new Set<string>();
    for (const folder of tree.folders) {
      if (!query || folder.toLowerCase().includes(query))
        for (const ancestor of folderAncestors(folder)) visibleFolders.add(ancestor);
    }
    if (query) {
      for (const id of matching) {
        const folder = tree.placements[id];
        if (folder) for (const ancestor of folderAncestors(folder)) visibleFolders.add(ancestor);
      }
    }
    const folders = tree.folders.filter((folder) => visibleFolders.has(folder));
    const addLevel = (parent: string, depth: number, container: HTMLElement) => {
      for (const folder of folders.filter((path) => parentFolder(path) === parent).sort()) {
        const row = document.createElement('div');
        row.className = 'asset-tree-folder-row';
        row.dataset.folder = folder;
        row.style.setProperty('--depth', String(depth));
        const toggle = document.createElement('button');
        toggle.type = 'button';
        toggle.className = 'asset-tree-folder';
        const open = query ? true : expanded.has(folder);
        toggle.setAttribute('aria-expanded', String(open));
        toggle.title = `${folder} · F2 to rename`;
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
          if (event.key !== 'F2' || event.target instanceof HTMLInputElement) return;
          event.preventDefault();
          renameFolder(row, toggle, folder);
        });
        const actions = document.createElement('span');
        actions.className = 'asset-tree-actions';
        const actionButton = (symbol: string, title: string, callback: () => void) => {
          const button = document.createElement('button');
          button.type = 'button';
          button.textContent = symbol;
          button.title = title;
          button.setAttribute('aria-label', title);
          button.addEventListener('click', callback);
          actions.append(button);
        };
        actionButton('+', `New folder in ${folder}`, () => void createFolder(folder));
        const createAsset = options.onCreateAsset;
        if (createAsset)
          actionButton('A', `New animation in ${folder}`, () => createAsset(folder));
        actionButton('×', `Delete ${folder}`, () => void deleteFolder(folder));
        row.append(toggle, actions);
        dropZone(row, folder);
        container.append(row);
        if (open) addLevel(folder, depth + 1, container);
      }
      for (const id of matching.filter((file) => (tree.placements[file] ?? '') === parent)
        .sort((a, b) => (labels[a] ?? a).localeCompare(labels[b] ?? b))) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'asset-tree-file';
        button.style.setProperty('--depth', String(depth));
        button.dataset.id = id;
        button.title = labels[id] ?? id;
        button.draggable = true;
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
          event.dataTransfer?.setData('application/x-incanterm-asset', id);
          if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
        });
        container.append(button);
      }
    };
    const root = document.createElement('div');
    root.className = 'asset-tree-root';
    root.textContent = options.label;
    root.title = 'Drop here to move an animation out of a folder';
    dropZone(root, '');
    list.append(root);
    addLevel('', 0, list);
    if (matching.length === 0 && folders.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'anim-picker-empty';
      empty.textContent = files.length === 0 && !query ? 'No animations.' : 'No matches.';
      list.append(empty);
    }
  }

  async function createFolder(parent = ''): Promise<void> {
    const name = await options.askName('New folder name');
    if (name) await change({ action: 'create', folder: parent, name });
  }
  function renameFolder(row: HTMLElement, toggle: HTMLButtonElement, folder: string): void {
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
        const parent = parentFolder(folder);
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
    const expectedFolders = tree.folders.filter((path) => path === folder || path.startsWith(`${folder}/`));
    const expectedIds = files.filter((id) => {
      const placement = tree.placements[id];
      return placement === folder || placement?.startsWith(`${folder}/`);
    });
    const animations = expectedIds.map((id) => ({ id, label: labels[id] ?? id }));
    if (await options.confirmDelete(folder, animations, expectedFolders.slice(1)))
      await change({ action: 'delete', folder, expectedIds, expectedFolders });
  }
  search.addEventListener('input', render);
  function expand(folder: string): void {
    for (const path of folderAncestors(folder)) expanded.add(path);
    persist();
    render();
  }
  return { setData, setLabels, select, createFolder, expand };
}
