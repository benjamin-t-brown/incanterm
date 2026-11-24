import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  isVoiceLineId,
  isVoiceRevision,
  parseVoiceIndex,
  type PublishedVoiceClip,
  type VoiceIndex,
} from '../voice/contracts.js';
import { SaveCoordinator } from './safe-save.js';

const demuxers = { webm: 'matroska', ogg: 'ogg', mp4: 'mov', wav: 'wav' } as const;
export type VoiceAudioFormat = keyof typeof demuxers;
export const MAX_VOICE_PUBLISH_BYTES = 32 * 1024 * 1024;
const maxSeconds = 180;
// At 96 kb/s, including encoder delay and end padding. Reject overflow rather
// than publishing an apparently successful but truncated take.
const maxMp3Bytes = 12_000 * maxSeconds + 2_048;
const coordinator = new SaveCoordinator();

export type VoicePublishOptions = {
  assetsRoot: string;
  lineId: string;
  revision: string;
  audio: Buffer;
  format: VoiceAudioFormat;
  // Server-owned check against the saved catalog, exact take and approved edits.
  // Throw if the request is disabled, duplicated, stale, or no longer approved.
  assertApproved(): Promise<void>;
};

function validatePcmWav(audio: Buffer): void {
  const invalid = 'Expected a bounded 16-bit mono or stereo PCM WAV render';
  if (
    audio.length < 44 ||
    audio.toString('latin1', 0, 4) !== 'RIFF' ||
    audio.readUInt32LE(4) !== audio.length - 8 ||
    audio.toString('latin1', 8, 12) !== 'WAVE'
  )
    throw new Error(invalid);
  let frameBytes = 0;
  let sampleRate = 0;
  let dataBytes = 0;
  for (let offset = 12; offset < audio.length; ) {
    if (offset + 8 > audio.length) throw new Error(invalid);
    const id = audio.toString('latin1', offset, offset + 4);
    const size = audio.readUInt32LE(offset + 4);
    const start = offset + 8;
    offset = start + size + (size % 2);
    if (offset > audio.length) throw new Error(invalid);
    if (id === 'fmt ') {
      if (frameBytes || size !== 16 || audio.readUInt16LE(start) !== 1) throw new Error(invalid);
      const channels = audio.readUInt16LE(start + 2);
      sampleRate = audio.readUInt32LE(start + 4);
      frameBytes = channels * 2;
      if (
        ![1, 2].includes(channels) ||
        sampleRate < 8_000 ||
        sampleRate > 96_000 ||
        audio.readUInt32LE(start + 8) !== sampleRate * frameBytes ||
        audio.readUInt16LE(start + 12) !== frameBytes ||
        audio.readUInt16LE(start + 14) !== 16
      )
        throw new Error(invalid);
    } else if (id === 'data') {
      if (!frameBytes || dataBytes || size === 0 || size % frameBytes !== 0)
        throw new Error(invalid);
      dataBytes = size;
    }
  }
  if (!dataBytes || dataBytes > sampleRate * frameBytes * maxSeconds) throw new Error(invalid);
}

function encodeVoiceMp3(audio: Buffer, format: VoiceAudioFormat): Promise<Buffer> {
  // Both streams are pipes. No project path, URL, filter, codec or command-line
  // option comes from the request; even the input demuxer is fixed.
  const args = [
    '-hide_banner',
    '-loglevel',
    'error',
    '-nostdin',
    '-xerror',
    '-abort_on',
    'empty_output',
    '-max_alloc',
    '67108864',
    '-filter_threads',
    '1',
    '-protocol_whitelist',
    'pipe',
    '-threads',
    '1',
    '-f',
    demuxers[format],
    '-i',
    'pipe:0',
    '-map',
    '0:a:0',
    '-map_metadata',
    '-1',
    '-map_chapters',
    '-1',
    '-ac',
    '1',
    '-ar',
    '48000',
    '-c:a',
    'libmp3lame',
    '-b:a',
    '96k',
    '-threads',
    '1',
    '-write_xing',
    '0',
    '-id3v2_version',
    '0',
    '-f',
    'mp3',
    'pipe:1',
  ];
  return new Promise((resolve, reject) => {
    const child = execFile(
      'ffmpeg',
      args,
      {
        encoding: 'buffer',
        windowsHide: true,
        timeout: 30_000,
        killSignal: 'SIGKILL',
        maxBuffer: maxMp3Bytes,
      },
      (error, stdout) => {
        if (error?.code === 'ENOENT')
          reject(new Error('Install FFmpeg on the editor machine to publish voice'));
        else if (error || !stdout.length)
          reject(new Error('FFmpeg could not encode this take within the publishing limits'));
        else resolve(stdout);
      },
    );
    // A decoder rejecting an upload can close its stdin while Node is writing.
    child.stdin?.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code !== 'EPIPE' && error.code !== 'EOF') child.kill('SIGKILL');
    });
    child.stdin?.end(audio);
  });
}

