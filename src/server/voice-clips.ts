import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { Dialogue } from '../game/rpgscript/index.js';
import { readVoiceCatalog } from '../voice/catalog.js';
import { getPublishedVoiceClip, parseVoiceIndex, type PublishedVoiceClip } from '../voice/contracts.js';

export interface GameVoiceClips {
  getChecksum(dialogue: Dialogue): string | undefined;
  readClip(checksum: string): Promise<Buffer | undefined>;
}

async function readVoiceFile(directory: string, filename: string): Promise<Buffer> {
  const file = path.join(directory, filename);
  if (path.relative(file, await fs.realpath(file)) !== '' || !(await fs.stat(file)).isFile())
    throw new Error('Expected a published voice file inside the project');
  return fs.readFile(file);
}

/** Optional game assets: an unfinished publication must never prevent the game from starting. */
export async function loadVoiceClips(assetsRoot: string): Promise<GameVoiceClips | undefined> {
  try {
    const directory = path.join(await fs.realpath(assetsRoot), 'audio', 'voice');
    const value: unknown = JSON.parse((await readVoiceFile(directory, 'index.json')).toString('utf8'));
    const catalog = await readVoiceCatalog(assetsRoot);
    if (catalog.errors.length) return;
    const duplicates = new Set(catalog.duplicates.map(({ lineId }) => lineId));
    const requested = catalog.lines.filter((line) => line.requested && !duplicates.has(line.lineId));
    const index = parseVoiceIndex(value, new Set(requested.map(({ lineId }) => lineId)));
    if (!index.clips.length) return;
    const byId = new Map<string, PublishedVoiceClip>();
    const byChecksum = new Map<string, string>();
    for (const line of requested) {
      const clip = getPublishedVoiceClip(index, line);
      if (!clip) continue;
      byId.set(line.lineId, clip);
      byChecksum.set(clip.checksum, clip.file);
    }
    return {
      getChecksum(dialogue) {
        if (!dialogue.voice?.requested) return;
        const clip = byId.get(dialogue.voice.lineId);
        if (clip?.revision === dialogue.voice.revision) return clip.checksum;
      },
      async readClip(checksum) {
        const filename = byChecksum.get(checksum);
        if (!filename) return;
        try {
          const data = await readVoiceFile(directory, filename);
          if (createHash('sha256').update(data).digest('hex') === checksum) return data;
        } catch { /* File removed or replaced since startup. */ }
      },
    };
  } catch {
    return undefined;
  }
}
