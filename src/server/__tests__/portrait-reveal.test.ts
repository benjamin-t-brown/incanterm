import { afterEach, expect, it, vi } from 'vitest';
import { TerminalScreen } from '../../client/terminal-screen.js';
import type { PortraitAsset, PortraitAssets } from '../../game/portrait-assets.js';
import { parseRpgScript } from '../../game/rpgscript/__tests__/test-support.js';
import { Scene } from '../../game/scene.js';
import { createGameSession } from '../game-session.js';

afterEach(() => vi.useRealTimers());

it.each([false, true])('replays the entrance when setConv opens a new conversation (paired: %s)', (paired) => {
  vi.useFakeTimers();
  const clear = { ch: ' ', fg: { r: 255, g: 255, b: 255 }, bg: { r: 0, g: 0, b: 0 } };
  const asset: PortraitAsset = {
    width: 1, height: 1, loop: false,
    frames: [{ width: 1, height: 1, durationMs: 100, cells: [{ ...clear, ch: 'P' }] }],
  };
  const portraits: PortraitAssets = Object.assign(new Map([['face', asset]]), {
    characters: new Map([['Guide', { id: 'guide', scriptName: 'Guide', portraits: [
      { facing: 'right' as const, emotion: '', portrait: 'face' },
    ] }]]),
  });
  const openConversation = paired ? '+setConv2(Guide, Other)' : '+setConv()';
  const scripts = parseRpgScript(`#entry\nload,start\n@start\n${openConversation}\n+playDialogue(Guide, "First")\n+endConv()\n${openConversation}\n+playDialogue(Guide, "Second")\n+endConv()`, 'reopen.rpgscript');
  const screen = new TerminalScreen();
  const session = createGameSession(new Scene('room', 1, 1, 'regular-z', clear, [], ['entry']),
    (text, cols, rows) => screen.apply(text, cols, rows), scripts, portraits,
    undefined, undefined, undefined, undefined, { enabled: false });
  session.resize(120, 40);
  try {
    session.open();
    const rect = session.getPortraitScreenRect('left');
    if (!rect) throw new Error('Missing portrait');
    expect(screen.buffer.get(rect.x, rect.y).ch).toBe('.');
    session.input(' ');
    expect(screen.buffer.get(rect.x, rect.y).ch).toBe('P');
    session.input(' '); // Close and reopen without an intermediate paint.
    expect(screen.buffer.get(rect.x, rect.y).ch).toBe('.');
    vi.advanceTimersByTime(170);
    expect(screen.buffer.get(rect.x, rect.y).ch).toBe('P');
  } finally {
    session.close();
  }
});

it.each([false, true])('swaps visible portrait emotions immediately (paired: %s)', (paired) => {
  vi.useFakeTimers();
  const clear = { ch: ' ', fg: { r: 255, g: 255, b: 255 }, bg: { r: 0, g: 0, b: 0 } };
  const createPortrait = (ch: string): PortraitAsset => ({
    width: 1, height: 1, loop: false,
    frames: [{ width: 1, height: 1, durationMs: 100, cells: [{ ...clear, ch }] }],
  });
  const portraits: PortraitAssets = Object.assign(new Map([
    ['default', createPortrait('D')], ['happy', createPortrait('H')],
  ]), { characters: new Map([
    ['Guide', { id: 'guide', scriptName: 'Guide', portraits: [
      { facing: paired ? 'left' as const : 'right' as const, emotion: '', portrait: 'default' },
      { facing: paired ? 'left' as const : 'right' as const, emotion: 'happy', portrait: 'happy' },
    ] }],
  ]) });
  const scripts = parseRpgScript(`#entry\nload,start\n@start\n${paired ? '+setConv2(Other, Guide)' : '+setConv()'}\nGuide: "Hi"\nGuide&happy: "Happy"\nGuide: "Default"\n+endConv()`, 'emotion.rpgscript');
  const screen = new TerminalScreen();
  const session = createGameSession(new Scene('room', 1, 1, 'regular-z', clear, [], ['entry']),
    (text, cols, rows) => screen.apply(text, cols, rows), scripts, portraits,
    undefined, undefined, undefined, undefined, { enabled: false });
  session.resize(120, 40);
  try {
    session.open();
    const rect = session.getPortraitScreenRect(paired ? 'right' : 'left');
    if (!rect) throw new Error('Missing portrait');
    expect(screen.buffer.get(rect.x, rect.y).ch).toBe('.');
    session.input(' '); // Finish the initial entrance.
    expect(screen.buffer.get(rect.x, rect.y).ch).toBe('D');
    session.input(' ');
    expect(screen.buffer.get(rect.x, rect.y).ch).toBe('H');
    session.input(' ');
    expect(screen.buffer.get(rect.x, rect.y).ch).toBe('D');
  } finally {
    session.close();
  }
});

