import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { LoadedProject } from '../../project/project.js';
import { SaveCoordinator } from '../safe-save.js';
import { invalidatePublishedVoiceClip } from '../voice-publish.js';
import {
  parseVoiceWorkIndex,
  voiceFileId,
  voiceMimeType,
  type VoiceResource,
  type WorkIndex,
} from './schema.js';
import type { VoiceHistory, VoiceRoomTone, VoiceTake } from './types.js';

export const MAX_VOICE_BYTES = 4_000_000;
const saves = new SaveCoordinator();

export class VoiceError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function isWithin(parent: string, child: string) {
  const relative = path.relative(parent, child);
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

async function getWorkDirectory(project: LoadedProject, create = false) {
  const dir = path.join(project.root, 'voice-work');
  if (isWithin(dir, project.assetsRoot) || isWithin(project.assetsRoot, dir))
    throw new VoiceError(422, 'voice-work must be separate from the project assets folder');
  if (create) {
    try {
      await fs.mkdir(dir);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
  }
  try {
    if (!(await fs.lstat(dir)).isDirectory())
      throw new VoiceError(422, 'voice-work must be a project-owned directory, not a link');
  } catch (error) {
    if (create || (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  return dir;
}

async function readRegularFile(file: string) {
  if (!(await fs.lstat(file)).isFile()) throw new VoiceError(422, 'Expected a regular voice file');
  return fs.readFile(file);
}

async function readIndex(dir: string): Promise<WorkIndex> {
  try {
    return parseVoiceWorkIndex(
      JSON.parse(String(await readRegularFile(path.join(dir, 'index.json')))),
    );
  } catch (error) {
    if (error instanceof SyntaxError)
      throw new VoiceError(422, 'Invalid JSON in voice-work/index.json');
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    return { version: 1, takes: [], approvals: [], roomTones: [] };
  }
}

export async function updateVoiceWork<T>(
  project: LoadedProject,
  change: (
    index: WorkIndex,
    directory: string,
    invalidate: (lineId: string, revisions?: string[]) => void,
  ) => T | Promise<T>,
) {
  const dir = await getWorkDirectory(project, true);
  return saves.run(dir, async () => {
    const index = await readIndex(dir);
    const before = JSON.stringify(index, null, 2);
    let invalidation: { lineId: string; revisions?: string[] } | undefined;
    const result = await change(index, dir, (lineId, revisions) => {
      invalidation = { lineId, revisions };
    });
    const after = JSON.stringify(index, null, 2);
    if (!invalidation && before === after) return result;
    const temp = path.join(dir, `${randomUUID()}.tmp`);
    try {
      await fs.writeFile(temp, `${after}\n`, { flag: 'wx' });
      const commit = () => fs.rename(temp, path.join(dir, 'index.json'));
      if (invalidation)
        await invalidatePublishedVoiceClip(
          project.assetsRoot,
          invalidation.lineId,
          commit,
          invalidation.revisions,
        );
      else await commit();
    } finally {
      await fs.rm(temp, { force: true });
    }
    return result;
  });
}

export async function getVoiceHistory(project: LoadedProject): Promise<VoiceHistory> {
  const { takes, roomTones, approvals } = await readIndex(await getWorkDirectory(project));
  return {
    takes: takes.filter((take) => take.mimeType),
    approvals,
    roomTones: roomTones.filter((tone) => tone.mimeType),
  };
}

export function getVoiceTake(index: WorkIndex, id: string): VoiceTake {
  const take = index.takes.find((entry) => entry.takeId === id && entry.mimeType);
  if (!take) throw new VoiceError(404, 'Take not found');
  return take;
}

export function getRoomTone(index: WorkIndex, id: unknown): VoiceRoomTone {
  const tone = index.roomTones.find((entry) => entry.id === id && entry.mimeType);
  if (!tone) throw new VoiceError(404, 'Room tone not found');
  return tone;
}

function getAudioPath(dir: string, id: string) {
  if (!voiceFileId.test(id)) throw new VoiceError(404, 'Recording not found');
  return path.join(dir, `${id}.audio`);
}

function getAudioMimeType(contentType: string) {
  const mimeType = contentType.trim().toLowerCase();
  if (!voiceMimeType.test(mimeType))
    throw new VoiceError(415, 'Expected WebM, Ogg, MP4, or WAV audio');
  return mimeType;
}

export async function saveVoiceAudio(
  project: LoadedProject,
  kind: VoiceResource,
  id: string,
  body: string | Buffer,
  contentType: string,
) {
  if (Buffer.byteLength(body) > MAX_VOICE_BYTES)
    throw new VoiceError(413, 'Recording exceeds the 4 MB upload limit');
  if (!Buffer.isBuffer(body) || !body.length)
    throw new VoiceError(400, 'Recording is empty or not binary');
  const mimeType = getAudioMimeType(contentType);
  return updateVoiceWork(project, async (index, dir) => {
    const entry =
      kind === 'takes'
        ? index.takes.find((record) => record.takeId === id)
        : index.roomTones.find((record) => record.id === id);
    if (!entry) throw new VoiceError(404, 'Recording reservation not found');
    const file = getAudioPath(dir, id);
    if (entry.mimeType) {
      if (entry.mimeType !== mimeType || !(await readRegularFile(file)).equals(body))
        throw new VoiceError(409, 'Different audio was already uploaded for this recording');
      return entry;
    }
    // Link the completed temporary file into place without replacing an original.
    // A retry can also finish the index commit after an interrupted first upload.
    const temp = path.join(dir, `${randomUUID()}.tmp`);
    try {
      await fs.writeFile(temp, body, { flag: 'wx' });
      try {
        await fs.link(temp, file);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        if (!(await readRegularFile(file)).equals(body))
          throw new VoiceError(409, 'Different audio was already uploaded for this recording');
      }
    } finally {
      await fs.rm(temp, { force: true });
    }
    entry.mimeType = mimeType;
    return entry;
  });
}

export async function readVoiceAudio(project: LoadedProject, kind: VoiceResource, id: string) {
  const dir = await getWorkDirectory(project);
  const index = await readIndex(dir);
  const entry = kind === 'takes' ? getVoiceTake(index, id) : getRoomTone(index, id);
  return { mimeType: entry.mimeType, bytes: await readRegularFile(getAudioPath(dir, id)) };
}
