import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { readVoiceCatalog, type VoiceLocation } from '../voice/catalog.js';
import { getPublishedVoiceClip, parseVoiceIndex, type VoiceIndex } from '../voice/contracts.js';

function getLocation({ file, line }: VoiceLocation) {
  return `${file}:${line}`;
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

async function assertRegularFile(file: string) {
  if (!(await fs.lstat(file)).isFile())
    throw new Error(`Expected a regular file, not a link: ${file}`);
}

async function readRequestedIndex(directory: string, requestedIds: Set<string>) {
  if (!(await fs.lstat(directory)).isDirectory())
    throw new Error(`Expected a published voice directory, not a link: ${directory}`);
  const indexPath = path.join(directory, 'index.json');
  await assertRegularFile(indexPath);
  return parseVoiceIndex(JSON.parse(await fs.readFile(indexPath, 'utf8')), requestedIds);
}

export async function exportVoice(sourceAssets: string, targetAssets: string) {
  const catalog = await readVoiceCatalog(targetAssets);
  const errors = [
    ...catalog.errors.map(({ file, message }) => `${file}: ${message}`),
    ...catalog.duplicates.map(
      ({ lineId, locations }) =>
        `Duplicate voice ID ${lineId}: ${locations.map(getLocation).join(', ')}`,
    ),
  ];
  if (errors.length) throw new Error(errors.join('\n'));

  const source = path.join(sourceAssets, 'audio', 'voice');
  const target = path.join(targetAssets, 'audio', 'voice');
  const requested = catalog.lines.filter((line) => line.requested);
  const filtered: VoiceIndex = { version: 1, clips: [] };
  await fs.mkdir(target);
  if (requested.length) {
    let index: VoiceIndex;
    try {
      index = await readRequestedIndex(source, new Set(requested.map(({ lineId }) => lineId)));
    } catch (error) {
      throw new Error(
        `Cannot read published voice index: ${getErrorMessage(error)}\n` +
          requested.map((line) => `${getLocation(line)}: ${line.lineId}`).join('\n'),
      );
    }
    const copied = new Map<string, string>();
    for (const line of requested) {
      try {
        const clip = getPublishedVoiceClip(index, line);
        if (!clip) {
          throw new Error(
            index.clips.some((entry) => entry.lineId === line.lineId)
              ? 'stale published voice revision'
              : 'missing published voice clip',
          );
        }
        let checksum = copied.get(clip.file);
        if (checksum === undefined) {
          const from = path.join(source, clip.file);
          const staged = path.join(target, clip.file);
          await assertRegularFile(from);
          await fs.copyFile(from, staged, constants.COPYFILE_EXCL);
          checksum = createHash('sha256')
            .update(await fs.readFile(staged))
            .digest('hex');
          copied.set(clip.file, checksum);
        }
        if (checksum !== clip.checksum) throw new Error(`checksum mismatch for ${clip.file}`);
        filtered.clips.push(clip);
      } catch (error) {
        errors.push(`${getLocation(line)}: ${line.lineId}: ${getErrorMessage(error)}`);
      }
    }
    if (errors.length) throw new Error(errors.join('\n'));
  }
  await fs.writeFile(path.join(target, 'index.json'), `${JSON.stringify(filtered, null, 2)}\n`, {
    flag: 'wx',
  });
}