it('reveals both portraits simultaneously and keeps inactive portraits grey across speaker changes', () => {
  vi.useFakeTimers();
  vi.spyOn(Math, 'random').mockReturnValue(0);
  const clear = { ch: ' ', fg: { r: 255, g: 255, b: 255 }, bg: { r: 0, g: 0, b: 0 } };
  const createPortrait = (ch: string): PortraitAsset => ({
    width: 2, height: 2, loop: false,
    frames: [{ width: 2, height: 2, durationMs: 100, cells: Array.from({ length: 4 }, () => ({ ...clear, ch })) }],
  });
  const portraits: PortraitAssets = Object.assign(new Map([
    ['left', createPortrait('A')], ['right', createPortrait('B')],
  ]), { characters: new Map([
    ['A', { id: 'a', scriptName: 'A', portraits: [{ facing: 'right' as const, emotion: '', portrait: 'left' }] }],
    ['B', { id: 'b', scriptName: 'B', portraits: [{ facing: 'left' as const, emotion: '', portrait: 'right' }] }],
  ]) });
  const scripts = parseRpgScript('#entry\nload,start\n@start\n+setConv2(A, B)\nA: "Hello"\nB: "Next"\n+endConv()', 'portraits.rpgscript');
  const screen = new TerminalScreen();
  const session = createGameSession(new Scene('room', 1, 1, 'regular-z', clear, [], ['entry']),
    (text, cols, rows) => screen.apply(text, cols, rows), scripts, portraits,
    undefined, undefined, undefined, undefined,
    { stepDurationMs: 80, growthSequences: ['1234'], shortGrowthSequences: ['abcd'] },
    { stepDurationMs: 34, rowDelayMs: 8.5 });
  session.resize(120, 40);
  try {
    session.open();
    const left = session.getPortraitScreenRect('left');
    const right = session.getPortraitScreenRect('right');
    expect(left).toBeDefined();
    expect(right).toBeDefined();
    if (!left || !right) throw new Error('Missing portrait');
    for (const rect of [left, right]) {
      expect(screen.buffer.get(rect.x, rect.y).ch).toBe('.');
      expect(screen.buffer.get(rect.x + 1, rect.y).ch).toBe('.');
      expect(screen.buffer.get(rect.x, rect.y + 1).ch).toBe(' ');
      expect(screen.buffer.get(rect.x, rect.y).fg).toEqual({ r: 128, g: 128, b: 128 });
    }
    vi.advanceTimersByTime(34);
    expect(screen.buffer.get(left.x, left.y).ch).toBe(',');
    expect(screen.buffer.get(right.x, right.y).ch).toBe(',');
    expect(screen.buffer.get(left.x, left.y + 1).ch).toBe('.');
    expect(screen.buffer.get(right.x, right.y + 1).ch).toBe('.');
    vi.advanceTimersByTime(34);
    expect(screen.buffer.get(left.x, left.y).ch).toBe(':');
    expect(screen.buffer.get(right.x, right.y).ch).toBe(':');
    vi.advanceTimersByTime(34);
    expect(screen.buffer.get(left.x, left.y).ch).toBe('+');
    expect(screen.buffer.get(right.x, right.y).ch).toBe('+');
    vi.advanceTimersByTime(34);
    expect(screen.buffer.get(left.x, left.y)).toEqual({ ...clear, ch: 'A' });
    expect(screen.buffer.get(right.x, right.y)).toEqual({ ...clear, ch: 'B', fg: { r: 128, g: 128, b: 128 } });
    expect(screen.buffer.get(left.x, left.y + 1).ch).toBe('+');
    session.input(' '); // The longer dialogue and last portrait row are still growing; finish both.
    expect(screen.buffer.get(left.x, left.y + 1).ch).toBe('A');
    expect(screen.buffer.get(right.x, right.y).fg).toEqual({ r: 128, g: 128, b: 128 });
    session.input(' ');
    session.input(' '); // Finish the new line's dialogue (portrait reveal does not restart).
    expect(screen.buffer.get(left.x, left.y)).toEqual({ ...clear, ch: 'A', fg: { r: 128, g: 128, b: 128 } });
    expect(screen.buffer.get(right.x, right.y)).toEqual({ ...clear, ch: 'B' });
  } finally {
    session.close();
    vi.restoreAllMocks();
  }
});

