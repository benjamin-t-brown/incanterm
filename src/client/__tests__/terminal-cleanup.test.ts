import { expect, it } from 'vitest';
import { formatTerminalError, TERMINAL_RESTORE } from '../terminal-cleanup.js';

it('ends synchronized output and resets mouse, styling, cursor, wrapping and alternate screen', () => {
  expect(TERMINAL_RESTORE).toBe(
    '\x1b[?2026l\x1b[?1000l\x1b[?1006l\x1b[0m\x1b[?25h\x1b[?7h\x1b[?1049l',
  );
});

it('colors terminal errors bright red and resets color afterward', () => {
  expect(formatTerminalError('Game failed')).toBe('\x1b[91mGame failed\x1b[0m');
});
