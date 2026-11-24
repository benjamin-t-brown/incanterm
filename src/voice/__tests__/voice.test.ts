import { describe, expect, it } from 'vitest';
import {
  createVoiceApproval,
  getPublishedVoiceClip,
  getVoiceRecordingSnapshot,
  getVoiceRevision,
  getVoiceStatus,
  isVoiceApprovalValid,
  parseVoiceIndex,
  type VoiceEditSettings,
  type VoiceLine,
  type VoiceTake,
} from '../contracts.js';

function getLine(text = 'Ready? 🎤', speaker = 'Mira'): VoiceLine {
  return {
    lineId: 'intro',
    requested: true,
    text,
    speaker,
    revision: getVoiceRevision(speaker, text),
  };
}

function getTake(line: VoiceLine): VoiceTake {
  return {
    ...getVoiceRecordingSnapshot(line),
    takeId: 'first',
    createdAt: '2026-01-01T00:00:00.000Z',
    mimeType: 'audio/webm;codecs=opus',
  };
}

const bypass: VoiceEditSettings = { gainDb: 0, cleanup: null };

describe('voice revisions and recording history', () => {
  it('keeps a stable persisted revision, including for Unicode and ambiguous field boundaries', () => {
    expect(getLine().revision).toBe('v1-6ab7f453e31619f9');
    expect(getVoiceRevision('ab', 'c')).not.toBe(getVoiceRevision('a', 'bc'));
    expect(getLine().revision).not.toBe(getLine('Ready? 🎤', 'Nyx').revision);
    expect(getLine().revision).not.toBe(getLine('Ready?').revision);
  });

  it('keeps the wording at Record even if the script changes before upload', () => {
    const line = getLine();
    const snapshot = getVoiceRecordingSnapshot(line);
    Object.assign(line, getLine('Are we ready?'));
    expect(snapshot).toEqual({
      lineId: line.lineId,
      speaker: line.speaker,
      text: 'Ready? 🎤',
      recordedRevision: getLine().revision,
    });
    expect(() =>
      getVoiceRecordingSnapshot({ ...line, revision: snapshot.recordedRevision }),
    ).toThrow();
    expect(() => getVoiceRecordingSnapshot({ ...line, requested: false })).toThrow();
  });

  it('restores history by ID, honors opt-out, and reevaluates wording when requested again', () => {
    const line = getLine();
    const take = getTake(line);
    const approval = createVoiceApproval(line, take, bypass);
    const changed = getLine('Ready now?');
    expect(getVoiceStatus(line, [], [])).toBe('needs-recording');
    expect(getVoiceStatus(line, [{ ...take, favorite: true }], [])).toBe('needs-review');
    expect(getVoiceStatus(null, [take], [approval])).toBe('archived');
    expect(getVoiceStatus(line, [take], [approval])).toBe('approved');
    expect(getVoiceStatus({ ...changed, requested: false }, [take], [approval])).toBe(
      'no-voice-requested',
    );
    expect(getVoiceStatus(changed, [take], [approval])).toBe('needs-pickup');
    expect(
      getVoiceStatus(changed, [take, { ...getTake(changed), takeId: 'second' }], [approval]),
    ).toBe('needs-review');
  });

  it('requires the exact take and explicit reuse; approval snapshots settings and leaves the original alone', () => {
    const line = getLine();
    const take = getTake(line);
    const changed = getLine('Ready now?');
    const edits = {
      gainDb: 2,
      cleanup: { profileId: 'room', strengthDb: 6, algorithmVersion: '1' },
    };
    expect(() => createVoiceApproval(changed, take, edits)).toThrow(/confirm/i);
    expect(() => createVoiceApproval({ ...line, requested: false }, take, edits)).toThrow();
    expect(() => createVoiceApproval({ ...line, lineId: 'other' }, take, edits)).toThrow();
    take.edits = structuredClone(edits);
    const approval = createVoiceApproval(changed, take, edits, { confirmOlderTake: true });
    edits.cleanup.profileId = 'another-room';
    expect(approval.edits.cleanup?.profileId).toBe('room');
    expect(take.recordedRevision).toBe(line.revision);
    expect(getVoiceStatus(changed, [take], [approval])).toBe('approved');
    expect(getVoiceStatus(changed, [take], [{ ...approval, confirmedOlderTake: undefined }])).toBe(
      'needs-pickup',
    );
    expect(getVoiceStatus(changed, [take], [{ ...approval, takeId: 'missing' }])).toBe(
      'needs-pickup',
    );
    expect(getVoiceStatus(changed, [{ ...take, lineId: 'elsewhere' }], [approval])).toBe(
      'needs-recording',
    );
  });

  it('compares each approved edit by value for both the studio and publishing', () => {
    const line = getLine();
    const take = getTake(line);
    const cleanup = { profileId: 'booth', strengthDb: 6, algorithmVersion: '1' };
    const approval = createVoiceApproval(line, take, { gainDb: 2, cleanup });
    const reordered = { algorithmVersion: '1', strengthDb: 6, profileId: 'booth' };
    take.edits = { cleanup: reordered, gainDb: 2 };
    expect(isVoiceApprovalValid(line, take, [approval])).toBe(true);
    for (const edits of [
      undefined,
      { gainDb: 2, cleanup: null },
      { gainDb: 1, cleanup },
      { gainDb: 2, cleanup: { ...cleanup, profileId: 'outside' } },
      { gainDb: 2, cleanup: { ...cleanup, strengthDb: 3 } },
      { gainDb: 2, cleanup: { ...cleanup, algorithmVersion: '2' } },
    ]) {
      const changed = { ...take, edits };
      expect(isVoiceApprovalValid(line, changed, [approval])).toBe(false);
      expect(getVoiceStatus(line, [changed], [approval])).toBe('needs-review');
    }
    const original = { ...take, edits: undefined };
    expect(
      isVoiceApprovalValid(line, original, [createVoiceApproval(line, original, bypass)]),
    ).toBe(true);
  });

  it('rejects damaged line and take snapshots even with explicit reuse confirmation', () => {
    const line = getLine('Updated words');
    const take = getTake(getLine());
    const options = { confirmOlderTake: true };
    const approval = createVoiceApproval(line, take, bypass, options);
    const changedLine = { ...line, speaker: 'Other speaker' };
    const changedTake = { ...take, text: 'Other words' };
    expect(() => createVoiceApproval(changedLine, take, bypass, options)).toThrow(/revision/);
    expect(() => createVoiceApproval(line, changedTake, bypass, options)).toThrow(/revision/);
    expect(isVoiceApprovalValid(changedLine, take, [approval])).toBe(false);
    expect(isVoiceApprovalValid(line, changedTake, [approval])).toBe(false);
  });

  it('does not guess between competing approvals for this revision or count historical ones', () => {
    const line = getLine();
    const first = getTake(line);
    const second = { ...first, takeId: 'second' };
    const approval = createVoiceApproval(line, first, bypass);
    const conflict = createVoiceApproval(line, second, bypass);
    const takes = [first, second];
    expect(getVoiceStatus(line, takes, [approval, conflict])).toBe('needs-review');
    expect(isVoiceApprovalValid(line, first, [approval, conflict])).toBe(false);
    expect(isVoiceApprovalValid(line, second, [conflict, approval])).toBe(false);
    expect(
      getVoiceStatus(line, takes, [approval, { ...conflict, revision: getLine('Old').revision }]),
    ).toBe('approved');
    expect(getVoiceStatus(line, takes, [approval, { ...conflict, lineId: 'other' }])).toBe(
      'approved',
    );
  });
});

