import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { getVoiceClipUrl } from '../../browser/voice-player.js';
import { createSceneFixtureAssets } from '../../game/__tests__/scene-fixture.js';
import { parseServerMessage } from '../../protocol/messages.js';
import { readVoiceCatalog } from '../../voice/catalog.js';
import { getVoiceRevision } from '../../voice/contracts.js';
import { startServer } from '../start.js';

it('serves only current, unique, requested publications from the selected game', async () => {
  const root = await createSceneFixtureAssets();
  const directory = path.join(root, 'audio', 'voice');
  let socket: WebSocket | undefined;
  let server: Awaited<ReturnType<typeof startServer>> | undefined;
  try {
    await fs.writeFile(path.join(root, 'scripts', 'entry.rpgscript'), [
      '#entry', 'load,start', '@start',
      '+playDialogue(Guide, "Ready.", "", "current")',
      '+playDialogue(Guide, "Edited.", "", "stale")',
      '+playDialogue(Guide, "Text.", "", "disabled", "no-voice")',
      '+playDialogue(Guide, "Here.", "", "duplicate")',
      '+playDialogue(Guide, "There.", "", "duplicate")',
    ].join('\n'));
    await fs.mkdir(directory, { recursive: true });
    const catalog = await readVoiceCatalog(root);
    const clips = [];
    for (const lineId of ['current', 'disabled', 'stale', 'duplicate', 'archived']) {
      const data = Buffer.from(`synthetic-${lineId}`);
      const file = `${lineId}.mp3`;
      const checksum = createHash('sha256').update(data).digest('hex');
      await fs.writeFile(path.join(directory, file), data);
      const oldRevision = getVoiceRevision('Guide', 'Previous wording.');
      const revision = lineId === 'stale' ? oldRevision : catalog.lines.find((line) => line.lineId === lineId)?.revision ?? oldRevision;
      clips.push({ lineId, revision, file: lineId === 'disabled' ? '../old.mp3' : file, checksum });
    }
    await fs.writeFile(path.join(directory, 'index.json'), JSON.stringify({ version: 1, clips }));
    server = await startServer({ assetsRoot: root, sceneId: 'fixture-room', sshEnabled: false, httpPort: 0 });
    const endpoint = `ws://127.0.0.1:${server.httpPort}/ws`;
    socket = new WebSocket(endpoint);
    const cues: string[] = [];
    await new Promise<void>((resolve, reject) => {
      socket?.on('message', (data) => {
        const message = parseServerMessage(String(data));
        if (message?.type === 'voice-start') cues.push(message.checksum);
        if (message?.type === 'terminal-data') resolve();
      });
      socket?.once('error', reject);
    });
    expect(cues).toEqual([clips[0].checksum]);
    const url = getVoiceClipUrl(endpoint, cues[0]);
    const response = await fetch(url);
    expect(response.headers.get('content-type')).toBe('audio/mpeg');
    expect(await response.text()).toBe('synthetic-current');
    expect((await fetch(url, { method: 'HEAD' })).status).toBe(200);
    for (const clip of clips.slice(1)) expect((await fetch(getVoiceClipUrl(endpoint, clip.checksum))).status).toBe(404);
    expect((await fetch(new URL('/voice/index.json', url))).status).toBe(404);
    expect((await fetch(url, { method: 'POST' })).status).toBe(405);
    await fs.writeFile(path.join(directory, 'current.mp3'), 'changed');
    expect((await fetch(url)).status).toBe(404);
    await fs.unlink(path.join(directory, 'current.mp3'));
    expect((await fetch(url)).status).toBe(404);
  } finally {
    socket?.terminate();
    await server?.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});
