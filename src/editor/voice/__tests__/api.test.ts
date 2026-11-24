import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createProject, type LoadedProject } from '../../../project/project.js';
import { getVoiceStatus } from '../../../voice/contracts.js';
import { dispatchProjectRequest, ProjectRegistry } from '../../projects.js';
import type { VoiceStudioResponse } from '../types.js';
import { getEditorUploadLimit } from '../api.js';

let workspace: string;
let project: LoadedProject;
let registry: ProjectRegistry;
let key: string;
const lineId = 'v_wait';
const mime = 'audio/wav';

it('applies the PCM render limit to equivalent publish URLs and only those uploads', () => {
  const url = '/api/projects/key/voice/takes/take/publish';
  for (const suffix of ['', '/', '/?revision=x', '?revision=x'])
    expect(getEditorUploadLimit('POST', url + suffix)).toBe(32 * 1024 * 1024);
  expect(getEditorUploadLimit('PUT', url)).toBe(4_000_000);
  expect(getEditorUploadLimit('POST', `${url}/other`)).toBe(4_000_000);
});

beforeEach(async () => {
  workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'voice-studio-api-'));
  project = await createProject(path.join(workspace, 'scratch'), 'Scratch');
  registry = new ProjectRegistry(workspace);
  key = (await registry.openProject(project.root)).key;
  await writeLine('Wait here.');
});
afterEach(async () => {
  await registry.close();
  await fs.rm(workspace, { recursive: true, force: true });
});

function createWav(sample: number) {
  const audio = Buffer.alloc(46);
  audio.write('RIFF', 0);
  audio.writeUInt32LE(38, 4);
  audio.write('WAVEfmt ', 8);
  audio.writeUInt32LE(16, 16);
  audio.writeUInt16LE(1, 20);
  audio.writeUInt16LE(1, 22);
  audio.writeUInt32LE(8000, 24);
  audio.writeUInt32LE(16000, 28);
  audio.writeUInt16LE(2, 32);
  audio.writeUInt16LE(16, 34);
  audio.write('data', 36);
  audio.writeUInt32LE(2, 40);
  audio.writeInt16LE(sample, 44);
  return audio;
}

function writeLine(text: string, optOut = false, file = 'lobby') {
  return fs.writeFile(
    path.join(project.assetsRoot, `scripts/${file}.rpgscript`),
    `@${file}\n+playDialogue(Tess, "${text}", "", "${lineId}"${optOut ? ', "no-voice"' : ''})\n`,
  );
}

function callVoice(method: string, route = '', body: unknown = '') {
  return dispatchProjectRequest(
    registry,
    method,
    `/api/projects/${key}/voice${route}`,
    Buffer.isBuffer(body) ? body : JSON.stringify(body),
    Buffer.isBuffer(body) ? mime : 'application/json',
  );
}

async function getStudio(): Promise<VoiceStudioResponse> {
  const response = await callVoice('GET');
  expect(response.status, String(response.body)).toBe(200);
  return JSON.parse(String(response.body));
}

async function startTake(revision: string, fields: Record<string, unknown> = {}): Promise<string> {
  const response = await callVoice('POST', '/takes', { lineId, revision, ...fields });
  expect(response.status, String(response.body)).toBe(200);
  return JSON.parse(String(response.body)).id;
}

