import { isVoiceLineId, isVoiceRevision, type VoiceLine } from './model.js';

export interface PublishedVoiceClip {
  lineId: string;
  revision: string;
  /** MP3 basename relative to the project's audio/voice directory. */
  file: string;
  /** Lowercase SHA-256 hex digest of the published bytes. */
  checksum: string;
}

/** Runtime data only. Originals, edit settings and recording metadata stay in voice-work. */
export interface VoiceIndex {
  version: 1;
  clips: PublishedVoiceClip[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPortableMp3Name(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length <= 255 &&
    /^[a-zA-Z0-9_-][a-zA-Z0-9._-]*\.mp3$/.test(value) &&
    !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])\./i.test(value)
  );
}

/** Validate once on load and return only runtime fields, including for a filtered export. */
export function parseVoiceIndex(value: unknown, requestedIds?: ReadonlySet<string>): VoiceIndex {
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.clips)) {
    throw new Error('Expected a version 1 voice index with a clips array.');
  }
  const ids = new Set<string>();
  const clips: PublishedVoiceClip[] = [];
  for (const clip of value.clips) {
    // A game's inputs are the requested lines in its saved scripts. Ignore old
    // publications before validating fields or resolving any of their paths.
    if (requestedIds && (!isRecord(clip) || typeof clip.lineId !== 'string' || !requestedIds.has(clip.lineId))) continue;
    if (!isRecord(clip)) throw new Error('Expected a published voice clip.');
    const { lineId, revision, file, checksum } = clip;
    if (
      !isVoiceLineId(lineId) ||
      !isVoiceRevision(revision) ||
      !isPortableMp3Name(file) ||
      typeof checksum !== 'string' ||
      !/^[0-9a-f]{64}$/.test(checksum)
    ) {
      throw new Error(`Invalid published voice clip for line ${String(lineId)}.`);
    }
    if (ids.has(lineId)) throw new Error(`Duplicate published voice line ID: ${lineId}.`);
    ids.add(lineId);
    clips.push({ lineId, revision, file, checksum });
  }
  return { version: 1, clips };
}

export function getPublishedVoiceClip(
  index: VoiceIndex,
  line: Pick<VoiceLine, 'lineId' | 'requested' | 'revision'>,
): PublishedVoiceClip | undefined {
  if (!line.requested) return undefined;
  return index.clips.find((clip) => clip.lineId === line.lineId && clip.revision === line.revision);
}
