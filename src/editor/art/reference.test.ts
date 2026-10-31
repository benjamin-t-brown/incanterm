import { describe, expect, it } from 'vitest';
import {
  createReference,
  detectReferenceImage,
  fitReferenceRect,
  parseReference,
  resizeReferenceRect,
} from './reference.js';

const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

describe('sprite reference', () => {
  it('parses placement and rejects a bad size', () => {
    const value = createReference('crate', 'png', { x: 0, y: 0, width: 8, height: 4 }, 0.55);
    expect(parseReference(value)).toEqual({ ok: true, value });
    expect(parseReference({ ...value, visible: undefined })).toEqual({ ok: true, value });
    expect(parseReference({ ...value, visible: false })).toEqual({
      ok: true,
      value: { ...value, visible: false },
    });
    expect(parseReference({ ...value, width: 0 }).ok).toBe(false);
    expect(parseReference({ ...value, opacity: 2 }).ok).toBe(false);
    expect(parseReference({ ...value, visible: 'yes' }).ok).toBe(false);
  });

  it('detects a png from magic bytes', () => {
    expect(detectReferenceImage(TINY_PNG)).toBe('png');
    expect(detectReferenceImage(Buffer.from('hello'), 'image/png')).toBe('png');
    expect(detectReferenceImage(Buffer.from('hello'))).toBe(null);
  });

  it('fits a wide image to the sprite width', () => {
    const rect = fitReferenceRect(10, 10, 200, 50, 10, 20);
    expect(rect.width).toBeCloseTo(10);
    expect(rect.height).toBeCloseTo(1.25);
    expect(rect.x).toBeCloseTo(0);
    expect(rect.y).toBeCloseTo(4.375);
  });

  it('resizes from the southeast handle and can lock aspect', () => {
    const start = { x: 0, y: 0, width: 4, height: 2 };
    const free = resizeReferenceRect(start, 'se', 8, 8, false);
    expect(free).toEqual({ x: 0, y: 0, width: 8, height: 8 });
    const locked = resizeReferenceRect(start, 'se', 8, 8, true);
    expect(locked.width / locked.height).toBeCloseTo(2);
    expect(locked.x).toBe(0);
    expect(locked.y).toBe(0);
  });
});
