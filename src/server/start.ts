import path from 'node:path';
import type { ProjectSourceOptions } from '../project/project.js';
import { loadOrCreateHostKey } from './host-key.js';
import { loadGame } from './load-game.js';
import { startHttpServer } from './http.js';
import { startSshServer } from './ssh.js';
import type { DialogueAnimationOptions, PortraitAnimationOptions, ScriptVariables } from './game-session.js';

export type StartedServer = {
  httpPort: number;
  sshPort?: number;
  close: () => Promise<void>;
};

export type StartOptions = ProjectSourceOptions & {
  host?: string;
  httpPort?: number;
  sshPort?: number;
  sshEnabled?: boolean;
  hostKey?: string;
  staticRoot?: string;
  dialogueAnimation?: DialogueAnimationOptions;
  portraitAnimation?: PortraitAnimationOptions;
  allowPlayerSpawn?: boolean;
  initialScriptVariables?: ScriptVariables;
};

const DEFAULT_HOST_KEY = path.join(process.cwd(), '.data', 'ssh_host_key');

export async function startServer(options: StartOptions): Promise<StartedServer> {
  const host = options.host ?? '127.0.0.1';
  const game = await loadGame(options);
  const http = await startHttpServer({
    host,
    port: options.httpPort ?? 7101,
    staticRoot: options.staticRoot,
    ...game,
    initialScriptVariables: options.initialScriptVariables,
  });
  if (options.sshEnabled === false) {
    return { httpPort: http.port, close: http.close };
  }
  try {
    const hostKey = options.hostKey ?? loadOrCreateHostKey(DEFAULT_HOST_KEY);
    const ssh = await startSshServer({
      host,
      port: options.sshPort ?? 7102,
      hostKey,
      ...game,
      initialScriptVariables: options.initialScriptVariables,
    });
    return {
      httpPort: http.port,
      sshPort: ssh.port,
      async close() {
        await Promise.all([http.close(), ssh.close()]);
      },
    };
  } catch (error) {
    await http.close();
    throw error;
  }
}
