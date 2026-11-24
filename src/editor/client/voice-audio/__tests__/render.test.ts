import { describe, expect, it } from 'vitest';
import { applyRoomToneCleanup } from '../cleanup.js';
import { renderVoicePcm } from '../render.js';
import { voiceSampleRate } from '../settings.js';

function getSine(i: number, hz: number, amplitude: number, phase = 0) {
  return amplitude * Math.sin((i * hz * 2 * Math.PI) / voiceSampleRate + phase);
}

function createClips() {
  // A steady motor tone and a distinct higher-frequency "voiced" interval.
  // Room and take start at different phases, as two separate recordings would.
  const roomTone = Float32Array.from({ length: voiceSampleRate }, (_, i) =>
    getSine(i, 188, 0.05, 1.4),
  );
  const take = Float32Array.from(
    roomTone,
    (_, i) => getSine(i, 188, 0.05) + (i >= 24_000 ? getSine(i, 1750, 0.085) : 0),
  );
  return { roomTone, take };
}

function getRms(samples: Float32Array, start: number, end: number) {
  let sum = 0;
  for (let i = start; i < end; i++) sum += samples[i] ** 2;
  return Math.sqrt(sum / (end - start));
}

function readSamples(wav: ArrayBuffer) {
  const view = new DataView(wav);
  return Float32Array.from({ length: (view.byteLength - 44) / 2 }, (_, i) => {
    const pcm = view.getInt16(44 + 2 * i, true);
    return pcm / (pcm < 0 ? 32768 : 32767);
  });
}

describe('room-tone voice renderer', () => {
  it('reduces steady noise by about 6 dB while preserving a distinct voiced harmonic', () => {
    const { take, roomTone } = createClips();
    const savedTake = take.slice();
    const savedRoom = roomTone.slice();
    const output = applyRoomToneCleanup(take, roomTone);
    const ratio = getRms(output, 6_000, 18_000) / getRms(take, 6_000, 18_000);
    expect(20 * Math.log10(ratio)).toBeGreaterThan(-6.2);
    expect(20 * Math.log10(ratio)).toBeLessThan(-5);
    const projected = output
      .subarray(30_000, 42_000)
      .reduce((sum, sample, n) => sum + sample * getSine(n + 30_000, 1750, 1), 0);
    expect((2 * projected) / 12_000).toBeCloseTo(0.085, 3);
    expect(take).toEqual(savedTake);
    expect(roomTone).toEqual(savedRoom);
  });

  it('reconstructs non-window-aligned first and last samples with a silent profile', () => {
    const samples = Float32Array.from({ length: 1813 }, (_, i) => getSine(i, 437, 0.5, 1));
    const output = applyRoomToneCleanup(samples, new Float32Array(2048));
    expect(output.length).toBe(samples.length);
    const maxError = output.reduce((max, x, i) => Math.max(max, Math.abs(x - samples[i])), 0);
    expect(maxError).toBeLessThan(1e-7);
  });

  it('preserves the input within PCM16 precision on bypass, including the endpoints', () => {
    const take = new Float32Array([1, 0.25, 0, -0.5, -1]);
    const { rendered } = renderVoicePcm({ take, clipGainDb: 0, comparison: false });
    const header = new DataView(rendered);
    expect(header.getUint32(4, true)).toBe(rendered.byteLength - 8);
    expect(header.getUint32(24, true)).toBe(voiceSampleRate);
    expect(header.getUint32(40, true)).toBe(take.length * 2);
    for (const [i, sample] of readSamples(rendered).entries())
      expect(sample).toBeCloseTo(take[i], 4);
    const preview = renderVoicePcm({ take, clipGainDb: 0, comparison: true });
    expect(preview.original).toEqual(preview.rendered);
  });

  it('previews the same cleanup and clip gain as publish, up to monitor attenuation', () => {
    const settings = { ...createClips(), clipGainDb: 12 };
    const preview = readSamples(renderVoicePcm({ ...settings, comparison: true }).rendered);
    const published = readSamples(renderVoicePcm({ ...settings, comparison: false }).rendered);
    const scale = getRms(preview, 0, preview.length) / getRms(published, 0, published.length);
    expect(scale).toBeGreaterThan(0);
    expect(scale).toBeLessThan(1);
    const maxError = preview.reduce(
      (max, x, i) => Math.max(max, Math.abs(x - scale * published[i])),
      0,
    );
    expect(maxError).toBeLessThan(2 / 32767);
  });

  it('exposes +12 dB clipping without cleanup while preserving the original waveform', () => {
    // Resampling a decoded take can produce float peaks above full scale.
    const take = new Float32Array([0.1, 0.3, 0.6, 0.95, 1.1, -0.1, -0.3, -0.6, -0.95, -1.1]);
    const settings = { take, clipGainDb: 12 };
    const published = readSamples(renderVoicePcm({ ...settings, comparison: false }).rendered);
    const preview = renderVoicePcm({ ...settings, comparison: true });
    if (!preview.original) throw new Error('Missing comparison original');
    const before = readSamples(preview.original);
    const after = readSamples(preview.rendered);
    expect([...published.slice(1, 5)]).toEqual([1, 1, 1, 1]);
    expect([...published.slice(6)]).toEqual([-1, -1, -1, -1]);
    expect(getRms(before, 0, take.length)).toBeCloseTo(getRms(after, 0, take.length), 4);
    for (const [monitored, reference] of [
      [before, take],
      [after, published],
    ]) {
      const scale = monitored[4] / reference[4];
      expect(scale).toBeGreaterThan(0);
      expect(scale).toBeLessThan(1);
      for (const [i, x] of monitored.entries()) {
        expect(Math.abs(x)).toBeLessThan(0.892);
        expect(x).toBeCloseTo(scale * reference[i], 4);
      }
    }
  });

  it('matches speech for comparisons only, and applies the selected clip gain after cleanup', () => {
    const clips = createClips();
    const { original, rendered } = renderVoicePcm({ ...clips, clipGainDb: 0, comparison: true });
    if (!original) throw new Error('Missing comparison original');
    const before = readSamples(original);
    const cleaned = readSamples(rendered);
    expect(getRms(before, 30_000, 42_000)).toBeCloseTo(getRms(cleaned, 30_000, 42_000), 3);
    expect(getRms(cleaned, 6_000, 18_000)).toBeLessThan(0.7 * getRms(before, 6_000, 18_000));
    const published = readSamples(
      renderVoicePcm({ ...clips, clipGainDb: 6, comparison: false }).rendered,
    );
    const gain = 10 ** (6 / 20);
    const expected = applyRoomToneCleanup(clips.take, clips.roomTone);
    const maxError = published.reduce(
      (max, x, i) => Math.max(max, Math.abs(x - expected[i] * gain)),
      0,
    );
    expect(maxError).toBeLessThan(1 / 32767);
    expect(getRms(before, 30_000, 42_000)).toBeLessThan(getRms(clips.take, 30_000, 42_000) * 0.97);
  });

  it('rejects empty, nonfinite and oversized inputs before rendering', () => {
    const render = (take: Float32Array, roomTone?: Float32Array) =>
      renderVoicePcm({ take, roomTone, comparison: false, clipGainDb: 0 });
    expect(() => render(new Float32Array(0))).toThrow(/non-empty/);
    expect(() => render(new Float32Array([NaN]))).toThrow(/invalid/);
    expect(() => render(new Float32Array(1), new Float32Array(7 * voiceSampleRate))).toThrow(
      /at most/,
    );
    expect(() => render(new Float32Array(1), new Float32Array(20))).toThrow(/too short/);
  });
});
