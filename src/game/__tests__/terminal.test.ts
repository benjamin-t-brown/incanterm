import { describe, expect, it } from 'vitest';
import { CellBuffer } from '../cell-buffer.js';
import { encodeTerminal } from '../terminal.js';

const buffer = new CellBuffer(2, 2, {
  ch: 'X',
  fg: { r: 255, g: 255, b: 255 },
  bg: { r: 0, g: 0, b: 0 },
});

describe('terminal frame encoding', () => {
  it('overwrites complete frames without clearing or scrolling after the final row', () => {
    const frame = encodeTerminal(buffer, { clear: false, fullScreen: true });
    expect(frame).toContain('\x1b[H');
    expect(frame).not.toContain('\x1b[2J');
    expect(frame.startsWith('\x1b[?2026h')).toBe(true);
    expect(frame.endsWith('XX\x1b[?7h\x1b[?2026l')).toBe(true);
    expect(frame.match(/\r\n/g)).toHaveLength(1);
    expect(encodeTerminal(buffer)).toContain('\x1b[2J');
  });

  it('preserves line-oriented output for non-screen previews', () => {
    const output = encodeTerminal(buffer, { clear: false });
    expect(output).not.toContain('\x1b[H');
    expect(output).not.toContain('\x1b[?2026');
    expect(output.endsWith('\x1b[0m\r\n')).toBe(true);
  });
});