describe('published voice index', () => {
  const line = getLine();
  const clip = {
    lineId: line.lineId,
    revision: line.revision,
    file: 'intro.mp3',
    checksum: 'a'.repeat(64),
  };

  it('keeps only release metadata and plays only the current requested revision', () => {
    const index = parseVoiceIndex({ version: 1, clips: [{ ...clip, original: 'work.webm' }] });
    expect(index).toEqual({ version: 1, clips: [clip] });
    expect(getPublishedVoiceClip(index, line)).toEqual(clip);
    expect(getPublishedVoiceClip(index, getLine('Changed.'))).toBeUndefined();
    expect(getPublishedVoiceClip(index, { ...line, requested: false })).toBeUndefined();
    expect(getPublishedVoiceClip(index, { ...line, lineId: 'other' })).toBeUndefined();
  });

  it('rejects unknown versions, ambiguous entries, unsafe clip paths and malformed checksums', () => {
    expect(() => parseVoiceIndex({ version: 2, clips: [] })).toThrow();
    expect(() => parseVoiceIndex({ version: 1, clips: [clip, clip] })).toThrow(/duplicate/i);
    for (const invalid of [
      { file: '../original.mp3' },
      { file: 'samples.webm' },
      { checksum: '?' },
    ]) {
      expect(() => parseVoiceIndex({ version: 1, clips: [{ ...clip, ...invalid }] })).toThrow();
    }
  });

  it('ignores malformed disabled entries but fully validates the same entry when requested', () => {
    const old = { ...clip, lineId: 'disabled', file: '../old.mp3' };
    const input = { version: 1, clips: [old, clip] };
    expect(parseVoiceIndex(input, new Set([clip.lineId])).clips).toEqual([clip]);
    expect(() => parseVoiceIndex(input, new Set([clip.lineId, old.lineId]))).toThrow(/invalid/i);
    expect(() => parseVoiceIndex(input)).toThrow(/invalid/i);
  });

  it('accepts generated checksum filenames, RPGScript IDs, and only portable published metadata', () => {
    const produced = { ...clip, lineId: 'v_listener-2', file: `${clip.checksum}.mp3` };
    expect(parseVoiceIndex({ version: 1, clips: [produced] }).clips).toEqual([produced]);
    for (const invalid of [
      { lineId: 'two words' },
      { lineId: 'a'.repeat(129) },
      { lineId: '../intro' },
      { revision: 'arbitrary' },
      { revision: 'v1-0123456789ABCDEf' },
      { revision: 'v2-0123456789abcdef' },
      { file: 'nUl.mp3' },
      { file: 'COM1.old.mp3' },
      { file: 'lpt9.mp3' },
      { file: `${'a'.repeat(252)}.mp3` },
    ]) {
      expect(() => parseVoiceIndex({ version: 1, clips: [{ ...clip, ...invalid }] })).toThrow(
        /invalid/i,
      );
    }
  });
});
