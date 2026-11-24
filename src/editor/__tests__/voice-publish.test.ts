import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { getVoiceRevision, parseVoiceIndex } from '../../voice/contracts.js';
import {
  invalidatePublishedVoiceClip,
  publishVoiceClip,
  type VoicePublishOptions,
} from '../voice-publish.js';

let directory: string;
let assetsRoot: string;
const hasFfmpeg =
  spawnSync('ffmpeg', ['-version'], { stdio: 'ignore', timeout: 5_000 }).status === 0;

beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'voice-publish-'));
  assetsRoot = path.join(directory, 'assets');
  await fs.mkdir(assetsRoot);
});

afterEach(async () => {
  await fs.rm(directory, { recursive: true, force: true });
});

function createWav(frequency = 440): Buffer {
  const frames = 800;
  const audio = Buffer.alloc(frames * 2 + 44);
  audio.write('RIFF', 0);
  audio.writeUInt32LE(audio.length - 8, 4);
  audio.write('WAVEfmt ', 8);
  audio.writeUInt32LE(16, 16);
  audio.writeUInt16LE(1, 20);
  audio.writeUInt16LE(1, 22);
  audio.writeUInt32LE(8_000, 24);
  audio.writeUInt32LE(16_000, 28);
  audio.writeUInt16LE(2, 32);
  audio.writeUInt16LE(16, 34);
  audio.write('data', 36);
  audio.writeUInt32LE(frames * 2, 40);
  for (let i = 0; i < frames; i++) {
    audio.writeInt16LE(
      Math.round(8_000 * Math.sin((i * frequency * Math.PI * 2) / 8_000)),
      44 + i * 2,
    );
  }
  return audio;
}

function getOptions(changes: Partial<VoicePublishOptions> = {}): VoicePublishOptions {
  return {
    assetsRoot,
    lineId: 'v_test',
    revision: getVoiceRevision('Actor', 'Test.'),
    audio: createWav(),
    format: 'wav',
    assertApproved: vi.fn(async () => {}),
    ...changes,
  };
}

it('requires an approval and rejects malformed or compressed WAV renders before encoding', async () => {
  const audio = createWav();
  audio.writeUInt16LE(3, 20);
  await expect(publishVoiceClip(getOptions({ audio }))).rejects.toThrow(/PCM WAV/);
  await expect(
    publishVoiceClip(getOptions({ audio: createWav().subarray(0, -2) })),
  ).rejects.toThrow(/PCM WAV/);
  await expect(
    publishVoiceClip(
      getOptions({
        assertApproved: async () => {
          throw new Error('No current approval');
        },
      }),
    ),
  ).rejects.toThrow('No current approval');
  expect(await fs.readdir(assetsRoot)).toEqual([]);
});

it('does not write through an audio directory junction', async () => {
  const elsewhere = path.join(directory, 'elsewhere');
  await fs.mkdir(elsewhere);
  await fs.symlink(elsewhere, path.join(assetsRoot, 'audio'), 'junction');
  await expect(publishVoiceClip(getOptions())).rejects.toThrow(/director/);
  expect(await fs.readdir(elsewhere)).toEqual([]);
});

async function readPublishedIndex() {
  return parseVoiceIndex(
    JSON.parse(await fs.readFile(path.join(assetsRoot, 'audio/voice/index.json'), 'utf8')),
  );
}

it.runIf(hasFfmpeg)(
  'encodes the original into a checksum-addressed MP3 and preserves simultaneous publications',
  async () => {
    const options = getOptions();
    const original = Buffer.from(options.audio);
    const [clip, other] = await Promise.all([
      publishVoiceClip(options),
      publishVoiceClip(getOptions({ lineId: 'v_other', audio: createWav(880) })),
    ]);
    const bytes = await fs.readFile(path.join(assetsRoot, 'audio/voice', clip.file));
    expect(bytes.readUInt16BE(0) & 0xffe0).toBe(0xffe0); // MPEG frame sync
    expect(clip.checksum).toBe(createHash('sha256').update(bytes).digest('hex'));
    expect(other.checksum).not.toBe(clip.checksum);
    expect(options.audio).toEqual(original);
    expect((await readPublishedIndex()).clips).toEqual(expect.arrayContaining([clip, other]));
    expect(options.assertApproved).toHaveBeenCalledTimes(2);
  },
);

