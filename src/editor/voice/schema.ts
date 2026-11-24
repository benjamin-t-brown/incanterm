import {
  areVoiceEditsEqual,
  getVoiceRevision,
  isVoiceLineId,
  isVoiceRevision,
  type VoiceEditSettings,
} from '../../voice/contracts.js';
import type { VoiceHistory, VoiceRoomTone } from './types.js';

export type VoiceResource = 'takes' | 'roomTones';
export type WorkIndex = VoiceHistory & {
  version: 1;
  reservations?: { kind: VoiceResource; requestId: string; id: string; parameters: string }[];
};

export const voiceFileId = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
export const voiceMimeType =
  /^audio\/(?:webm|ogg|mp4|wav)(?:;\s*codecs=(?:"[a-z0-9.-]+"|[a-z0-9.-]+))?$/;
export const requestIdPattern = /^[\w-]{1,128}$/;

export function getTakeParameters(lineId: unknown, revision: unknown, roomToneId: unknown) {
  return JSON.stringify([lineId, revision, roomToneId ?? null]);
}

export function getToneParameters(sessionId: unknown, settings: VoiceRoomTone['settings']) {
  return JSON.stringify([
    sessionId,
    Object.entries(settings).sort(([a], [b]) => a.localeCompare(b)),
  ]);
}

export function isRenderDigest(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function isRoomSettings(value: unknown): value is VoiceRoomTone['settings'] {
  return (
    isRecord(value) &&
    Object.values(value).every(
      (v) =>
        typeof v === 'boolean' ||
        typeof v === 'string' ||
        (typeof v === 'number' && Number.isFinite(v)),
    )
  );
}

export function isVoiceEdits(value: unknown, roomToneId: unknown): value is VoiceEditSettings {
  if (
    !isRecord(value) ||
    typeof value.gainDb !== 'number' ||
    !Number.isFinite(value.gainDb) ||
    Math.abs(value.gainDb) > 24
  )
    return false;
  const cleanup = value.cleanup;
  return (
    cleanup === null ||
    (isRecord(cleanup) &&
      typeof roomToneId === 'string' &&
      cleanup.profileId === roomToneId &&
      cleanup.strengthDb === 6 &&
      cleanup.algorithmVersion === 'spectral-light-v1')
  );
}

function assertValid(valid: unknown, detail: string): asserts valid {
  if (!valid) throw new Error(`Invalid voice-work/index.json: ${detail}`);
}

function isRecording(entry: unknown): entry is Record<string, unknown> {
  return (
    isRecord(entry) &&
    typeof entry.createdAt === 'string' &&
    Number.isFinite(Date.parse(entry.createdAt)) &&
    typeof entry.mimeType === 'string' &&
    (entry.mimeType === '' || voiceMimeType.test(entry.mimeType))
  );
}

/** Validate all references before allowing any mutation to rewrite the index. */
export function parseVoiceWorkIndex(value: unknown): WorkIndex {
  assertValid(isRecord(value) && value.version === 1, 'expected version 1');
  assertValid(Array.isArray(value.roomTones), 'expected a roomTones array');
  assertValid(Array.isArray(value.takes), 'expected a takes array');
  assertValid(Array.isArray(value.approvals), 'expected an approvals array');
  const tones = new Map<string, VoiceRoomTone>();
  for (const [i, entry] of value.roomTones.entries()) {
    assertValid(
      isRecording(entry) &&
        typeof entry.id === 'string' &&
        voiceFileId.test(entry.id) &&
        typeof entry.sessionId === 'string' &&
        !!entry.sessionId.trim() &&
        isRoomSettings(entry.settings),
      `invalid roomTones[${i}]`,
    );
    assertValid(!tones.has(entry.id), `duplicate recording ID ${entry.id}`);
    tones.set(entry.id, value.roomTones[i]);
  }
  const takes = new Map<string, VoiceHistory['takes'][number]>();
  for (const [i, entry] of value.takes.entries()) {
    assertValid(
      isRecording(entry) &&
        typeof entry.takeId === 'string' &&
        voiceFileId.test(entry.takeId) &&
        isVoiceLineId(entry.lineId) &&
        typeof entry.speaker === 'string' &&
        typeof entry.text === 'string' &&
        entry.recordedRevision === getVoiceRevision(entry.speaker, entry.text) &&
        typeof entry.favorite === 'boolean' &&
        typeof entry.scriptId === 'string' &&
        (entry.roomToneId === null ||
          (typeof entry.roomToneId === 'string' && tones.get(entry.roomToneId)?.mimeType)) &&
        isVoiceEdits(entry.edits, entry.roomToneId),
      `invalid takes[${i}]`,
    );
    assertValid(
      !tones.has(entry.takeId) && !takes.has(entry.takeId),
      `duplicate recording ID ${entry.takeId}`,
    );
    takes.set(entry.takeId, value.takes[i]);
  }
  const approved = new Set<string>();
  for (const [i, approval] of value.approvals.entries()) {
    const take =
      isRecord(approval) && typeof approval.takeId === 'string'
        ? takes.get(approval.takeId)
        : undefined;
    assertValid(
      take?.mimeType &&
        take.lineId === approval.lineId &&
        isVoiceRevision(approval.revision) &&
        (approval.revision === take.recordedRevision || approval.confirmedOlderTake === true) &&
        isVoiceEdits(approval.edits, take.roomToneId) &&
        areVoiceEditsEqual(approval.edits, take.edits) &&
        (take.edits.gainDb !== 0 || take.edits.cleanup
          ? isRenderDigest(approval.renderSha256)
          : approval.renderSha256 === undefined),
      `invalid approvals[${i}]`,
    );
    const key = JSON.stringify([approval.lineId, approval.revision]);
    assertValid(!approved.has(key), `conflicting approvals for ${key}`);
    approved.add(key);
  }
  if (value.reservations !== undefined) {
    assertValid(Array.isArray(value.reservations), 'expected a reservations array');
    const keys = new Set<string>();
    for (const [i, r] of value.reservations.entries()) {
      assertValid(
        isRecord(r) &&
          typeof r.requestId === 'string' &&
          requestIdPattern.test(r.requestId) &&
          typeof r.parameters === 'string' &&
          typeof r.id === 'string' &&
          ((r.kind === 'takes' && takes.has(r.id)) || (r.kind === 'roomTones' && tones.has(r.id))),
        `invalid reservations[${i}]`,
      );
      const key = `${r.kind}:${r.requestId}`;
      const take = takes.get(r.id);
      const tone = tones.get(r.id);
      const parameters = take
        ? getTakeParameters(take.lineId, take.recordedRevision, take.roomToneId)
        : tone && getToneParameters(tone.sessionId, tone.settings);
      assertValid(
        r.parameters === parameters,
        `reservations[${i}] parameters do not match the recording`,
      );
      assertValid(!keys.has(key), `duplicate recording request ${key}`);
      keys.add(key);
    }
  }
  return value as WorkIndex;
}
