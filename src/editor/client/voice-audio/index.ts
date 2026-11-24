import type { VoiceRenderResult } from './render.js';
import { maxRoomToneSeconds, maxVoiceTakeSeconds, voiceSampleRate } from './settings.js';

export {
  getVoiceCaptureConstraints,
  getVoiceCaptureSettings,
  getVoiceRecorderOptions,
} from './capture.js';
export {
  getVoiceCleanupSettings,
  voiceCleanupAlgorithmVersion,
  voiceCleanupStrengthDb,
  maxVoiceTakeSeconds,
} from './settings.js';

export interface VoiceRenderOptions {
  /** Omit for bypass; the persisted profile ID identifies this exact room-tone blob. */
  roomTone?: Blob;
  clipGainDb?: number;
  signal?: AbortSignal;
}

async function decodeVoiceBlob(
  context: OfflineAudioContext,
  blob: Blob,
  maxSeconds: number,
  signal?: AbortSignal,
) {
  signal?.throwIfAborted();
  if (!blob.size || blob.size > 16 * 1024 * 1024)
    throw new Error('Expected a recording of at most 16 MiB.');
  const buffer = await context.decodeAudioData(await blob.arrayBuffer());
  signal?.throwIfAborted();
  if (!buffer.length || buffer.length > maxSeconds * voiceSampleRate) {
    throw new Error(`Expected non-empty audio of at most ${maxSeconds} seconds.`);
  }
  // decodeAudioData resamples to the context rate. Average channels from the
  // same capture device before estimating power or comparing mono dialogue.
  const mono = new Float32Array(buffer.length);
  if (buffer.numberOfChannels === 1) {
    buffer.copyFromChannel(mono, 0);
    return mono;
  }
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const channel = buffer.getChannelData(ch);
    for (let i = 0; i < mono.length; i++) mono[i] += channel[i] / buffer.numberOfChannels;
  }
  return mono;
}

async function runVoiceRender(take: Blob, options: VoiceRenderOptions, comparison: boolean) {
  const { roomTone, signal, clipGainDb = 0 } = options;
  signal?.throwIfAborted();
  const context = new OfflineAudioContext(1, 1, voiceSampleRate);
  const [samples, noise] = await Promise.all([
    decodeVoiceBlob(context, take, maxVoiceTakeSeconds, signal),
    roomTone ? decodeVoiceBlob(context, roomTone, maxRoomToneSeconds, signal) : undefined,
  ]);
  signal?.throwIfAborted();
  const worker = new Worker(new URL('./render.worker.ts', import.meta.url), { type: 'module' });
  let handleAbort: (() => void) | undefined;
  try {
    return await new Promise<VoiceRenderResult>((resolve, reject) => {
      handleAbort = () => reject(signal?.reason);
      signal?.addEventListener('abort', handleAbort, { once: true });
      worker.onerror = (event) => reject(new Error(event.message || 'Voice processing failed.'));
      worker.onmessageerror = () => reject(new Error('Could not read processed voice data.'));
      worker.onmessage = ({ data }: MessageEvent<VoiceRenderResult | { error: string }>) => {
        if ('error' in data) reject(new Error(data.error));
        else resolve(data);
      };
      worker.postMessage(
        { take: samples, roomTone: noise, clipGainDb, comparison },
        noise ? [samples.buffer, noise.buffer] : [samples.buffer],
      );
    });
  } finally {
    if (handleAbort) signal?.removeEventListener('abort', handleAbort);
    worker.terminate();
  }
}

/** Both blobs are disposable comparison audio. The source take stays untouched. */
export async function previewVoiceTake(take: Blob, options: VoiceRenderOptions = {}) {
  const result = await runVoiceRender(take, options, true);
  if (!result.original) throw new Error('Voice comparison is missing the original.');
  return {
    original: new Blob([result.original], { type: 'audio/wav' }),
    cleaned: new Blob([result.rendered], { type: 'audio/wav' }),
  };
}

/** Publish this bounded mono PCM16 WAV. Comparison gain is never baked in. */
export async function renderVoiceTake(take: Blob, options: VoiceRenderOptions = {}) {
  const result = await runVoiceRender(take, options, false);
  return new Blob([result.rendered], { type: 'audio/wav' });
}
