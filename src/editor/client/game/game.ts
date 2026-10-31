import { assetEditorTopbar } from '../shell.js';

const GAME_CLIENT = 'http://127.0.0.1:7103/';

export function mountGame(root: HTMLElement): () => void {
  root.innerHTML = `<div class="simple-layout">
    ${assetEditorTopbar()}
    <div id="game-host" class="simple-main" style="padding:0; display:flex; flex-direction:column;"></div>
  </div>`;
  const host = root.querySelector<HTMLElement>('#game-host');
  let cancelled = false;
  void fetch(GAME_CLIENT, { mode: 'no-cors' })
    .then(() => {
      if (cancelled || !host) return;
      host.innerHTML = `<iframe class="game-frame" title="Game client" src="${GAME_CLIENT}"></iframe>`;
    })
    .catch(() => {
      if (cancelled || !host) return;
      host.innerHTML =
        '<p class="game-missing" style="padding:22px">The browser client is not running. Start it with <code>npm run dev</code>, then reload this page. It listens on port 7103.</p>';
    });
  return () => {
    cancelled = true;
  };
}
