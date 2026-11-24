import { voiceCleanupStrengthDb } from './settings.js';

// At 48 kHz, a window covers ~21 ms. Adjacent sqrt-Hann windows overlap
// by half: their squared weights sum to one during reconstruction.
const size = 1024;
const hop = size / 2;
const bins = hop + 1;
const minimumGain = 10 ** (-voiceCleanupStrengthDb / 20);
const window = Float64Array.from({ length: size }, (_, i) => Math.sin((Math.PI * i) / size));
const cosine = Float64Array.from({ length: hop }, (_, i) => Math.cos((2 * Math.PI * i) / size));
const sine = Float64Array.from({ length: hop }, (_, i) => Math.sin((2 * Math.PI * i) / size));
const reversed = Uint16Array.from({ length: size }, (_, i) => {
  let result = 0;
  for (let bit = 1; bit < size; bit *= 2) result = 2 * result + Number((i & bit) !== 0);
  return result;
});

function applyFft(real: Float64Array, imag: Float64Array, inverse = false): void {
  for (let i = 0; i < size; i++) {
    const j = reversed[i];
    if (j <= i) continue;
    [real[i], real[j]] = [real[j], real[i]];
    [imag[i], imag[j]] = [imag[j], imag[i]];
  }
  for (let width = 2; width <= size; width *= 2) {
    const half = width / 2;
    for (let offset = 0; offset < size; offset += width) {
      for (let k = 0; k < half; k++) {
        const a = offset + k;
        const b = a + half;
        const index = (k * size) / width;
        const c = cosine[index];
        const s = inverse ? sine[index] : -sine[index];
        const r = real[b] * c - imag[b] * s;
        const im = real[b] * s + imag[b] * c;
        real[b] = real[a] - r;
        imag[b] = imag[a] - im;
        real[a] += r;
        imag[a] += im;
      }
    }
  }
  // The inverse scale is folded into overlap-add below.
}

function readSpectrum(
  samples: Float32Array,
  start: number,
  real: Float64Array,
  imag: Float64Array,
) {
  for (let i = 0; i < size; i++) real[i] = (samples[start + i] ?? 0) * window[i];
  imag.fill(0);
  applyFft(real, imag);
}

function getNoisePower(roomTone: Float32Array) {
  if (roomTone.length < size) throw new Error('Room tone is too short to learn a noise profile.');
  const frames = 1 + Math.floor((roomTone.length - size) / hop);
  const powers = new Float64Array(bins * frames);
  const real = new Float64Array(size);
  const imag = new Float64Array(size);
  for (let frame = 0; frame < frames; frame++) {
    readSpectrum(roomTone, frame * hop, real, imag);
    for (let k = 0; k < bins; k++) powers[k * frames + frame] = real[k] ** 2 + imag[k] ** 2;
  }
  // A brief click in the room sample must not become part of the steady baseline.
  return Float64Array.from({ length: bins }, (_, k) => {
    const history = powers.subarray(k * frames, (k + 1) * frames);
    history.sort();
    return history[Math.floor(frames / 2)];
  });
}

export function applyRoomToneCleanup(samples: Float32Array, roomTone: Float32Array) {
  const noise = getNoisePower(roomTone);
  const output = new Float32Array(samples.length);
  const real = new Float64Array(size);
  const imag = new Float64Array(size);
  const gains = new Float64Array(bins).fill(1);
  for (let start = -hop; start < samples.length; start += hop) {
    readSpectrum(samples, start, real, imag);
    for (let k = 0; k < bins; k++) {
      const power = real[k] ** 2 + imag[k] ** 2;
      const target = Math.sqrt(Math.max(minimumGain ** 2, 1 - noise[k] / Math.max(power, 1e-30)));
      // Recover quickly when speech arrives; ease into reduction between words.
      gains[k] += (target - gains[k]) * (target > gains[k] ? 0.9 : 0.4);
    }
    for (let k = 0; k < bins; k++) {
      const gain = 0.8 * gains[k] + 0.1 * ((gains[k - 1] ?? gains[k]) + (gains[k + 1] ?? gains[k]));
      real[k] *= gain;
      imag[k] *= gain;
      if (k !== 0 && k !== hop) {
        real[size - k] *= gain;
        imag[size - k] *= gain;
      }
    }
    applyFft(real, imag, true);
    for (let i = Math.max(0, -start); i < Math.min(size, samples.length - start); i++) {
      output[start + i] += (real[i] * window[i]) / size;
    }
  }
  return output;
}
