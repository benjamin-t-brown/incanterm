import { expect, it } from 'vitest';
import { TerminalScreen } from '../../client/terminal-screen.js';
import { parseRpgScript } from '../../game/rpgscript/__tests__/test-support.js';
import { Scene } from '../../game/scene.js';
import { getPlainText } from '../../game/terminal.js';
import { createGameSession } from '../game-session.js';

function createToastSession(source: string) {
  const clear = { ch: ' ', fg: { r: 255, g: 255, b: 255 }, bg: { r: 0, g: 0, b: 0 } };
  const scene = new Scene('room', 10, 10, 'regular-z', clear, [], ['entry']);
  const screen = new TerminalScreen();
  const scripts = parseRpgScript(`#entry\nload,start\n@start\n${source}`, 'toast.rpgscript');
  const session = createGameSession(scene, (text, cols, rows) => screen.apply(text, cols, rows), scripts);
  session.resize(120, 40);
  session.open();
  return { screen, session };
}

it.each([' ', '\r', '\n'])('centers a 40x5 toast and dismisses it with %j', (key) => {
  const { screen, session } = createToastSession('+showCenterToast(Hello there)\n+log(after toast)');
  try {
    const lines = getPlainText(screen.buffer).split('\n');
    expect(lines[17].slice(40, 80)).toBe(`┌${'─'.repeat(38)}┐`);
    expect(lines[19].slice(40, 80)).toBe(`│${' '.repeat(13)}Hello there${' '.repeat(14)}│`);
    expect(screen.buffer.get(60, 19).bg).toEqual({ r: 30, g: 38, b: 46 });
    expect(lines[21].slice(40, 80)).toBe(`└${'─'.repeat(38)}┘`);
    expect(getPlainText(screen.buffer)).not.toContain('after toast');
    session.input(key);
    expect(getPlainText(screen.buffer)).not.toContain('Hello there');
    expect(getPlainText(screen.buffer)).toContain('after toast');
  } finally {
    session.close();
  }
});

it('wraps long messages and dismisses a toast with a click anywhere without clicking the scene', () => {
  const { screen, session } = createToastSession('+showCenterToast("A very long message that wraps onto another line in the center of the box")\n+showCenterToast(Second)');
  try {
    const lines = getPlainText(screen.buffer).split('\n');
    expect(lines.some((line) => line.includes('A very long message'))).toBe(true);
    expect(lines.some((line) => line.includes('another line in the center'))).toBe(true);
    expect(lines.filter((line) => line.includes('│') && line.includes('message'))).toHaveLength(1);
    session.input('\x1b[<0;1;1M');
    expect(getPlainText(screen.buffer)).toContain('Second');
    session.input('\x1b[<0;1;1M');
    expect(getPlainText(screen.buffer)).not.toContain('Second');
  } finally {
    session.close();
  }
});