it('keeps four original WAVs under the wording at Record across moves, rewrites, concurrent retries and reopen', async () => {
  const { revision } = (await getStudio()).catalog.lines[0];
  const ids: string[] = [];
  for (let i = 0; i < 4; i++) {
    const id = await startTake(revision, { requestId: `attempt-${i}` });
    ids.push(id);
    if (i === 3) {
      expect((await getStudio()).takes).toHaveLength(3);
      await fs.rename(
        path.join(project.assetsRoot, 'scripts/lobby.rpgscript'),
        path.join(project.assetsRoot, 'scripts/hall.rpgscript'),
      );
      expect((await getStudio()).catalog.lines[0].revision).toBe(revision);
      await writeLine('Meet me upstairs.', false, 'hall');
      expect(await startTake(revision, { requestId: 'attempt-3' })).toBe(id);
      expect((await callVoice('POST', '/takes', { lineId, revision })).status).toBe(409);
    }
    const uploaded = await Promise.all(
      [0, 1].map(() => callVoice('PUT', `/takes/${id}/audio`, createWav(i))),
    );
    expect(uploaded.map((r) => r.status)).toEqual([200, 200]);
  }
  expect((await callVoice('PUT', `/takes/${ids[3]}/audio`, createWav(-1))).status).toBe(409);
  await registry.close();
  registry = new ProjectRegistry(workspace);
  key = (await registry.openProject(project.root)).key;
  const studio = await getStudio();
  expect(studio.takes).toHaveLength(4);
  for (const [i, id] of ids.entries()) {
    expect(studio.takes.find((t) => t.takeId === id)).toMatchObject({
      recordedRevision: revision,
      text: 'Wait here.',
      speaker: 'Tess',
    });
    expect((await callVoice('GET', `/takes/${id}/audio`)).body).toEqual(createWav(i));
  }
  expect(getVoiceStatus(studio.catalog.lines[0], studio.takes, studio.approvals)).toBe(
    'needs-pickup',
  );
  const approve = { revision: studio.catalog.lines[0].revision };
  expect((await callVoice('PUT', `/takes/${ids[0]}/approval`, approve)).status).toBe(409);
  expect(
    (await callVoice('PUT', `/takes/${ids[0]}/approval`, { ...approve, confirmReuse: true }))
      .status,
  ).toBe(200);
  expect((await getStudio()).approvals[0]).toMatchObject({
    ...approve,
    takeId: ids[0],
    confirmedOlderTake: true,
  });
  expect((await fs.readdir(project.assetsRoot)).includes('voice-work')).toBe(false);
});

it('keeps uploaded room tone and edit settings separate from originals and other projects', async () => {
  const { revision } = (await getStudio()).catalog.lines[0];
  const settings = { label: 'Mic', autoGainControl: false, sampleRate: 48000 };
  const tone = await callVoice('POST', '/room-tones', { sessionId: 'session-1', settings });
  const { id: profileId } = JSON.parse(String(tone.body));
  expect((await callVoice('PUT', `/room-tones/${profileId}/audio`, createWav(9))).status).toBe(200);
  const id = await startTake(revision, { roomToneId: profileId });
  expect((await callVoice('PUT', `/takes/${id}/audio`, createWav(32))).status).toBe(200);
  const route = `/takes/${id}`;
  await callVoice('PUT', `${route}/favorite`, { favorite: true });
  expect((await getStudio()).approvals).toEqual([]);
  const edits = {
    gainDb: 1,
    cleanup: { profileId, strengthDb: 6, algorithmVersion: 'spectral-light-v1' },
  };
  const original = { gainDb: 0, cleanup: null };
  const renderSha256 = createHash('sha256').update(createWav(36)).digest('hex');
  expect(
    (await callVoice('PUT', `${route}/edits`, { expectedEdits: original, edits })).status,
  ).toBe(200);
  // Tab A heard the original; tab B changed the gain and enabled cleanup.
  expect(
    (await callVoice('PUT', `${route}/approval`, { revision, edits: { gainDb: 0, cleanup: null } }))
      .status,
  ).toBe(409);
  expect(
    (
      await callVoice('PUT', `${route}/approval`, {
        revision,
        expectedEdits: edits,
        edits,
        renderSha256,
      })
    ).status,
  ).toBe(200);
  const studio = await getStudio();
  expect(studio.approvals[0]).toMatchObject({ takeId: id, edits });
  expect(studio.roomTones[0]).toMatchObject({ id: profileId, sessionId: 'session-1', settings });
  expect(studio.takes[0]).toMatchObject({ roomToneId: profileId, favorite: true, edits });
  expect(
    (await callVoice('PUT', `${route}/edits`, { expectedEdits: edits, edits: original })).status,
  ).toBe(200);
  expect((await getStudio()).approvals).toEqual([]);
  expect((await callVoice('GET', `${route}/audio`)).body).toEqual(createWav(32));
  expect((await callVoice('GET', `/room-tones/${profileId}/audio`)).body).toEqual(createWav(9));
  const other = await registry.createProject('other', 'Other');
  key = other.key;
  expect((await getStudio()).takes).toEqual([]);
  expect((await callVoice('GET', `${route}/audio`)).status).toBe(404);
  expect((await callVoice('PUT', `${route}/audio`, createWav(0))).status).toBe(404);
});

