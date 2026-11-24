import { createHash, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { LoadedProject } from '../../project/project.js';
import { readVoiceCatalog } from '../../voice/catalog.js';
import {
  areVoiceEditsEqual,
  createVoiceApproval,
  getVoiceRecordingSnapshot,
  isVoiceApprovalValid,
  type VoiceEditSettings,
} from '../../voice/contracts.js';
import type { AssetResponse } from '../api.js';
import {
  MAX_VOICE_PUBLISH_BYTES,
  publishVoiceClip,
  type VoiceAudioFormat,
} from '../voice-publish.js';
import {
  getRoomTone,
  getVoiceHistory,
  getVoiceTake,
  MAX_VOICE_BYTES,
  readVoiceAudio,
  saveVoiceAudio,
  updateVoiceWork,
  VoiceError,
} from './storage.js';
import type { VoiceRoomTone } from './types.js';
import {
  getTakeParameters,
  getToneParameters,
  isRecord,
  isRenderDigest,
  isRoomSettings,
  isVoiceEdits,
  requestIdPattern,
} from './schema.js';

export function getEditorUploadLimit(method: string, url: string) {
  const parts = new URL(url, 'http://editor.local').pathname.split('/').filter(Boolean);
  return method === 'POST' &&
    parts.length === 7 &&
    parts[0] === 'api' &&
    parts[1] === 'projects' &&
    parts[3] === 'voice' &&
    parts[4] === 'takes' &&
    parts[6] === 'publish'
    ? MAX_VOICE_PUBLISH_BYTES
    : MAX_VOICE_BYTES;
}

function getJson(value: unknown, status = 200): AssetResponse {
  return {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    body: JSON.stringify(value),
  };
}

function getRecord(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw new VoiceError(400, 'Expected a JSON object');
  return value;
}

function parseBody(rawBody: string | Buffer) {
  if (Buffer.byteLength(rawBody) > 16_384)
    throw new VoiceError(413, 'Recording metadata is too large');
  return getRecord(JSON.parse(String(rawBody)));
}

function parseRoomSettings(value: unknown): VoiceRoomTone['settings'] {
  const settings = getRecord(value ?? {});
  if (!isRoomSettings(settings)) throw new VoiceError(400, 'Expected microphone settings');
  return settings;
}

function parseEdits(body: Record<string, unknown>, roomToneId: string | null): VoiceEditSettings {
  if (!isVoiceEdits(body, roomToneId))
    throw new VoiceError(
      422,
      'Expected gain within ±24 dB and Light cleanup using the room tone attached at recording time',
    );
  const { gainDb, cleanup } = body;
  return {
    gainDb,
    cleanup: cleanup && {
      profileId: cleanup.profileId,
      strengthDb: cleanup.strengthDb,
      algorithmVersion: cleanup.algorithmVersion,
    },
  };
}

async function getRequestedLine(project: LoadedProject, lineId: unknown, revision: unknown) {
  const catalog = await readVoiceCatalog(project.assetsRoot);
  if (catalog.errors.length)
    throw new VoiceError(
      409,
      `Cannot verify a unique voice ID until the saved scripts parse: ${catalog.errors.map((e) => e.file).join(', ')}`,
    );
  const owners = catalog.lines.filter((line) => line.lineId === lineId);
  if (owners.length !== 1 || !owners[0].requested || owners[0].revision !== revision)
    throw new VoiceError(
      409,
      'Refresh the studio: this line changed, is not requested, or has duplicate IDs',
    );
  return owners[0];
}

async function startRecording(
  project: LoadedProject,
  kind: 'takes' | 'roomTones',
  body: Record<string, unknown>,
) {
  return updateVoiceWork(project, async (index) => {
    const { requestId } = body;
    if (
      requestId !== undefined &&
      (typeof requestId !== 'string' || !requestIdPattern.test(requestId))
    )
      throw new VoiceError(400, 'Invalid recording request ID');
    const parameters =
      kind === 'takes'
        ? getTakeParameters(body.lineId, body.revision, body.roomToneId)
        : getToneParameters(body.sessionId, parseRoomSettings(body.settings));
    const prior =
      requestId && index.reservations?.find((r) => r.kind === kind && r.requestId === requestId);
    if (prior) {
      if (prior.parameters !== parameters)
        throw new VoiceError(409, 'Recording request ID was already used for another reservation');
      return { id: prior.id };
    }
    const id = randomUUID();
    const createdAt = new Date().toISOString();
    if (kind === 'takes') {
      const line = await getRequestedLine(project, body.lineId, body.revision);
      const roomToneId = body.roomToneId == null ? null : getRoomTone(index, body.roomToneId).id;
      index.takes.push({
        takeId: id,
        ...getVoiceRecordingSnapshot(line),
        scriptId: line.file,
        createdAt,
        mimeType: '',
        favorite: false,
        roomToneId,
        edits: { gainDb: 0, cleanup: null },
      });
    } else {
      const { sessionId } = body;
      if (typeof sessionId !== 'string' || !sessionId.trim() || sessionId.length > 128)
        throw new VoiceError(400, 'A recording session ID is required');
      index.roomTones.push({
        id,
        createdAt,
        sessionId,
        settings: parseRoomSettings(body.settings),
        mimeType: '',
      });
    }
    if (requestId) {
      index.reservations ??= [];
      index.reservations.push({ kind, requestId, id, parameters });
    }
    return { id };
  });
}

async function updateTake(
  project: LoadedProject,
  id: string,
  operation: string,
  body: Record<string, unknown>,
) {
  return updateVoiceWork(project, async (index, _dir, invalidate) => {
    const take = getVoiceTake(index, id);
    if (operation === 'favorite') {
      if (typeof body.favorite !== 'boolean') throw new VoiceError(400, 'Expected a favorite flag');
      take.favorite = body.favorite;
      return take;
    }
    const original = { gainDb: 0, cleanup: null };
    const expected = body.expectedEdits === undefined ? original : body.expectedEdits;
    function assertExpectedEdits() {
      if (!isVoiceEdits(expected, take.roomToneId) || !areVoiceEditsEqual(expected, take.edits))
        throw new VoiceError(409, 'Take edits changed; refresh before saving or approving');
    }
    const edits = parseEdits(
      getRecord(body.edits === undefined && operation === 'approval' ? original : body.edits),
      take.roomToneId,
    );
    if (operation === 'edits') {
      assertExpectedEdits();
      if (!areVoiceEditsEqual(edits, take.edits)) {
        const approvals = index.approvals.filter((a) => a.takeId === id);
        if (approvals.length) {
          invalidate(
            take.lineId,
            approvals.map((a) => a.revision),
          );
          index.approvals = index.approvals.filter((a) => a.takeId !== id);
        }
        take.edits = edits;
      }
      return take;
    }
    const line = await getRequestedLine(project, take.lineId, body.revision);
    const prior = index.approvals.find(
      (a) => a.lineId === line.lineId && a.revision === line.revision,
    );
    if (line.revision !== take.recordedRevision && body.confirmReuse !== true)
      throw new VoiceError(409, 'Confirm reuse of a take recorded for earlier wording');
    const edited = edits.gainDb !== 0 || edits.cleanup !== null;
    const renderSha256 = body.renderSha256;
    if (edited ? !isRenderDigest(renderSha256) : renderSha256 != null)
      throw new VoiceError(422, 'Only edited approvals require the SHA-256 of the reviewed WAV');
    const approval = {
      ...createVoiceApproval(line, take, edits, {
        confirmOlderTake: body.confirmReuse === true,
      }),
      ...(typeof renderSha256 === 'string' && { renderSha256 }),
    };
    // A lost response leaves the caller with old baselines. An exact duplicate
    // succeeds only after verifying the line is still eligible for this review.
    if (prior && isDeepStrictEqual(prior, approval)) return prior;
    assertExpectedEdits();
    if (!isDeepStrictEqual(prior ?? null, body.expectedApproval ?? null))
      throw new VoiceError(409, 'The approval changed; refresh before approving');
    if (
      prior &&
      isVoiceApprovalValid(line, take, index.approvals) &&
      areVoiceEditsEqual(edits, take.edits)
    )
      throw new VoiceError(409, 'A different WAV is already bound to this approval');
    const editsChanged = !areVoiceEditsEqual(take.edits, edits);
    take.edits = edits;
    index.approvals = index.approvals.filter(
      (a) =>
        (a.lineId !== line.lineId || a.revision !== line.revision) &&
        !(editsChanged && a.takeId === id),
    );
    index.approvals.push(approval);
    invalidate(take.lineId);
    return approval;
  });
}

async function publishTake(
  project: LoadedProject,
  takeId: string,
  query: URLSearchParams,
  body: string | Buffer,
  contentType: string,
) {
  if (Buffer.byteLength(body) > MAX_VOICE_PUBLISH_BYTES)
    throw new VoiceError(413, 'Voice render exceeds the publishing limit');
  const revision = query.get('revision');
  const expected: unknown = JSON.parse(query.get('edits') ?? 'null');
  const renderSha256 =
    Buffer.isBuffer(body) && body.length
      ? createHash('sha256').update(body).digest('hex')
      : undefined;
  async function getApprovedTake() {
    const { takes, approvals } = await getVoiceHistory(project);
    const take = takes.find((t) => t.takeId === takeId);
    if (!take) throw new VoiceError(404, 'Take not found');
    const line = await getRequestedLine(project, take.lineId, revision);
    if (
      !isVoiceApprovalValid(line, take, approvals) ||
      !isVoiceEdits(expected, take.roomToneId) ||
      !areVoiceEditsEqual(take.edits, expected)
    )
      throw new VoiceError(409, 'This exact take and its edits are no longer approved');
    const approved = approvals.find((a) => a.takeId === takeId && a.revision === revision);
    if (approved?.renderSha256 !== renderSha256)
      throw new VoiceError(409, 'The uploaded render does not match the approved WAV');
    return { take, line };
  }
  const { take, line } = await getApprovedTake();
  const edited = take.edits.cleanup !== null || take.edits.gainDb !== 0;
  if (edited && (!Buffer.isBuffer(body) || !body.length || contentType !== 'audio/wav'))
    throw new VoiceError(415, 'An edited take requires a PCM WAV render');
  if (!edited && body.length)
    throw new VoiceError(400, 'Publish the stored original for an unedited take');
  const audio =
    edited && Buffer.isBuffer(body) ? body : (await readVoiceAudio(project, 'takes', takeId)).bytes;
  return publishVoiceClip({
    assetsRoot: project.assetsRoot,
    lineId: line.lineId,
    revision: line.revision,
    audio,
    format: edited
      ? 'wav'
      : (take.mimeType.split(';')[0].slice('audio/'.length) as VoiceAudioFormat),
    assertApproved: async () => {
      await getApprovedTake();
    },
  });
}

export async function dispatchVoiceRequest(
  project: LoadedProject,
  method: string,
  parts: string[],
  rawBody: string | Buffer,
  contentType: string,
  query = new URLSearchParams(),
): Promise<AssetResponse> {
  try {
    if (!parts.length && method === 'GET') {
      const [catalog, history] = await Promise.all([
        readVoiceCatalog(project.assetsRoot),
        getVoiceHistory(project),
      ]);
      return getJson({ catalog, ...history });
    }
    const [resource, id, action] = parts;
    const kind = resource === 'takes' ? 'takes' : resource === 'room-tones' ? 'roomTones' : null;
    if (!kind) throw new VoiceError(404, 'Not found');
    if (kind === 'takes' && parts.length === 3 && action === 'publish' && method === 'POST')
      return getJson(await publishTake(project, id, query, rawBody, contentType));
    if (parts.length === 1 && method === 'POST')
      return getJson(await startRecording(project, kind, parseBody(rawBody)));
    if (parts.length === 3 && action === 'audio') {
      if (method === 'PUT')
        return getJson(await saveVoiceAudio(project, kind, id, rawBody, contentType));
      if (method === 'GET') {
        const audio = await readVoiceAudio(project, kind, id);
        return {
          status: 200,
          headers: {
            'content-type': audio.mimeType,
            'cache-control': 'no-store',
            'x-content-type-options': 'nosniff',
          },
          body: audio.bytes,
        };
      }
    }
    if (
      parts.length === 3 &&
      method === 'PUT' &&
      kind === 'takes' &&
      ['favorite', 'edits', 'approval'].includes(action)
    )
      return getJson(await updateTake(project, id, action, parseBody(rawBody)));
    throw new VoiceError(404, 'Not found');
  } catch (error) {
    if (error instanceof VoiceError) return getJson({ error: error.message }, error.status);
    if (error instanceof SyntaxError) return getJson({ error: 'Invalid JSON' }, 400);
    throw error;
  }
}
