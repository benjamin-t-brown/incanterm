import { getVoiceStatus, type VoiceEditSettings } from '../../../voice/contracts.js';
import type { StudioApproval, VoiceStudioResponse } from '../../voice/types.js';
import { ApiError, jsonRequest, requestJson } from '../api.js';
import { getOpenedProject } from '../project.js';
import {
  previewVoiceTake,
  renderVoiceTake,
  getVoiceCleanupSettings,
} from '../voice-audio/index.js';
import type { StudioCatalog, StudioLine, StudioTake, VoiceEdits } from './queues.js';
import type { MicReport } from './recorder.js';

function getVoiceUrl(path = ''): string {
  const project = getOpenedProject();
  if (!project) throw new Error('Open a project before recording voice.');
  return `/api/projects/${project.key}/voice${path}`;
}

export function getTakeAudioUrl(takeId: string): string {
  return getVoiceUrl(`/takes/${encodeURIComponent(takeId)}/audio`);
}

export function getStudioView(data: VoiceStudioResponse): StudioCatalog {
  const { catalog, takes, approvals } = data;
  const duplicates = new Set(catalog.duplicates.map((d) => d.lineId));
  const errors = [
    ...(catalog.errors.length
      ? [
          'Some saved scripts could not be read. Recording and publishing are paused until every voice ID can be checked. Existing takes are still available.',
        ]
      : []),
    ...catalog.errors.map(({ file, message }) => `${file}: ${message}`),
    ...catalog.duplicates.map(
      ({ lineId, locations }) =>
        `Duplicate voice ID ${lineId}: ${locations.map((loc) => `${loc.file}:${loc.line}`).join(', ')}`,
    ),
  ];
  const byLine = new Map<string, typeof takes>();
  for (const recorded of takes) {
    const history = byLine.get(recorded.lineId);
    if (history) history.push(recorded);
    else byLine.set(recorded.lineId, [recorded]);
  }
  function getTakes(lineId: string): StudioTake[] {
    return [...(byLine.get(lineId) ?? [])]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((t) => ({
        id: t.takeId,
        revision: t.recordedRevision,
        speaker: t.speaker,
        text: t.text,
        createdAt: t.createdAt,
        favorite: t.favorite,
        roomToneId: t.roomToneId,
        edits: { gainDb: t.edits.gainDb, profileId: t.edits.cleanup?.profileId ?? null },
      }));
  }
  const seen = new Set<string>();
  const lines: StudioLine[] = [];
  for (const source of catalog.lines) {
    if (seen.has(source.lineId)) continue;
    seen.add(source.lineId);
    const state = getVoiceStatus(source, byLine.get(source.lineId) ?? [], approvals);
    const before = source.before;
    const after = source.after;
    lines.push({
      id: source.lineId,
      speaker: source.speaker,
      text: source.text,
      revision: source.revision,
      state:
        duplicates.has(source.lineId) || (source.requested && catalog.errors.length > 0)
          ? 'unavailable'
          : state === 'no-voice-requested'
            ? 'unrequested'
            : state,
      requested: source.requested,
      location: `${source.file}:${source.line} · ${source.script}`,
      takes: getTakes(source.lineId),
      context: [
        before ? `Before · ${before.speaker}: ${before.text}` : '',
        after ? `After · ${after.speaker}: ${after.text}` : '',
      ].filter(Boolean),
      approval: approvals.find((a) => a.lineId === source.lineId && a.revision === source.revision),
    });
  }
  for (const [lineId, history] of byLine) {
    if (seen.has(lineId)) continue;
    const archived = getTakes(lineId);
    const last = archived[0];
    lines.push({
      id: lineId,
      state: catalog.errors.length ? 'unavailable' : 'archived',
      requested: false,
      location: `Last recorded in ${history.find((t) => t.takeId === last.id)?.scriptId ?? 'unknown script'}`,
      speaker: last.speaker,
      text: last.text,
      revision: last.revision,
      context: [],
      takes: archived,
    });
  }
  return { lines, errors };
}

export async function getStudioCatalog(): Promise<StudioCatalog> {
  return getStudioView(await requestJson<VoiceStudioResponse>(getVoiceUrl()));
}