it('atomically approves edits and binds their WAV; a stale approval cannot invalidate the current publication', async () => {
  const { revision } = (await getStudio()).catalog.lines[0];
  const id = await startTake(revision);
  const route = `/takes/${id}`;
  await callVoice('PUT', `${route}/audio`, createWav(16));
  const original = { gainDb: 0, cleanup: null };
  const edits = { gainDb: 3, cleanup: null };
  const bytes = createWav(23);
  const renderSha256 = createHash('sha256').update(bytes).digest('hex');
  const approval = {
    revision,
    expectedEdits: original,
    edits,
    renderSha256,
    expectedApproval: null,
  };
  expect(
    (await callVoice('PUT', `${route}/approval`, { ...approval, renderSha256: undefined })).status,
  ).toBe(422);
  expect((await getStudio()).takes[0].edits).toEqual(original);
  expect((await callVoice('PUT', `${route}/approval`, approval)).status).toBe(200);
  const savedApproval = (await getStudio()).approvals[0];
  const published = path.join(project.assetsRoot, 'audio/voice');
  await fs.mkdir(published);
  const runtimeIndex = JSON.stringify({
    version: 1,
    clips: [{ lineId, revision, file: `${renderSha256}.mp3`, checksum: renderSha256 }],
  });
  await fs.writeFile(path.join(published, 'index.json'), runtimeIndex);
  // The first request succeeded but the response was lost. Retrying must not
  // even replace the work index, much less remove a subsequently published clip.
  const workFile = path.join(project.root, 'voice-work/index.json');
  await fs.utimes(workFile, 1000, 1000);
  const previousMtime = (await fs.stat(workFile)).mtimeMs;
  expect(JSON.parse(String((await callVoice('PUT', `${route}/approval`, approval)).body))).toEqual(
    savedApproval,
  );
  expect((await fs.stat(workFile)).mtimeMs).toBe(previousMtime);
  // Stale tab has a plausible new render and old baseline. Neither edit nor invalidation may commit.
  expect(
    (
      await callVoice('PUT', `${route}/approval`, {
        ...approval,
        expectedApproval: savedApproval,
        edits: { ...edits, gainDb: 5 },
      })
    ).status,
  ).toBe(409);
  expect(
    (await callVoice('PUT', `${route}/edits`, { expectedEdits: original, edits: original })).status,
  ).toBe(409);
  const query = new URLSearchParams({ revision, edits: JSON.stringify(edits) });
  const changedBytes = createWav(24);
  expect(
    (
      await callVoice('PUT', `${route}/approval`, {
        ...approval,
        expectedEdits: edits,
        expectedApproval: savedApproval,
        renderSha256: createHash('sha256').update(changedBytes).digest('hex'),
      })
    ).status,
  ).toBe(409);
  expect((await callVoice('POST', `${route}/publish/?${query}`, changedBytes)).status).toBe(409);
  expect((await getStudio()).approvals[0]).toMatchObject({ takeId: id, edits, renderSha256 });
  expect(await fs.readFile(path.join(published, 'index.json'), 'utf8')).toBe(runtimeIndex);
  await fs.writeFile(
    path.join(project.assetsRoot, 'scripts/broken.rpgscript'),
    '@bad\n+playDialogue(\n',
  );
  expect((await callVoice('POST', `${route}/publish?${query}`, bytes)).status).toBe(409);
  expect((await callVoice('PUT', `${route}/approval`, approval)).status).toBe(409);
});

it('rejects a stale replacement when another reviewer changed the prior approval on the same take', async () => {
  const { revision } = (await getStudio()).catalog.lines[0];
  const a = await startTake(revision);
  const b = await startTake(revision);
  for (const id of [a, b]) await callVoice('PUT', `/takes/${id}/audio`, createWav(12));
  const original = { gainDb: 0, cleanup: null };
  expect((await callVoice('PUT', `/takes/${a}/approval`, { revision })).status).toBe(200);
  const first = (await getStudio()).approvals[0];
  const edited = {
    revision,
    edits: { ...original, gainDb: 1 },
    expectedEdits: original,
    expectedApproval: first,
    renderSha256: createHash('sha256').update(createWav(14)).digest('hex'),
  };
  expect((await callVoice('PUT', `/takes/${a}/approval`, edited)).status).toBe(200);
  const updated = (await getStudio()).approvals[0];
  expect(updated.takeId).toBe(first.takeId);
  // B itself has not changed, and its own edit precondition still holds.
  const replacement = {
    revision,
    edits: original,
    expectedEdits: original,
    expectedApproval: first,
  };
  expect((await callVoice('PUT', `/takes/${b}/approval`, replacement)).status).toBe(409);
  expect(
    (
      await callVoice('PUT', `/takes/${b}/approval`, {
        ...replacement,
        expectedApproval: { ...updated, renderSha256: '0'.repeat(64) },
      })
    ).status,
  ).toBe(409);
  expect((await getStudio()).approvals).toEqual([updated]);
  expect(
    (await callVoice('PUT', `/takes/${b}/approval`, { ...replacement, expectedApproval: updated }))
      .status,
  ).toBe(200);
});