it.runIf(hasFfmpeg)(
  'invalidates before reapproval, rejects the racing stale publish, and stays unpublished if the new encode fails',
  async () => {
    const oldClip = await publishVoiceClip(getOptions());
    let approvedTake = 'a';
    let resume!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>((resolve) => {
      resume = resolve;
    });
    const waiting = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const assertApproved = vi.fn(async () => {
      if (approvedTake !== 'a') throw new Error('Approval changed');
    });
    assertApproved.mockImplementationOnce(async () => {
      entered();
      await gate;
    });
    const pending = publishVoiceClip(getOptions({ assertApproved }));
    await waiting;
    await invalidatePublishedVoiceClip(assetsRoot, 'v_test', async () => {
      expect((await readPublishedIndex()).clips).toEqual([]);
      approvedTake = 'b';
    });
    resume();
    await expect(pending).rejects.toThrow('Approval changed');
    await expect(
      publishVoiceClip(getOptions({ format: 'webm', audio: Buffer.from('not a webm') })),
    ).rejects.toThrow(/FFmpeg/);
    expect((await readPublishedIndex()).clips).toEqual([]);
    await expect(fs.stat(path.join(assetsRoot, 'audio/voice', oldClip.file))).rejects.toMatchObject(
      { code: 'ENOENT' },
    );
  },
);

it('does not overwrite a damaged index or commit an approval behind it', async () => {
  const voice = path.join(assetsRoot, 'audio/voice');
  await fs.mkdir(voice, { recursive: true });
  await fs.writeFile(path.join(voice, 'index.json'), '{broken');
  const commitMutation = vi.fn(async () => {});
  await expect(
    invalidatePublishedVoiceClip(assetsRoot, 'v_test', commitMutation),
  ).rejects.toThrow();
  expect(commitMutation).not.toHaveBeenCalled();
  expect(await fs.readFile(path.join(voice, 'index.json'), 'utf8')).toBe('{broken');
});

it.runIf(hasFfmpeg).each(['new', 'preexisting', 'referenced but missing'] as const)(
  'rolls back a failed index replacement with a %s checksum file',
  async (state) => {
    const existing = await publishVoiceClip(getOptions());
    const next = getOptions({ lineId: 'v_next', audio: createWav(880) });
    const candidate = await publishVoiceClip(next);
    const dir = path.join(assetsRoot, 'audio/voice');
    const file = path.join(dir, candidate.file);
    const indexFile = path.join(dir, 'index.json');
    const bytes = await fs.readFile(file);
    const clips =
      state === 'referenced but missing'
        ? [existing, { ...candidate, lineId: 'v_other' }]
        : [existing];
    const index = JSON.stringify({ version: 1, clips });
    await fs.writeFile(indexFile, index);
    if (state !== 'preexisting') await fs.unlink(file);

    const rename = fs.rename.bind(fs);
    const failIndexCommit = vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
      if (to === indexFile) {
        expect(await fs.readFile(file)).toEqual(bytes);
        throw new Error('Index replacement failed');
      }
      return rename(from, to);
    });
    try {
      await expect(publishVoiceClip(next)).rejects.toThrow('Index replacement failed');
    } finally {
      failIndexCommit.mockRestore();
    }

    expect(await fs.readFile(indexFile, 'utf8')).toBe(index);
    const expected = [existing.file, 'index.json'];
    if (state !== 'new') {
      expected.push(candidate.file);
      expect(await fs.readFile(file)).toEqual(bytes);
    }
    expect((await fs.readdir(dir)).sort()).toEqual(expected.sort());
  },
);

it('keeps a later revision published when changing an old take, and preserves bytes shared with another line', async () => {
  const directory = path.join(assetsRoot, 'audio/voice');
  await fs.mkdir(directory, { recursive: true });
  const bytes = Buffer.from('test clip');
  const checksum = createHash('sha256').update(bytes).digest('hex');
  const first = {
    lineId: 'v_first',
    revision: getVoiceRevision('Actor', 'Current.'),
    file: `${checksum}.mp3`,
    checksum,
  };
  const second = { ...first, lineId: 'v_second' };
  await fs.writeFile(path.join(directory, first.file), bytes);
  await fs.writeFile(
    path.join(directory, 'index.json'),
    JSON.stringify({ version: 1, clips: [first, second] }),
  );
  const commit = vi.fn(async () => {});
  await invalidatePublishedVoiceClip(assetsRoot, first.lineId, commit, [
    getVoiceRevision('Actor', 'Older.'),
  ]);
  expect((await readPublishedIndex()).clips).toEqual([first, second]);
  await invalidatePublishedVoiceClip(assetsRoot, first.lineId, commit, [first.revision]);
  expect((await readPublishedIndex()).clips).toEqual([second]);
  expect(await fs.readFile(path.join(directory, second.file))).toEqual(bytes);
  expect(commit).toHaveBeenCalledTimes(2);
});
