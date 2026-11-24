import { applyRoomToneCleanup } from './cleanup.js';
import { maxRoomToneSeconds, maxVoiceTakeSeconds, voiceSampleRate } from './settings.js';

export interface VoiceRenderRequest {
  take: Float32Array;
  roomTone?: Float32Array;
  clipGainDb: number;
  comparison: boolean;
}

export interface VoiceRenderResult {
  rendered: ArrayBuffer;
  original?: ArrayBuffer;
}

function validateSamples(samples: Float32Array, seconds: number) {
  if (!samples.length || samples.length > seconds * voiceSampleRate) {
    throw new Error(`Expected non-empty audio of at most ${seconds} seconds.`);
  }
  for (const sample of samples) {
    if (!Number.isFinite(sample)) throw new Error('Audio contains invalid samples.');
  }
}

function applyClipGain(samples: Float32Array, gain: number) {
  return samples.map((sample) => Math.min(1, Math.max(-1, sample * gain)));
}

function getComparisonGains(original: Float32Array, rendered: Float32Array, noisePower: number) {
  const frame = voiceSampleRate / 50;
  const powers: number[] = [];
  let originalPeak = 0;
  let renderedPeak = 0;
  for (let start = 0; start < original.length; start += frame) {
    const end = Math.min(start + frame, original.length);
    let power = 0;
    for (let i = start; i < end; i++) {
      power += original[i] ** 2;
      originalPeak = Math.max(originalPeak, Math.abs(original[i]));
      renderedPeak = Math.max(renderedPeak, Math.abs(rendered[i]));
    }
    powers.push(power / (end - start));
  }
  // Measure both sides on the *same* speech-active frames. Don't match on
  // pauses (or room tone alone), which would undo the audible noise reduction.
  const sorted = [...powers].sort((a, b) => a - b);
  const threshold = Math.max(sorted[Math.floor(sorted.length * 0.8)] / 4, noisePower * 2, 1e-12);
  let before = 0;
  let after = 0;
  for (let n = 0; n < powers.length; n++) {
    if (powers[n] < threshold) continue;
    const end = Math.min((n + 1) * frame, original.length);
    before += powers[n] * (end - n * frame);
    for (let i = n * frame; i < end; i++) after += rendered[i] ** 2;
  }
  const ratio = before && after ? Math.sqrt(after / before) : 1;
  const originalGain = Math.min(1, ratio);
  const renderedGain = Math.min(1, 1 / ratio);
  // Decoded float PCM can exceed full scale. Leave 1 dB of sample-peak
  // headroom on both monitors without changing their relative levels.
  const ceiling = 10 ** (-1 / 20);
  const peak = Math.max(originalPeak * originalGain, renderedPeak * renderedGain);
  const headroom = peak > ceiling ? ceiling / peak : 1;
  return { original: originalGain * headroom, rendered: renderedGain * headroom };
}

function encodePcmWav(samples: Float32Array, gain = 1) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  function writeTag(offset: number, value: string) {
    for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
  }
  writeTag(0, 'RIFF');
  view.setUint32(4, buffer.byteLength - 8, true);
  writeTag(8, 'WAVE');
  writeTag(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, voiceSampleRate, true);
  view.setUint32(28, voiceSampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeTag(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const value = samples[i] * gain;
    view.setInt16(44 + 2 * i, Math.round(value * (value < 0 ? 32768 : 32767)), true);
  }
  return buffer;
}

export function renderVoicePcm(request: VoiceRenderRequest): VoiceRenderResult {
  const { take, roomTone, clipGainDb, comparison } = request;
  validateSamples(take, maxVoiceTakeSeconds);
  if (!Number.isFinite(clipGainDb) || Math.abs(clipGainDb) > 24) {
    throw new Error('Voice clip gain must be between -24 and +24 dB.');
  }
  if (roomTone) validateSamples(roomTone, maxRoomToneSeconds);
  const gain = 10 ** (clipGainDb / 20);
  const processed = applyClipGain(roomTone ? applyRoomToneCleanup(take, roomTone) : take, gain);
  if (!comparison) return { rendered: encodePcmWav(processed) };
  // The reference never passes through the clip gain or its limiter. Compare
  // the raw take with exactly the processed waveform that publishing encodes.
  const noisePower = roomTone ? roomTone.reduce((sum, x) => sum + x * x, 0) / roomTone.length : 0;
  const gains = getComparisonGains(take, processed, noisePower);
  return {
    rendered: encodePcmWav(processed, gains.rendered),
    original: encodePcmWav(take, gains.original),
  };
}
