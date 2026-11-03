import type { Connection, ServerChannel, Session } from 'ssh2';
import type { Scene } from '../game/scene.js';
import type { ScriptLibrary } from '../game/rpgscript/index.js';
import type { PortraitAssets } from '../game/portrait-assets.js';
import { Server } from './ssh2.js';
import { createGameSession, type GameSession } from './game-session.js';
import { closeServer, listen } from './listen.js';

export type SshListener = {
  port: number;
  close: () => Promise<void>;
};

export async function startSshServer(options: {
  host: string;
  port: number;
  hostKey: string;
  scene: Scene;
  scripts: ScriptLibrary;
  portraits?: PortraitAssets;
  reloadPortraits?: () => Promise<PortraitAssets>;
}): Promise<SshListener> {
  const clients = new Set<Connection>();
  const server = new Server({ hostKeys: [options.hostKey] }, (client) => {
    clients.add(client);
    client.on('close', () => {
      clients.delete(client);
    });
    client.on('error', () => {});
    client.on('authentication', (context) => {
      context.accept();
    });
    client.on('ready', () => {
      client.on('session', (acceptSession) => {
        attachSession(acceptSession(), options.scene, options.scripts, options.portraits, options.reloadPortraits);
      });
    });
  });

  const port = await listen(server, options.port, options.host);
  server.on('error', (error: Error) => {
    console.error(error);
  });

  return {
    port,
    async close() {
      for (const client of clients) client.end();
      await closeServer(server);
    },
  };
}

function attachSession(
  session: Session,
  scene: Scene,
  scripts: ScriptLibrary,
  portraits?: PortraitAssets,
  reloadPortraits?: () => Promise<PortraitAssets>,
): void {
  let game: GameSession | undefined;
  let cols = 80;
  let rows = 24;

  session.on('pty', (accept, _reject, info) => {
    cols = info.cols || cols;
    rows = info.rows || rows;
    accept();
  });
  session.on('window-change', (accept, _reject, info) => {
    cols = info.cols || cols;
    rows = info.rows || rows;
    game?.resize(cols, rows);
    accept();
  });
  session.on('shell', (accept) => {
    const stream = accept();
    game = bindSession(stream, scene, scripts, cols, rows, portraits, reloadPortraits);
  });
}

function bindSession(
  stream: ServerChannel,
  scene: Scene,
  scripts: ScriptLibrary,
  cols: number,
  rows: number,
  portraits?: PortraitAssets,
  reloadPortraits?: () => Promise<PortraitAssets>,
): GameSession {
  let writable = true;
  stream.on('drain', () => {
    writable = true;
  });
  const game = createGameSession(
    scene,
    (text) => {
      // A false return still accepts this frame; wait for drain before sending another.
      writable = stream.write(text);
    },
    scripts,
    portraits,
    () => writable && !stream.destroyed && stream.writable,
    reloadPortraits,
  );
  game.resize(cols, rows);
  stream.write('\x1b[?1000h\x1b[?1006h');
  game.open();
  stream.on('data', (chunk: Buffer | string) => {
    game.input(typeof chunk === 'string' ? chunk : chunk.toString('utf8'));
  });
  stream.on('error', () => {});
  stream.on('close', () => game.close());
  return game;
}
