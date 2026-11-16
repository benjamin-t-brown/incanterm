import { jsonRequest, requestJson } from '../api.js';
import { alertModal, confirmModal, promptModal } from '../modal.js';
import {
  clearProjectSelection,
  getOpenedProject,
  importLegacyEditorState,
  saveProjectSelection,
  type EditorProject,
} from '../project.js';
import { allowLeave, createPageShell } from '../shell.js';

export function mountIndex(root: HTMLElement): () => void {
  const current = getOpenedProject();
  root.innerHTML = createPageShell(
    'Projects',
    `<h1 class="page-title">Incanterm Projects</h1>
    <p id="project-summary" class="page-copy"></p>
    <div class="toolbar-row">
      <button id="open-project" type="button">OPEN PROJECT</button>
      <button id="create-project" type="button">CREATE PROJECT</button>
      ${current ? '<button id="close-project" type="button">CLOSE PROJECT</button><button id="import-editor-state" type="button">IMPORT LEGACY TABS / DRAFTS</button>' : ''}
    </div>
    <p class="page-copy">Open a project folder or incanterm.json on the computer running Incanterm.</p>
    <section class="zone"><h2>AVAILABLE PROJECTS</h2><div id="project-list" class="tool-grid"></div></section>
    ${
      current
        ? `<section class="zone"><h2>AUTHORING</h2><div class="tool-grid">
      <a class="tool-card" href="/art"><strong>ART</strong><span>Paint sprites with the project palette.</span></a>
      <a class="tool-card" href="/animation"><strong>ANIMATION</strong><span>Arrange sprites into clips.</span></a>
      <a class="tool-card" href="/props"><strong>PROPS</strong><span>Define reusable world objects.</span></a>
      <a class="tool-card" href="/items"><strong>ITEMS</strong><span>Create collectible items and scripted combinations.</span></a>
      <a class="tool-card" href="/characters"><strong>CHARACTERS</strong><span>Assign animation states and portraits.</span></a>
      <a class="tool-card" href="/soundboard"><strong>SOUNDBOARD</strong><span>Play project sounds.</span></a>
      <a class="tool-card" href="/scripts"><strong>SCRIPT WRITER</strong><span>Edit RPGScript.</span></a>
      <a class="tool-card" href="/scenes"><strong>SCENES</strong><span>Edit scenes and triggers.</span></a>
      <a class="tool-card" href="/game"><strong>PLAY</strong><span>Run this project's entry scene.</span></a>
    </div></section>`
        : ''
    }`,
  );
  const summary = root.querySelector('#project-summary');
  if (summary)
    summary.textContent = current ? `${current.name} — ${current.root}` : 'No project is open.';
  let cancelled = false;
  let busy = false;

  async function openSelectedProject(location: string, name?: string): Promise<void> {
    if (busy || !(await allowLeave())) return;
    busy = true;
    try {
      const project = await requestJson<EditorProject>(
        `/api/projects/${name === undefined ? 'open' : 'create'}`,
        jsonRequest('POST', { path: location, name }),
      );
      // Keep the old context immutable until a full reload. Late saves still target the old project.
      saveProjectSelection(project.manifestPath);
      navigateToProjectHome();
    } catch (error) {
      await alertModal(error instanceof Error ? error.message : 'Could not open project');
    } finally {
      busy = false;
    }
  }

  root.querySelector('#open-project')?.addEventListener('click', () => {
    void (async () => {
      const selected = await promptModal(
        'Project folder or incanterm.json path',
        current?.root ?? '',
      );
      if (selected?.trim()) await openSelectedProject(selected.trim());
    })();
  });
  root.querySelector('#create-project')?.addEventListener('click', () => {
    void (async () => {
      const name = await promptModal('New project name');
      if (!name?.trim()) return;
      const selected = await promptModal('New project folder path (must not already exist)');
      if (selected?.trim()) await openSelectedProject(selected.trim(), name.trim());
    })();
  });
  root.querySelector('#close-project')?.addEventListener('click', () => {
    void (async () => {
      if (!(await allowLeave())) return;
      clearProjectSelection();
      navigateToProjectHome();
    })();
  });
  root.querySelector('#import-editor-state')?.addEventListener('click', () => {
    void (async () => {
      if (
        !current ||
        !(await confirmModal(
          'Copy editor tabs and drafts from before projects into this project? Only use this for the game you were editing previously. Existing project state is not overwritten.',
          'IMPORT',
        ))
      )
        return;
      try {
        const copied = importLegacyEditorState(localStorage, current.key);
        await alertModal(`Imported ${copied} editor settings. Original legacy data has been kept.`);
        navigateToProjectHome();
      } catch (error) {
        await alertModal(error instanceof Error ? error.message : 'Could not import editor state');
      }
    })();
  });
  void requestJson<{ projects: EditorProject[] }>('/api/projects')
    .then(({ projects }) => {
      if (cancelled) return;
      const list = root.querySelector('#project-list');
      if (!list) return;
      for (const project of projects) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'tool-card';
        const name = document.createElement('strong');
        name.textContent = project.name;
        const location = document.createElement('span');
        location.textContent = project.root;
        button.append(name, location);
        button.addEventListener('click', () => {
          void openSelectedProject(project.manifestPath);
        });
        list.append(button);
      }
      if (!projects.length)
        list.textContent = 'No projects found. Open a folder or create a new project.';
    })
    .catch((error: unknown) => {
      if (!cancelled && summary) summary.textContent = String(error);
    });
  return () => {
    cancelled = true;
  };
}

function navigateToProjectHome(): void {
  window.location.assign('/');
}
