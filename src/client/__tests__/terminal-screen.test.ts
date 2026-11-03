import { describe, expect, it } from 'vitest';
import { CellBuffer } from '../../game/cell-buffer.js';
import { encodeTerminal, encodeTerminalDiff } from '../../game/terminal.js';
import { TerminalScreen } from '../terminal-screen.js';

const empty = { ch: ' ', fg: { r: 200, g: 210, b: 220 }, bg: { r: 10, g: 20, b: 30 } };

function expectScreen(screen: TerminalScreen, expected: CellBuffer): void {
  expect(screen.buffer.width).toBe(expected.width);
  expect(screen.buffer.height).toBe(expected.height);
  for (let y = 0; y < expected.height; y++)
    for (let x = 0; x < expected.width; x++)
      expect(screen.buffer.get(x, y)).toEqual(expected.get(x, y));
}

describe('stateful terminal updates', () => {
  it('reconstructs sparse runs, erased cells, color-only changes, and the bottom-right cell', () => {
    const screen = new TerminalScreen();
    const first = new CellBuffer(120, 40, empty);
    first.set(5, 4, { ...empty, ch: '@' });
    screen.apply(encodeTerminalDiff(first), 120, 40);
    expectScreen(screen, first);
    const second = new CellBuffer(120, 40, empty);
    second.set(6, 4, { ...empty, ch: '@' });
    second.set(7, 4, { ...empty, ch: '╬' });
    second.set(50, 4, { ...empty, bg: { r: 99, g: 88, b: 77 } });
    second.set(119, 39, { ...empty, ch: 'Z' });
    const delta = encodeTerminalDiff(second, first);
    expect(delta.length).toBeLessThan(encodeTerminal(second).length / 10);
    expect(delta).not.toContain('\x1b[2J');
    expect(screen.apply(delta, 120, 40)).toEqual(new Set([4, 39]));
    expectScreen(screen, second);
    expect(encodeTerminalDiff(second, second)).toBe('');
  });

  it('accepts a latest-state delta after skipped intermediate frames, then resizes', () => {
    const screen = new TerminalScreen();
    const first = new CellBuffer(10, 5, empty);
    screen.apply(encodeTerminalDiff(first), 10, 5);
    const latest = new CellBuffer(10, 5, empty);
    latest.set(8, 3, { ...empty, ch: 'B' });
    screen.apply(encodeTerminalDiff(latest, first), 10, 5);
    expectScreen(screen, latest);
    const resized = new CellBuffer(6, 2, { ...empty, ch: '.' });
    const frame = encodeTerminalDiff(resized, latest);
    expect(frame).toContain('\x1b[2J');
    screen.apply(frame, 6, 2);
    expectScreen(screen, resized);
    const restored = new TerminalScreen();
    restored.apply(encodeTerminal(screen.buffer), 6, 2);
    expectScreen(restored, resized);
  });
});
