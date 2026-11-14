import { afterEach, expect, it, vi } from 'vitest';
import { TerminalScreen } from '../../client/terminal-screen.js';
import { parseRpgScript } from '../../game/rpgscript/__tests__/test-support.js';
import { Scene } from '../../game/scene.js';
import { getPlainText } from '../../game/terminal.js';
import { createGameSession } from '../game-session.js';

afterEach(() => vi.useRealTimers());

it('resolves on the first click, advances on the second, and starts the next line anew', () => {
  vi.useFakeTimers();
  const clear = { ch: ' ', fg: { r: 255, g: 255, b: 255 }, bg: { r: 0, g: 0, b: 0 } };
  const scripts = parseRpgScript('#entry\nload,start\n@start\nGuide: "First"\nGuide: "Second"', 'test.rpgscript');
  const screen = new TerminalScreen();
  const session = createGameSession(new Scene('room', 1, 1, 'regular-z', clear, [], ['entry']),
    (text, cols, rows) => screen.apply(text, cols, rows), scripts);
  session.resize(80, 24);
  try {
    session.open();
    expect(getPlainText(screen.buffer)).not.toContain('First');
    session.input('\x1b[<0;1;1M');
    expect(getPlainText(screen.buffer)).toContain('First');
    expect(getPlainText(screen.buffer)).not.toContain('Second');
    session.input(' ');
    expect(getPlainText(screen.buffer)).not.toContain('Second');
    session.input('\r');
    expect(getPlainText(screen.buffer)).toContain('Second');
    session.input('\n');
    expect(getPlainText(screen.buffer)).not.toContain('[Space/Enter]');
  } finally {
    session.close();
  }
});

it('completes on its own at configurable speed and can be disabled', () => {
  vi.useFakeTimers();
  const clear = { ch: ' ', fg: { r: 255, g: 255, b: 255 }, bg: { r: 0, g: 0, b: 0 } };
  const scripts = parseRpgScript('#entry\nload,start\n@start\nGuide: "Hi there"\nGuide: "Bye"', 'test.rpgscript');
  const screen = new TerminalScreen();
  const scene = new Scene('room', 1, 1, 'regular-z', clear, [], ['entry']);
  const session = createGameSession(scene, (text, cols, rows) => screen.apply(text, cols, rows), scripts,
    undefined, undefined, undefined, undefined, undefined, { stepDurationMs: 10, wordDelayMs: 60 });
  session.resize(80, 24);
  try {
    session.open();
    vi.advanceTimersByTime(34);
    expect(getPlainText(screen.buffer)).not.toContain('Hi there');
    vi.advanceTimersByTime(34);
    expect(getPlainText(screen.buffer)).not.toContain('Hi there');
    vi.advanceTimersByTime(34);
    expect(getPlainText(screen.buffer)).toContain('Hi there');
    session.input(' ');
    expect(getPlainText(screen.buffer)).not.toContain('Bye');
  } finally {
    session.close();
  }
  const instant = createGameSession(scene, (text, cols, rows) => screen.apply(text, cols, rows), scripts,
    undefined, undefined, undefined, undefined, undefined, { enabled: false });
  instant.resize(80, 24);
  try {
    instant.open();
    expect(getPlainText(screen.buffer)).toContain('Hi there');
    instant.input(' ');
    expect(getPlainText(screen.buffer)).toContain('Bye');
  } finally {
    instant.close();
  }
});
