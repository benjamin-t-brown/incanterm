import path from 'node:path';
import { TEST_SCENE_ID, defaultAssetsRoot, loadScene } from '../game/load-scene.js';
import { loadOrCreateHostKey } from './host-key.js';
import { loadRpgScripts } from '../game/rpgscript/index.js';
import { loadPortraitAssets } from '../game/portrait-assets.js';
import { startHttpServer } from './http.js';
import { startSshServer } from './ssh.js';

export type StartedServer = {
  httpPort: number;
  sshPort: number;
  close: () => Promise<void>;
};

export type StartOptions = {
  host?: string;
  httpPort?: number;
  sshPort?: number;
  hostKey?: string;
  staticRoot?: string;
  assetsRoot?: string;
  sceneId?: string;
};

const DEFAULT_HOST_KEY = path.join(process.cwd(), '.data', 'ssh_host_key');

export async function startServer(options: StartOptions = {}): Promise<StartedServer> {
  const host = options.host ?? '127.0.0.1';
  const hostKey = options.hostKey ?? loadOrCreateHostKey(DEFAULT_HOST_KEY);
  const assetsRoot = options.assetsRoot ?? defaultAssetsRoot();
  const scene = await loadScene(assetsRoot, options.sceneId ?? TEST_SCENE_ID);
  const scripts = await loadRpgScripts(assetsRoot);
  const portraits = await loadPortraitAssets(assetsRoot);
  for (const trigger of scene.triggers)
    if (!scripts.triggers.has(trigger))
      throw new Error(`Scene ${scene.id} references unknown RPGScript trigger ${trigger}`);
  const http = await startHttpServer({
    host,
    port: options.httpPort ?? 7101,
    staticRoot: options.staticRoot,
    scene,
    scripts,
    portraits,
  });
  try {
    const ssh = await startSshServer({
      host,
      port: options.sshPort ?? 7102,
      hostKey,
      scene,
      scripts,
      portraits,
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
