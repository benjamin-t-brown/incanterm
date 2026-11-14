import { requestJson, jsonRequest } from '../api.js';
import { getOpenedProject } from '../project.js';
import { createAssetEditorTopbar } from '../shell.js';

export function mountGame(root: HTMLElement): () => void {
  const project = getOpenedProject();
  root.innerHTML = `<div class="simple-layout">
    ${createAssetEditorTopbar()}
    <div id="game-host" class="simple-main" style="padding:0; display:flex; flex-direction:column;"></div>
  </div>`;
  const host = root.querySelector<HTMLElement>('#game-host');
  let cancelled = false;
  if (host) host.textContent = 'Loading project…';
  if (project) {
    void (async () => {
      try {
        // Each visit to Play reloads the project's latest saved content.
        await requestJson(`/api/projects/${project.key}/play`, { method: 'DELETE' });
        if (cancelled) return;
        const { url } = await requestJson<{ url: string }>(
          `/api/projects/${project.key}/play`,
          jsonRequest('POST', {}),
        );
        if (cancelled || !host) return;
        const frame = document.createElement('iframe');
        frame.className = 'game-frame';
        frame.title = `${project.name} — Play`;
        frame.src = url;
        host.replaceChildren(frame);
      } catch (error) {
        if (!cancelled && host)
          host.textContent = error instanceof Error ? error.message : 'Could not play project';
      }
    })();
  }
  return () => {
    cancelled = true;
  };
}