it('finishes the portrait reveal with the dialogue on the first advance input', () => {
  vi.useFakeTimers();
  vi.spyOn(Math, 'random').mockReturnValue(0);
  const clear = { ch: ' ', fg: { r: 255, g: 255, b: 255 }, bg: { r: 0, g: 0, b: 0 } };
  const asset: PortraitAsset = {
    width: 1, height: 1, loop: false,
    frames: [{ width: 1, height: 1, durationMs: 100, cells: [{ ...clear, ch: 'P' }] }],
  };
  const portraits: PortraitAssets = Object.assign(new Map([['face', asset]]), {
    characters: new Map([['Guide', { id: 'guide', scriptName: 'Guide', portraits: [
      { facing: 'right' as const, emotion: '', portrait: 'face' },
    ] }]]),
  });
  const scripts = parseRpgScript('#entry\nload,start\n@start\n+setConv()\nGuide: "Hi"\n+endConv()', 'portraits.rpgscript');
  const screen = new TerminalScreen();
  const session = createGameSession(new Scene('room', 1, 1, 'regular-z', clear, [], ['entry']),
    (text, cols, rows) => screen.apply(text, cols, rows), scripts, portraits,
    undefined, undefined, undefined, undefined, { enabled: false }, { stepDurationMs: 25, rowDelayMs: 6.25 });
  session.resize(120, 40);
  try {
    session.open();
    const rect = session.getPortraitScreenRect();
    if (!rect) throw new Error('Missing portrait');
    expect(screen.buffer.get(rect.x, rect.y).ch).toBe('.');
    session.input(' ');
    expect(screen.buffer.get(rect.x, rect.y).ch).toBe('P');
    expect(session.getPortraitScreenRect()).toEqual(rect);
    session.input(' ');
    expect(session.getPortraitScreenRect()).toEqual(rect);
    expect(screen.buffer.get(rect.x, rect.y).ch).toBe('+');
    vi.advanceTimersByTime(34);
    expect(screen.buffer.get(rect.x, rect.y).ch).toBe(':');
    vi.advanceTimersByTime(34);
    expect(screen.buffer.get(rect.x, rect.y).ch).toBe(',');
    vi.advanceTimersByTime(34);
    expect(screen.buffer.get(rect.x, rect.y).ch).toBe(' ');
    vi.advanceTimersByTime(34);
    expect(session.getPortraitScreenRect()).toBeUndefined();
  } finally {
    session.close();
    vi.restoreAllMocks();
  }
});

it('animates both portraits out from bottom to top after endConv without losing the right portrait', () => {
  vi.useFakeTimers();
  const clear = { ch: ' ', fg: { r: 255, g: 255, b: 255 }, bg: { r: 0, g: 0, b: 0 } };
  const createPortrait = (ch: string): PortraitAsset => ({
    width: 1, height: 2, loop: false,
    frames: [{ width: 1, height: 2, durationMs: 100, cells: [{ ...clear, ch }, { ...clear, ch }] }],
  });
  const portraits: PortraitAssets = Object.assign(new Map([
    ['left', createPortrait('A')], ['right', createPortrait('B')],
  ]), { characters: new Map([
    ['A', { id: 'a', scriptName: 'A', portraits: [{ facing: 'right' as const, emotion: '', portrait: 'left' }] }],
    ['B', { id: 'b', scriptName: 'B', portraits: [{ facing: 'left' as const, emotion: '', portrait: 'right' }] }],
  ]) });
  const scripts = parseRpgScript('#entry\nload,start\n@start\n+setConv2(A, B)\nA: "Hi"\n+endConv()', 'portraits.rpgscript');
  const screen = new TerminalScreen();
  const session = createGameSession(new Scene('room', 1, 1, 'regular-z', clear, [], ['entry']),
    (text, cols, rows) => screen.apply(text, cols, rows), scripts, portraits,
    undefined, undefined, undefined, undefined, { enabled: false },
    { stepDurationMs: 25, rowDelayMs: 10 });
  session.resize(120, 40);
  try {
    session.open();
    session.input(' '); // Finish the reveal.
    const left = session.getPortraitScreenRect('left');
    const right = session.getPortraitScreenRect('right');
    if (!left || !right) throw new Error('Missing portraits');
    session.input(' '); // endConv.
    for (const rect of [left, right]) {
      expect(session.getPortraitScreenRect(rect === left ? 'left' : 'right')).toEqual(rect);
      expect(screen.buffer.get(rect.x, rect.y).ch).toMatch(/[AB]/);
      expect(screen.buffer.get(rect.x, rect.y + 1).ch).toBe('+');
    }
    vi.advanceTimersByTime(34);
    expect(screen.buffer.get(left.x, left.y).ch).toBe('+');
    expect(screen.buffer.get(left.x, left.y + 1).ch).toBe(':');
    expect(screen.buffer.get(right.x, right.y + 1).ch).toBe(':');
    vi.advanceTimersByTime(102);
    expect(session.getPortraitScreenRect('left')).toBeUndefined();
    expect(session.getPortraitScreenRect('right')).toBeUndefined();
  } finally {
    session.close();
  }
});

it('does not leave a portrait behind when endConv has no portrait', () => {
  vi.useFakeTimers();
  const clear = { ch: ' ', fg: { r: 255, g: 255, b: 255 }, bg: { r: 0, g: 0, b: 0 } };
  const scripts = parseRpgScript('#entry\nload,start\n@start\n+setConv()\nGuide: "Hi"\n+endConv()', 'no-portrait.rpgscript');
  const session = createGameSession(new Scene('room', 1, 1, 'regular-z', clear, [], ['entry']),
    () => {}, scripts, undefined, undefined, undefined, undefined, undefined,
    { enabled: false });
  session.resize(120, 40);
  try {
    session.open();
    session.input(' ');
    expect(session.getPortraitScreenRect()).toBeUndefined();
    vi.advanceTimersByTime(200);
    expect(session.getPortraitScreenRect()).toBeUndefined();
  } finally {
    session.close();
  }
});
