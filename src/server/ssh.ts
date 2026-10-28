import type { Connection, ServerChannel, Session } from 'ssh2';
import type { Scene } from '../game/scene.js';
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
        attachSession(acceptSession(), options.scene);
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

function attachSession(session: Session, scene: Scene): void {
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
    game = bindSession(stream, scene, cols, rows);
  });
}

function bindSession(stream: ServerChannel, scene: Scene, cols: number, rows: number): GameSession {
  const game = createGameSession(scene, (text) => {
    stream.write(text);
  });
  game.resize(cols, rows);
  game.open();
  stream.on('data', (chunk: Buffer | string) => {
    game.input(typeof chunk === 'string' ? chunk : chunk.toString('utf8'));
  });
  stream.on('error', () => {});
  return game;
}
