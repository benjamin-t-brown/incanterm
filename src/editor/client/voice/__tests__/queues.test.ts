import { expect, it } from 'vitest';
import type { VoiceStudioResponse, VoiceTake } from '../../../voice/types.js';
import { getQueue } from '../queues.js';
import { getStudioView } from '../studio-api.js';

function createRecording(lineId: string): VoiceTake {
  return {
    lineId,
    takeId: `take-${lineId}`,
    speaker: 'Pat',
    text: 'Before',
    recordedRevision: 'previous',
    createdAt: '2026-02-01T12:00:00.000Z',
    scriptId: 'scripts/a.rpgscript',
    mimeType: 'audio/webm',
    favorite: true,
    roomToneId: null,
    edits: { gainDb: 0, cleanup: null },
  };
}

function createLine(lineId: string, requested: boolean) {
  return {
    lineId,
    requested,
    file: 'scripts/a.rpgscript',
    script: 'start',
    line: 4,
    revision: 'current',
    speaker: 'Pat',
    text: 'After',
    before: null,
    after: null,
  };
}

it('keeps unrequested and removed history out of coverage and pickup queues', () => {
  const response: VoiceStudioResponse = {
    catalog: {
      lines: [createLine('pickup', true), createLine('silent', false), createLine('unused', false)],
      errors: [],
      duplicates: [],
    },
    takes: ['pickup', 'silent', 'removed'].map(createRecording),
    approvals: [],
    roomTones: [],
  };
  const { lines } = getStudioView(response);
  expect(getQueue(lines, 'requested').map((l) => l.id)).toEqual(['pickup']);
  expect(getQueue(lines, 'needs-pickup').map((l) => l.id)).toEqual(['pickup']);
  expect(getQueue(lines, 'unrequested').map((l) => l.id)).toEqual(['silent']);
  expect(getQueue(lines, 'archived').map((l) => l.id)).toEqual(['removed']);
  expect(lines[0].takes[0].text).toBe('Before');
  expect(lines[0].text).toBe('After');
  response.catalog.errors.push({ file: 'scripts/other.rpgscript', message: 'Unreadable' });
  const partial = getStudioView(response);
  expect(getQueue(partial.lines, 'archived')).toEqual([]);
  expect(getQueue(partial.lines, 'unavailable').map((l) => l.id)).toEqual(['pickup', 'removed']);
  expect(getQueue(partial.lines, 'needs-pickup')).toEqual([]);
  expect(partial.errors[0]).toContain('Recording and publishing are paused');
});

it('reports both owners of a duplicate without treating either as a recording or pickup', () => {
  const first = createLine('dupe', true);
  const second = { ...first, file: 'scripts/b.rpgscript', line: 8 };
  const result = getStudioView({
    catalog: {
      lines: [first, second],
      duplicates: [{ lineId: 'dupe', locations: [first, second] }],
      errors: [],
    },
    takes: [createRecording('dupe')],
    approvals: [],
    roomTones: [],
  });
  expect(result.errors.join(' ')).toContain('scripts/a.rpgscript:4, scripts/b.rpgscript:8');
  expect(getQueue(result.lines, 'needs-pickup')).toEqual([]);
  expect(getQueue(result.lines, 'unavailable')).toHaveLength(1);
});
