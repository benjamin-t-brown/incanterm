import { afterEach, expect, it, vi } from 'vitest';
import { setOpenedProject } from '../../project.js';
import { publishTake, startRoomTone, startTake } from '../studio-api.js';
import * as processing from '../../voice-audio/index.js';
import type { StudioLine, StudioTake } from '../queues.js';

function createTestReview() {
  setOpenedProject({
    key: 'test',
    name: 'Synthetic',
    root: '/',
    manifestPath: '/incanterm.json',
    entryScene: 'start',
    id: 'synthetic',
  });
  const take: StudioTake = {
    id: 'one',
    favorite: false,
    revision: 'old',
    speaker: 'Sample',
    text: 'Before',
    createdAt: '2026-01-01',
    roomToneId: null,
    edits: { gainDb: 0, profileId: null },
  };
  const line: StudioLine = {
    id: 'sample',
    requested: true,
    revision: 'current',
    state: 'needs-pickup',
    speaker: 'Sample',
    text: 'After',
    location: 'sample:1',
    takes: [take],
    context: [],
  };
  return { line, take };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it('checks the exact reviewed settings before approval and does not publish after a conflict', async () => {
  const { line, take } = createTestReview();
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ error: 'Take edits changed before approval' }), {
      status: 409,
    }),
  );
  vi.stubGlobal('fetch', fetchMock);
  await expect(
    publishTake(line, take, take.edits, true, new AbortController().signal),
  ).rejects.toThrow('edits changed');
  expect(fetchMock).toHaveBeenCalledOnce();
  const [url, options] = fetchMock.mock.calls[0];
  expect(url).toBe('/api/projects/test/voice/takes/one/approval');
  expect(JSON.parse(options.body)).toEqual({
    revision: 'current',
    confirmReuse: true,
    expectedApproval: null,
    edits: { gainDb: 0, cleanup: null },
    expectedEdits: { gainDb: 0, cleanup: null },
  });
});

it('replaces the full prior approval for the same take and sends the exact WAV bound to the new approval', async () => {
  const { line, take } = createTestReview();
  take.edits.gainDb = 4;
  line.approval = {
    takeId: take.id,
    lineId: line.id,
    revision: line.revision,
    edits: { gainDb: 4, cleanup: null },
    renderSha256: 'f'.repeat(64),
    confirmedOlderTake: true,
  };
  const rendered = new Blob(['abc'], { type: 'audio/wav' });
  vi.spyOn(processing, 'renderVoiceTake').mockResolvedValue(rendered);
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(new Response('original'))
    .mockResolvedValueOnce(new Response('{}'))
    .mockResolvedValueOnce(new Response('{}'));
  vi.stubGlobal('fetch', fetchMock);
  await publishTake(line, take, { profileId: null, gainDb: 2 }, true, new AbortController().signal);
  expect(fetchMock).toHaveBeenCalledTimes(3);
  const [approvalUrl, approval] = fetchMock.mock.calls[1];
  expect(approvalUrl).toContain('/approval');
  expect(JSON.parse(approval.body)).toEqual({
    revision: 'current',
    expectedApproval: line.approval,
    confirmReuse: true,
    expectedEdits: { gainDb: 4, cleanup: null },
    edits: { gainDb: 2, cleanup: null },
    renderSha256: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
  });
  expect(fetchMock.mock.calls[2][1].body).toBe(rendered);
});

it('retries a lost reservation acknowledgement with the same request ID for takes and tones', async () => {
  const { line } = createTestReview();
  const fetchMock = vi
    .fn()
    .mockRejectedValueOnce(new TypeError('lost response'))
    .mockResolvedValueOnce(new Response('{"id":"take"}'))
    .mockRejectedValueOnce(new TypeError('lost response'))
    .mockResolvedValueOnce(new Response('{"id":"tone"}'));
  vi.stubGlobal('fetch', fetchMock);
  await expect(startTake(line, null)).resolves.toBe('take');
  await expect(startRoomTone('session', { label: 'mic', settings: {} })).resolves.toBe('tone');
  const ids = fetchMock.mock.calls.map(([, options]) => JSON.parse(options.body).requestId);
  expect(ids[0]).toBeTruthy();
  expect(ids[0]).toBe(ids[1]);
  expect(ids[2]).toBe(ids[3]);
  expect(ids[0]).not.toBe(ids[2]);
});

it('replays the identical reservation if its response body breaks after the 200 headers', async () => {
  const { line } = createTestReview();
  const interrupted = new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"id":'));
      },
      pull: function failBodyRead(controller) {
        controller.error(new TypeError('Connection closed during body read'));
      },
    }),
    { status: 200 },
  );
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(interrupted)
    .mockResolvedValueOnce(new Response('{"id":"original-reservation"}'));
  vi.stubGlobal('fetch', fetchMock);
  await expect(startTake(line, 'tone')).resolves.toBe('original-reservation');
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(fetchMock.mock.calls[1]).toEqual(fetchMock.mock.calls[0]);
  expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
    lineId: line.id,
    revision: line.revision,
    roomToneId: 'tone',
    requestId: expect.any(String),
  });
});
