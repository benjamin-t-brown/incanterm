import { afterEach, expect, it, vi } from 'vitest';
import { TerminalScreen } from '../../client/terminal-screen.js';
import { parseRpgScript } from '../../game/rpgscript/__tests__/test-support.js';
import { Scene } from '../../game/scene.js';
import { createGameSession } from '../game-session.js';

afterEach(() => vi.useRealTimers());

it('shows black on setConv and between dialogue lines while script commands run', () => {
  vi.useFakeTimers();
  const clear = { ch: ' ', fg: { r: 255, g: 255, b: 255 }, bg: { r: 0, g: 0, b: 0 } };
  const scripts = parseRpgScript(
    '#entry\nload,start\n@start\n+setConv()\n+waitMs(100)\nGuide: "Hello"\n+waitMs(100)\nGuide: "Again"\n+endConv()',
    'empty-dialogue.rpgscript',
  );
  const screen = new TerminalScreen();
  const session = createGameSession(new Scene('room', 1, 1, 'regular-z', clear, [], ['entry']),
    (text, cols, rows) => screen.apply(text, cols, rows), scripts,
    undefined, undefined, undefined, undefined, undefined, { enabled: false });
  session.resize(120, 40);
  try {
    session.open();
    expect(screen.buffer.get(10, 27).bg).toEqual({ r: 0, g: 0, b: 0 });
    vi.advanceTimersByTime(136);
    expect(screen.buffer.get(10, 27).bg).toEqual({ r: 16, g: 25, b: 20 });
    session.input(' ');
    expect(screen.buffer.get(10, 27).bg).toEqual({ r: 0, g: 0, b: 0 });
    vi.advanceTimersByTime(136);
    expect(screen.buffer.get(10, 27).bg).toEqual({ r: 16, g: 25, b: 20 });
  } finally {
    session.close();
  }
});