async function ensureDirectory(directory: string, create: boolean): Promise<boolean> {
  try {
    if (create) await fs.mkdir(directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  }
  try {
    if (!(await fs.lstat(directory)).isDirectory())
      throw new Error('Voice publication needs real directories under the assets root');
    return true;
  } catch (error) {
    if (!create && (error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

async function getVoiceDirectory(root: string, create: boolean): Promise<string | undefined> {
  const audio = path.join(root, 'audio');
  const voice = path.join(audio, 'voice');
  if ((await ensureDirectory(audio, create)) && (await ensureDirectory(voice, create)))
    return voice;
}

async function readIndex(directory: string): Promise<VoiceIndex> {
  const file = path.join(directory, 'index.json');
  try {
    if (!(await fs.lstat(file)).isFile()) throw new Error('Voice index must be a regular file');
    return parseVoiceIndex(JSON.parse(await fs.readFile(file, 'utf8')));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1, clips: [] };
    throw error;
  }
}

/** Install complete bytes once. A preexisting file is never ours to roll back. */
async function tryInstallClip(staged: string, file: string, bytes: Buffer): Promise<boolean> {
  try {
    await fs.link(staged, file);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  }
  const existing = await fs.lstat(file);
  if (
    !existing.isFile() ||
    existing.size !== bytes.length ||
    !(await fs.readFile(file)).equals(bytes)
  )
    throw new Error('Existing voice clip does not match its checksum filename');
  return false;
}

function hasFileReference(index: VoiceIndex, file: string): boolean {
  // Index basenames are portable; preserve case aliases on case-insensitive volumes.
  return index.clips.some((clip) => clip.file.toLowerCase() === file.toLowerCase());
}

async function replaceIndexEntry(
  directory: string,
  lineId: string,
  publication?: { clip: PublishedVoiceClip; bytes: Buffer; assertApproved(): Promise<void> },
  affectedRevisions?: readonly string[],
): Promise<void> {
  const current = await readIndex(directory);
  const previous = current.clips.find((clip) => clip.lineId === lineId);
  if (
    !publication &&
    (!previous || (affectedRevisions && !affectedRevisions.includes(previous.revision)))
  )
    return;
  const index: VoiceIndex = {
    ...current,
    clips: current.clips.filter((clip) => clip.lineId !== lineId),
  };
  if (publication) index.clips.push(publication.clip);
  const staging = await fs.mkdtemp(path.join(directory, '.publish-'));
  const stagedIndex = path.join(staging, 'index.json');
  let rollbackFile: string | undefined;
  try {
    await fs.writeFile(stagedIndex, `${JSON.stringify(index, null, 2)}\n`);
    if (publication) {
      const { clip, bytes } = publication;
      const stagedMp3 = path.join(staging, clip.file);
      await fs.writeFile(stagedMp3, bytes);
      await publication.assertApproved();
      const file = path.join(directory, clip.file);
      if ((await tryInstallClip(stagedMp3, file, bytes)) && !hasFileReference(current, clip.file))
        rollbackFile = file;
    }
    // Until this rename, the previous index still points at complete old bytes.
    await fs.rename(stagedIndex, path.join(directory, 'index.json'));
    rollbackFile = undefined;
    if (
      previous &&
      previous.file === `${previous.checksum}.mp3` &&
      !hasFileReference(index, previous.file)
    ) {
      await fs.rm(path.join(directory, previous.file), { force: true });
    }
  } catch (error) {
    if (rollbackFile) await fs.unlink(rollbackFile);
    throw error;
  } finally {
    await fs.rm(staging, { recursive: true, force: true });
  }
}

async function writePublishedVoiceClip(options: VoicePublishOptions): Promise<PublishedVoiceClip> {
  const { assetsRoot, lineId, revision, audio, format, assertApproved } = options;
  if (!isVoiceLineId(lineId) || !isVoiceRevision(revision))
    throw new Error('Invalid voice line ID or revision');
  if (!Object.hasOwn(demuxers, format)) throw new Error('Unsupported voice recording format');
  if (!Buffer.isBuffer(audio) || audio.length === 0 || audio.length > MAX_VOICE_PUBLISH_BYTES)
    throw new Error('Voice audio exceeds publishing size limits or is empty');
  if (format === 'wav') validatePcmWav(audio);
  await assertApproved();
  const root = await fs.realpath(assetsRoot);
  return coordinator.run(root, async () => {
    const directory = await getVoiceDirectory(root, true);
    if (!directory) throw new Error('Missing voice publication directory');
    const bytes = await encodeVoiceMp3(audio, format);
    const checksum = createHash('sha256').update(bytes).digest('hex');
    const clip = { lineId, revision, file: `${checksum}.mp3`, checksum };
    await replaceIndexEntry(directory, lineId, { clip, bytes, assertApproved });
    return clip;
  });
}

// Change an approval or approved edit under the publication lock. Remove the old
// runtime entry first: a failed metadata save or later encode must fail closed.
async function removePublishedVoiceClip<T>(
  assetsRoot: string,
  lineId: string,
  commitMutation: () => Promise<T>,
  affectedRevisions?: readonly string[],
): Promise<T> {
  const root = await fs.realpath(assetsRoot);
  return coordinator.run(root, async () => {
    const directory = await getVoiceDirectory(root, false);
    if (directory) await replaceIndexEntry(directory, lineId, undefined, affectedRevisions);
    return commitMutation();
  });
}

export {
  writePublishedVoiceClip as publishVoiceClip,
  removePublishedVoiceClip as invalidatePublishedVoiceClip,
};