async function requestReservation(
  resource: string,
  metadata: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<string> {
  const options = {
    ...jsonRequest('POST', { ...metadata, requestId: crypto.randomUUID() }),
    signal,
  };
  const url = getVoiceUrl(resource);
  try {
    return (await requestJson<{ id: string }>(url, options)).id;
  } catch (error) {
    // An interrupted 2xx response body is surfaced by requestJson as an
    // ApiError with that successful status. The reservation may have committed.
    const lostAcknowledgement =
      error instanceof TypeError ||
      (error instanceof ApiError &&
        (error.status >= 500 || (error.status >= 200 && error.status < 300)));
    if (signal?.aborted || !lostAcknowledgement) throw error;
    return (await requestJson<{ id: string }>(url, options)).id;
  }
}

export async function startTake(
  line: StudioLine,
  roomToneId: string | null,
  signal?: AbortSignal,
): Promise<string> {
  return requestReservation(
    '/takes',
    { lineId: line.id, revision: line.revision, roomToneId },
    signal,
  );
}

export async function startRoomTone(
  sessionId: string,
  mic: MicReport,
  signal?: AbortSignal,
): Promise<string> {
  return requestReservation(
    '/room-tones',
    { sessionId, settings: { ...mic.settings, label: mic.label } },
    signal,
  );
}

export async function saveRecording(
  kind: 'tone' | 'take',
  id: string,
  blob: Blob,
  signal?: AbortSignal,
): Promise<void> {
  await requestJson(
    getVoiceUrl(`/${kind === 'take' ? 'takes' : 'room-tones'}/${encodeURIComponent(id)}/audio`),
    {
      method: 'PUT',
      headers: { 'content-type': blob.type },
      body: blob,
      signal,
    },
  );
}

export async function updateFavorite(id: string, favorite: boolean): Promise<void> {
  await requestJson(
    getVoiceUrl(`/takes/${encodeURIComponent(id)}/favorite`),
    jsonRequest('PUT', { favorite }),
  );
}

function getEditSettings(edits: VoiceEdits): VoiceEditSettings {
  return {
    gainDb: edits.gainDb,
    cleanup: edits.profileId ? getVoiceCleanupSettings(edits.profileId) : null,
  };
}

export async function saveTakeEdits(
  id: string,
  edits: VoiceEdits,
  expectedEdits: VoiceEdits,
): Promise<void> {
  await requestJson(
    getVoiceUrl(`/takes/${encodeURIComponent(id)}/edits`),
    jsonRequest('PUT', {
      edits: getEditSettings(edits),
      expectedEdits: getEditSettings(expectedEdits),
    }),
  );
}

async function readAudio(url: string, signal: AbortSignal): Promise<Blob> {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`Could not load recording (HTTP ${response.status}).`);
  return response.blob();
}

async function getRenderInput(id: string, edits: VoiceEdits, signal: AbortSignal) {
  const [original, roomTone] = await Promise.all([
    readAudio(getTakeAudioUrl(id), signal),
    edits.profileId
      ? readAudio(getVoiceUrl(`/room-tones/${encodeURIComponent(edits.profileId)}/audio`), signal)
      : undefined,
  ]);
  return { original, options: { roomTone, clipGainDb: edits.gainDb, signal } };
}

export async function getTakeComparison(id: string, edits: VoiceEdits, signal: AbortSignal) {
  const { original, options } = await getRenderInput(id, edits, signal);
  return previewVoiceTake(original, options);
}

export async function publishTake(
  line: StudioLine,
  take: StudioTake,
  edits: VoiceEdits,
  older: boolean,
  signal: AbortSignal,
  expectedEdits = take.edits,
  onApproved?: (approval: StudioApproval) => void,
): Promise<void> {
  const edited = edits.gainDb !== 0 || !!edits.profileId;
  let wav: Blob | undefined;
  let renderSha256: string | undefined;
  if (edited) {
    const { original, options } = await getRenderInput(take.id, edits, signal);
    wav = await renderVoiceTake(original, options);
    const digest = await crypto.subtle.digest('SHA-256', await wav.arrayBuffer());
    renderSha256 = Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, '0'),
    ).join('');
  }
  // The reservation owns the original; only the reviewed settings and these
  // exact rendered bytes may replace the current approval in one operation.
  const base = `/takes/${encodeURIComponent(take.id)}`;
  const approval = await requestJson<StudioApproval>(getVoiceUrl(`${base}/approval`), {
    ...jsonRequest('PUT', {
      revision: line.revision,
      confirmReuse: older,
      expectedApproval: line.approval ?? null,
      expectedEdits: getEditSettings(expectedEdits),
      edits: getEditSettings(edits),
      renderSha256,
    }),
    signal,
  });
  onApproved?.(approval);
  const query = new URLSearchParams({
    revision: line.revision,
    edits: JSON.stringify(getEditSettings(edits)),
  });
  try {
    await requestJson(getVoiceUrl(`${base}/publish?${query}`), {
      method: 'POST',
      headers: wav ? { 'content-type': 'audio/wav' } : {},
      body: wav,
      signal,
    });
  } catch (error) {
    throw new Error(
      `Take approved; publishing failed. ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