it('rejects reservation records whose saved parameters describe another real take or room tone', async () => {
  const { revision } = (await getStudio()).catalog.lines[0];
  const tone = {
    sessionId: 'same-session',
    settings: { sampleRate: 48000 },
    requestId: 'profile-a',
  };
  await callVoice('POST', '/room-tones', tone);
  const otherTone = await callVoice('POST', '/room-tones', {
    ...tone,
    requestId: 'profile-b',
    settings: { sampleRate: 44100 },
  });
  const { id: profileId } = JSON.parse(String(otherTone.body));
  await callVoice('PUT', `/room-tones/${profileId}/audio`, createWav(3));
  await startTake(revision, { requestId: 'take-a' });
  const withTone = await startTake(revision, { requestId: 'take-b', roomToneId: profileId });
  const file = path.join(project.root, 'voice-work/index.json');
  const valid = await fs.readFile(file, 'utf8');
  for (const [requestId, id] of [
    ['profile-a', profileId],
    ['take-a', withTone],
  ]) {
    const index = JSON.parse(valid);
    const old = index.reservations.find((r: { requestId: string }) => r.requestId === requestId);
    old.id = id;
    const corrupt = JSON.stringify(index);
    await fs.writeFile(file, corrupt);
    const retry =
      requestId === 'profile-a'
        ? await callVoice('POST', '/room-tones', tone)
        : await callVoice('POST', '/takes', { lineId, revision, requestId });
    expect(retry.status).toBe(422);
    expect(String(retry.body)).toContain('parameters do not match the recording');
    expect(await fs.readFile(file, 'utf8')).toBe(corrupt);
  }
});

it('blocks duplicate and unrequested reservations and approvals while preserving recorded history', async () => {
  const { revision } = (await getStudio()).catalog.lines[0];
  const id = await startTake(revision);
  await callVoice('PUT', `/takes/${id}/audio`, createWav(6));
  await writeLine('Wait here.', true);
  expect((await callVoice('PUT', `/takes/${id}/approval`, { revision })).status).toBe(409);
  expect((await callVoice('POST', '/takes', { lineId, revision })).status).toBe(409);
  await writeLine('Wait here.', false, 'duplicate');
  const studio = await getStudio();
  expect(studio.catalog.duplicates[0].locations).toHaveLength(2);
  expect((await callVoice('POST', '/takes', { lineId, revision })).status).toBe(409);
  expect((await callVoice('PUT', `/takes/${id}/approval`, { revision })).status).toBe(409);
  expect(studio.takes).toHaveLength(1);
});

it('blocks new work if an unreadable script may hide a second owner, but finishes an existing upload', async () => {
  const { revision } = (await getStudio()).catalog.lines[0];
  const id = await startTake(revision);
  await fs.writeFile(
    path.join(project.assetsRoot, 'scripts/unreadable.rpgscript'),
    '@another\n+playDialogue(\n',
  );
  const studio = await getStudio();
  expect(studio.catalog.errors[0].file).toBe('scripts/unreadable.rpgscript');
  expect((await callVoice('POST', '/takes', { lineId, revision })).status).toBe(409);
  expect((await callVoice('PUT', `/takes/${id}/audio`, createWav(4))).status).toBe(200);
  expect((await callVoice('PUT', `/takes/${id}/approval`, { revision })).status).toBe(409);
});

it('reports a malformed work index without overwriting recordings or conflicting approvals', async () => {
  const { revision } = (await getStudio()).catalog.lines[0];
  const id = await startTake(revision);
  await callVoice('PUT', `/takes/${id}/audio`, createWav(4));
  await callVoice('PUT', `/takes/${id}/approval`, { revision });
  const file = path.join(project.root, 'voice-work/index.json');
  const index = JSON.parse(await fs.readFile(file, 'utf8'));
  for (const [bad, message] of [
    [{ version: 1 }, 'expected a roomTones array'],
    [{ ...index, approvals: [...index.approvals, ...index.approvals] }, 'conflicting approvals'],
  ] as const) {
    const contents = JSON.stringify(bad);
    await fs.writeFile(file, contents);
    const res = await callVoice('PUT', `/takes/${id}/favorite`, { favorite: true });
    expect(res.status).toBe(422);
    expect(String(res.body)).toContain(message);
    expect(await fs.readFile(file, 'utf8')).toBe(contents);
  }
});
