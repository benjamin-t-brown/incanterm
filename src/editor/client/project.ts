export type EditorProject = {
  key: string;
  id: string;
  name: string;
  root: string;
  manifestPath: string;
  entryScene: string;
};

export const OPEN_PROJECT_KEY = 'incanterm-open-project';
let openedProject: EditorProject | null = null;

export function getSavedProjectPath(): string | null {
  return sessionStorage.getItem(OPEN_PROJECT_KEY) ?? localStorage.getItem(OPEN_PROJECT_KEY);
}

export function saveProjectSelection(manifestPath: string): void {
  localStorage.setItem(OPEN_PROJECT_KEY, manifestPath);
  sessionStorage.setItem(OPEN_PROJECT_KEY, manifestPath);
}

export function clearProjectSelection(): void {
  const selected = getSavedProjectPath();
  sessionStorage.removeItem(OPEN_PROJECT_KEY);
  // Another tab may have selected a different project since this one opened.
  if (localStorage.getItem(OPEN_PROJECT_KEY) === selected)
    localStorage.removeItem(OPEN_PROJECT_KEY);
}

export function getOpenedProject(): EditorProject | null {
  return openedProject;
}

export function setOpenedProject(project: EditorProject): void {
  if (openedProject && openedProject.key !== project.key)
    throw new Error('Reload the editor when switching projects to protect in-flight saves');
  openedProject = project;
}

export function getProjectApiUrl(url: string): string {
  if (!url.startsWith('/api/') || url.startsWith('/api/projects')) return url;
  if (!openedProject) throw new Error('Open a project before accessing assets');
  return `/api/projects/${openedProject.key}/assets/${url.slice('/api/'.length)}`;
}

type ProjectStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

export function createProjectStorage(storage: ProjectStorage, projectKey: string): ProjectStorage {
  const prefix = `incanterm-project:${projectKey}:`;
  return {
    getItem(key) {
      return storage.getItem(prefix + key);
    },
    setItem(key, value) {
      storage.setItem(prefix + key, value);
    },
    removeItem(key) {
      storage.removeItem(prefix + key);
    },
  };
}

export function importLegacyEditorState(storage: Storage, projectKey: string): number {
  const scoped = createProjectStorage(storage, projectKey);
  const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index));
  let copied = 0;
  for (const key of keys) {
    if (
      !key?.startsWith('incanterm-') ||
      key.startsWith('incanterm-project:') ||
      key === 'incanterm-editor-theme' ||
      key === OPEN_PROJECT_KEY ||
      scoped.getItem(key) !== null
    )
      continue;
    const value = storage.getItem(key);
    if (value === null) continue;
    scoped.setItem(key, value);
    copied++;
  }
  return copied;
}

function getProjectStorage(): ProjectStorage {
  if (!openedProject) throw new Error('Open a project before accessing editor state');
  return createProjectStorage(localStorage, openedProject.key);
}

export const projectStorage: ProjectStorage = {
  getItem(key) {
    return getProjectStorage().getItem(key);
  },
  setItem(key, value) {
    getProjectStorage().setItem(key, value);
  },
  removeItem(key) {
    getProjectStorage().removeItem(key);
  },
};
