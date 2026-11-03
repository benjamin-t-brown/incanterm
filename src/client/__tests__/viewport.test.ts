import { describe, expect, it } from 'vitest';
import { matchesViewport } from '../viewport.js';

describe('terminal resize frames', () => {
  it('drops late frames from a previous size', () => {
    const viewport = { cols: 40, rows: 16 };
    expect(matchesViewport({ type: 'terminal-data', data: '', cols: 80, rows: 24 }, viewport)).toBe(
      false,
    );
    expect(matchesViewport({ type: 'terminal-data', data: '', cols: 40, rows: 16 }, viewport)).toBe(
      true,
    );
  });

  it('accepts untagged legacy frames and frames without a known viewport', () => {
    expect(matchesViewport({ type: 'terminal-data', data: '' }, { cols: 40, rows: 16 })).toBe(true);
    expect(
      matchesViewport({ type: 'terminal-data', data: '', cols: 80, rows: 24 }, undefined),
    ).toBe(true);
  });
});
