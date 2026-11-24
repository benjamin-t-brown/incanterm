import { afterEach, expect, it, vi } from 'vitest';
import { VoiceRecorder } from '../recorder.js';

afterEach(() => vi.unstubAllGlobals());

it('releases a microphone granted after the actor has already left the studio', async () => {
  let grant!: (stream: unknown) => void;
  const stop = vi.fn();
  const permission = new Promise((resolve) => {
    grant = resolve;
  });
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: () => permission } });
  vi.stubGlobal('MediaRecorder', { isTypeSupported: () => true });
  const capture = new VoiceRecorder();
  const reserve = vi.fn();
  const result = capture.captureAudio(reserve, vi.fn(), 1000);
  capture.cancelRecording();
  await expect(result).rejects.toThrow('cancelled');
  grant({ getTracks: () => [{ stop }] });
  await permission;
  expect(stop).toHaveBeenCalledOnce();
  expect(reserve).not.toHaveBeenCalled();
});

it('retains the final bytes delivered after a recorder error as a partial recording', async () => {
  const stop = vi.fn();
  const track = Object.assign(new EventTarget(), { stop, label: 'Test', getSettings: () => ({}) });
  vi.stubGlobal('navigator', {
    mediaDevices: {
      getUserMedia: async () => ({ getAudioTracks: () => [track], getTracks: () => [track] }),
    },
  });
  class PartialRecorder {
    static isTypeSupported() {
      return true;
    }
    mimeType = 'audio/webm';
    onerror!: () => void;
    ondataavailable!: (chunk: { data: Blob }) => void;
    onstop!: () => void;
    start() {
      queueMicrotask(() => {
        this.onerror();
        this.ondataavailable({ data: new Blob(['last words']) });
        this.onstop();
      });
    }
  }
  vi.stubGlobal('MediaRecorder', PartialRecorder);
  const result = await new VoiceRecorder().captureAudio(async () => {}, vi.fn(), 1000);
  expect(result.partial).toBe(true);
  expect(await result.blob.text()).toBe('last words');
  expect(stop).toHaveBeenCalledOnce();
});

it('releases an opened microphone when the server rejects a stale reservation', async () => {
  const stop = vi.fn();
  const track = { stop, label: 'Test microphone', getSettings: () => ({ sampleRate: 48_000 }) };
  vi.stubGlobal('navigator', {
    mediaDevices: {
      getUserMedia: async () => ({
        getTracks: () => [track],
        getAudioTracks: () => [track],
      }),
    },
  });
  vi.stubGlobal('MediaRecorder', { isTypeSupported: () => true });
  const onStart = vi.fn();
  await expect(
    new VoiceRecorder().captureAudio(
      async () => {
        throw new Error('Wording changed before recording started.');
      },
      onStart,
      1000,
    ),
  ).rejects.toThrow('Wording changed');
  expect(stop).toHaveBeenCalledOnce();
  expect(onStart).not.toHaveBeenCalled();
});
