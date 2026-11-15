import fs from 'node:fs/promises';
import { afterEach, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import { createSceneFixtureAssets } from '../../game/__tests__/scene-fixture.js';
import { parseServerMessage } from '../../protocol/messages.js';
import * as hostKeys from '../host-key.js';
import * as ssh from '../ssh.js';
import { startServer } from '../start.js';

afterEach(() => vi.restoreAllMocks());

it('serves HTTP and WebSocket sessions without starting SSH or creating a host key', async () => {
  const root = await createSceneFixtureAssets();
  const key = vi.spyOn(hostKeys, 'loadOrCreateHostKey').mockImplementation(() => {
    throw new Error('Web-only servers must not need a writable host-key directory');
  });
  const listener = vi.spyOn(ssh, 'startSshServer');
  let socket: WebSocket | undefined;
  const server = await startServer({
    host: '127.0.0.1',
    httpPort: 0,
    assetsRoot: root,
    sceneId: 'fixture-room',
    sshEnabled: false,
    dialogueAnimation: { enabled: false },
    portraitAnimation: { enabled: false },
  });
  try {
    expect(server.sshPort).toBeUndefined();
    expect(key).not.toHaveBeenCalled();
    expect(listener).not.toHaveBeenCalled();
    expect((await fetch(`http://127.0.0.1:${server.httpPort}/health`)).status).toBe(200);
    socket = new WebSocket(`ws://127.0.0.1:${server.httpPort}/ws`);
    const frame = await new Promise<string>((resolve, reject) => {
      socket?.on('message', (data) => {
        const message = parseServerMessage(String(data));
        if (message?.type === 'terminal-data') resolve(message.data);
      });
      socket?.once('error', reject);
    });
    expect(frame).toContain('First fixture line.');
  } finally {
    socket?.terminate();
    await server.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});
