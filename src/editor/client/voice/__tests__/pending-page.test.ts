import { afterEach, expect, it, vi } from 'vitest';
import { TestElement } from '../../__tests__/dom-fixture.js';
import { allowLeave, setDirtyGuard } from '../../shell.js';
import { confirmModal } from '../../modal.js';
import * as api from '../studio-api.js';
import { VoiceRecorder } from '../recorder.js';
import { mountVoiceStudio } from '../voice.js';

vi.mock('../../modal.js', () => ({ confirmModal: vi.fn(), promptModal: vi.fn() }));

class StudioControl extends TestElement {
  onclick?: () => void;
  oninput?: () => void;
  play = vi.fn().mockResolvedValue(undefined);
  pause = vi.fn();
  load = vi.fn();
  add(option: { value: string }) {
    this.value ||= option.value;
  }
  click() {
    if (this.disabled) return;
    this.dispatch('click');
    this.onclick?.();
  }
}

async function mountTestPage() {
  const elements = new Map<string, StudioControl>();
  const anchor = new StudioControl('a');
  const root = {
    innerHTML: '',
    querySelector(selector: string) {
      const id = selector.slice(1);
      if (!this.innerHTML.includes(`id="${id}"`)) return null;
      if (!elements.has(id)) elements.set(id, new StudioControl());
      return elements.get(id);
    },
  };
  const pageWindow = new EventTarget();
  vi.stubGlobal('window', pageWindow);
  vi.stubGlobal('document', {
    createElement: (tag: string) => (tag === 'a' ? anchor : new StudioControl(tag)),
  });
  vi.stubGlobal(
    'Option',
    class {
      constructor(
        readonly label: string,
        readonly value: string,
      ) {}
    },
  );
  vi.spyOn(api, 'getStudioCatalog').mockResolvedValue({
    errors: [],
    lines: [
      {
        id: 'line',
        revision: 'current',
        requested: true,
        state: 'needs-pickup',
        speaker: 'Pat',
        text: 'New words',
        location: 'a:1',
        context: [],
        takes: [
          {
            id: 'take',
            revision: 'older',
            speaker: 'Pat',
            text: 'Old words',
            favorite: false,
            createdAt: '2026-01-01',
            roomToneId: null,
            edits: { gainDb: 0, profileId: null },
          },
        ],
      },
    ],
  });
  vi.mocked(confirmModal).mockReset().mockResolvedValue(false);
  const unmount = mountVoiceStudio(root as unknown as HTMLElement);
  function getControl(id: string): StudioControl {
    const control = root.querySelector(`#voice-${id}`);
    if (!control) throw Error(`Missing ${id}`);
    return control;
  }
  function checkTabLeave(): boolean {
    const event = new Event('beforeunload', { cancelable: true });
    Object.defineProperty(event, 'returnValue', { value: true, writable: true });
    return pageWindow.dispatchEvent(event);
  }
  await vi.waitFor(() => expect(getControl('refresh').disabled).toBe(false));
  return { getControl, checkTabLeave, unmount, anchor };
}

function createGate() {
  let finish!: () => void;
  const pending = new Promise<void>((resolve) => {
    finish = resolve;
  });
  return { pending, finish };
}

afterEach(() => {
  setDirtyGuard(null);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('guards both route and tab leaves from the publish click through the response, even after approval clears the draft', async () => {
  const { getControl, checkTabLeave, unmount } = await mountTestPage();
  const confirmation = createGate(),
    publishing = createGate();
  vi.mocked(confirmModal).mockImplementationOnce(async () => {
    await confirmation.pending;
    return true;
  });
  vi.spyOn(api, 'publishTake').mockImplementation(
    async (_line, _take, _edits, _older, _signal, _expected, approved) => {
      approved?.({
        takeId: _take.id,
        lineId: _line.id,
        revision: _line.revision,
        edits: { gainDb: _edits.gainDb, cleanup: null },
        confirmedOlderTake: true,
      });
      await publishing.pending;
    },
  );
  const gain = getControl('gain');
  gain.value = '2';
  gain.oninput?.();
  getControl('publish').click();
  expect(checkTabLeave()).toBe(false);
  expect(await allowLeave()).toBe(false);
  expect(confirmModal).toHaveBeenLastCalledWith(
    expect.stringContaining('interrupts the pending publish'),
    'Leave',
    { focusCancel: true },
  );
  confirmation.finish();
  await vi.waitFor(() => expect(api.publishTake).toHaveBeenCalledOnce());
  expect(checkTabLeave()).toBe(false);
  expect(await allowLeave()).toBe(false);
  expect(vi.mocked(confirmModal).mock.lastCall?.[0]).not.toContain('Unsaved take settings');
  publishing.finish();
  await vi.waitFor(() => expect(getControl('status').textContent).toBe('Approved take published.'));
  expect(checkTabLeave()).toBe(true);
  expect(await allowLeave()).toBe(true);
  unmount();
});

it('can listen and download during a stalled upload, cancel it, and retry the same recording', async () => {
  const { getControl, checkTabLeave, unmount, anchor } = await mountTestPage();
  const original = new Blob(['original'], { type: 'audio/webm' });
  vi.spyOn(VoiceRecorder.prototype, 'captureAudio').mockImplementation(async (prepare, onStart) => {
    await prepare({ label: 'fake microphone', settings: {} }, new AbortController().signal);
    onStart();
    return { blob: original, partial: false };
  });
  vi.spyOn(api, 'startTake').mockResolvedValue('reservation');
  const upload = vi
    .spyOn(api, 'saveRecording')
    .mockImplementationOnce(
      (_kind, _id, _blob, signal) =>
        new Promise((_, reject) => {
          signal?.addEventListener('abort', () => reject(signal.reason));
        }),
    )
    .mockResolvedValueOnce(undefined);
  const urls = vi.spyOn(URL, 'createObjectURL');
  const download = vi.spyOn(anchor, 'click');
  getControl('record').click();
  await vi.waitFor(() => expect(upload).toHaveBeenCalledOnce());
  expect(getControl('cancel-upload').hidden).toBe(false);
  expect(getControl('retry').disabled).toBe(true);
  expect(getControl('discard').disabled).toBe(true);
  getControl('local').click();
  expect(getControl('player').play).toHaveBeenCalledOnce();
  getControl('download').click();
  expect(download).toHaveBeenCalledOnce();
  expect(urls.mock.calls.map(([blob]) => blob)).toEqual([original, original]);
  getControl('cancel-upload').click();
  await vi.waitFor(() => expect(getControl('retry').disabled).toBe(false));
  expect(checkTabLeave()).toBe(false);
  expect(getControl('retry-row').hidden).toBe(false);
  getControl('retry').click();
  await vi.waitFor(() => expect(getControl('retry-row').hidden).toBe(true));
  expect(upload.mock.calls.map(([kind, id, blob]) => [kind, id, blob])).toEqual([
    ['take', 'reservation', original],
    ['take', 'reservation', original],
  ]);
  expect(checkTabLeave()).toBe(true);
  unmount();
});
