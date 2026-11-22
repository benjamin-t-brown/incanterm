import { connectGameClient, type GameClient } from '../client/connection.js';
import { getProjectSource, type ProjectSourceOptions } from '../project/project.js';
import { generateHostKey } from '../server/host-key.js';
import { startServer } from '../server/start.js';
import type { ServerMessage } from '../protocol/messages.js';
import { loadSaveVariables } from './save.js';

export type Loopback = {
  sceneId: string;
  httpPort: number;
  sshPort: number;
  sendInput: GameClient['sendInput'];
  resize: GameClient['resize'];
  close: () => Promise<void>;
};

export async function startLoopback(
  options: ProjectSourceOptions & {
    savePath?: string;
    onMessage: (message: ServerMessage) => void;
    onDisconnect?: () => void;
    onError?: (error: Error) => void;
  },
): Promise<Loopback> {
  const { sceneId, assetsRoot } = getProjectSource(options);
  const initialScriptVariables = options.savePath !== undefined
    ? await loadSaveVariables(options.savePath)
    : undefined;
  const server = await startServer({
    host: '127.0.0.1',
    httpPort: 0,
    sshPort: 0,
    hostKey: generateHostKey(),
    assetsRoot,
    sceneId,
    allowPlayerSpawn: true,
    initialScriptVariables,
  });
  const sshPort = server.sshPort;
  if (sshPort === undefined) {
    await server.close();
    throw new Error('Loopback requires an SSH listener');
  }

  let client: GameClient;
  try {
    client = await new Promise<GameClient>((resolve, reject) => {
      let opened = false;
      const connection = connectGameClient(`ws://127.0.0.1:${server.httpPort}/ws`, {
        onOpen() {
          opened = true;
          resolve(connection);
        },
        onMessage: options.onMessage,
        onError(error) {
          if (!opened) reject(error);
          else options.onError?.(error);
        },
        onClose() {
          if (!opened) reject(new Error('Loopback connection closed before opening'));
          else options.onDisconnect?.();
        },
      });
    });
  } catch (error) {
    await server.close();
    throw error;
  }

  let closing: Promise<void> | undefined;
  return {
    sceneId,
    httpPort: server.httpPort,
    sshPort,
    sendInput: client.sendInput,
    resize: client.resize,
    close() {
      closing ??= (async () => {
        client.close();
        await server.close();
      })();
      return closing;
    },
  };
}
