import { afterEach, expect, it, vi } from 'vitest';
import { TerminalScreen } from '../../client/terminal-screen.js';
import type { PortraitAsset, PortraitAssets } from '../../game/portrait-assets.js';
import { parseRpgScript } from '../../game/rpgscript/__tests__/test-support.js';
import { Scene } from '../../game/scene.js';
import { getPlainText } from '../../game/terminal.js';
import { STANDARD_BACKGROUND } from '../../renderer/ui/layout-standard-scene.js';
import { UI_INK } from '../../renderer/ui/standard-ui.js';
import { createGameSession } from '../game-session.js';

const PANEL_LEFT = 20;
const PANEL_TOP = 16;
const PANEL_BOTTOM = 24;

function openChoiceSession(source: string, enabled = true, portraits?: PortraitAssets) {
  const scripts = parseRpgScript(`#entry\nload,start\n@start\n${source}`, 'choice-transition.rpgscript');
  const screen = new TerminalScreen();
  const scene = new Scene('room', 1, 1, 'regular-z', STANDARD_BACKGROUND, [], ['entry']);
  const session = createGameSession(scene, (text, cols, rows) => screen.apply(text, cols, rows), scripts,
    portraits, undefined, undefined, undefined, undefined, { enabled: false }, { enabled });
  session.resize(100, 40);
  session.open();
  return {
    session, getText: () => getPlainText(screen.buffer),
    getCell: (x: number, y: number) => screen.buffer.get(x, y),
    getCellAtText(text: string) {
      const rows = getPlainText(screen.buffer).split('\n');
      const y = rows.findIndex((row) => row.includes(text));
      if (y < 0) throw new Error(`Missing screen text: ${text}`);
      return screen.buffer.get(rows[y].indexOf(text), y);
    },
  };
}

afterEach(() => vi.useRealTimers());

it('grows the panel from top to bottom and shrinks it while the script continues', () => {
  vi.useFakeTimers();
  const { session, getText, getCell } = openChoiceSession(
    '+awaitChoice("Which route?", "Left", "Right")\n+?eq(lastChoiceIndex, 1):Guide: "Taking the right path."',
  );
  try {
    expect(getCell(PANEL_LEFT, PANEL_TOP).ch).toBe('.');
    expect(getCell(PANEL_LEFT, PANEL_BOTTOM).ch).toBe(' ');
    expect(getCell(PANEL_LEFT - 1, PANEL_TOP)).toEqual(STANDARD_BACKGROUND);
    vi.advanceTimersByTime(170);
    expect(getCell(PANEL_LEFT, PANEL_TOP).ch).toBe('┌');
    expect(getCell(PANEL_LEFT, PANEL_BOTTOM).ch).toBe('└');
    expect(getText()).toContain('Which route?');
    expect(getText()).toContain('2. Right');

    session.input('2');
    expect(getText()).toContain('Taking the right path.');
    expect(getCell(PANEL_LEFT, PANEL_TOP).ch).toBe('┌');
    expect(getCell(PANEL_LEFT, PANEL_BOTTOM).ch).toBe('+');
    vi.advanceTimersByTime(34);
    expect(getCell(PANEL_LEFT, PANEL_BOTTOM).ch).toBe(':');
    vi.advanceTimersByTime(136);
    expect(getCell(PANEL_LEFT, PANEL_TOP)).toEqual(STANDARD_BACKGROUND);
    expect(getText()).not.toContain('Which route?');
    expect(getText()).toContain('Taking the right path.');
  } finally {
    session.close();
  }
});

it('restarts the reveal for a replacement prompt and accepts keyboard input during its entrance', () => {
  vi.useFakeTimers();
  const { session, getText, getCell } = openChoiceSession(
    '+awaitChoice("First question?", "Left", "Right")\n+awaitChoice("Second question?", "Up", "Down")\n' +
    '+?eq(lastChoiceIndex, 1):Guide: "Going down."',
  );
  try {
    vi.advanceTimersByTime(170);
    expect(getText()).toContain('First question?');
    session.input('1');
    expect(getCell(PANEL_LEFT, PANEL_TOP).ch).toBe('.');
    expect(getText()).not.toContain('First question?');
    session.input('2');
    expect(getText()).toContain('Going down.');
    vi.advanceTimersByTime(170);
    expect(getCell(PANEL_LEFT, PANEL_TOP)).toEqual(STANDARD_BACKGROUND);
    expect(getText()).not.toContain('Second question?');
  } finally {
    session.close();
  }
});

it('shows and hides choices immediately when the portrait transitions are disabled', () => {
  vi.useFakeTimers();
  const { session, getText, getCell } = openChoiceSession('+awaitChoice("Which route?", "Left", "Right")', false);
  try {
    expect(getText()).toContain('2. Right');
    expect(getCell(PANEL_LEFT, PANEL_TOP).ch).toBe('┌');
    session.input('2');
    expect(getCell(PANEL_LEFT, PANEL_TOP)).toEqual(STANDARD_BACKGROUND);
  } finally {
    session.close();
  }
});

it('desaturates the conversation and portraits, but not the choices that overlap them', () => {
  vi.useFakeTimers();
  const coloredPortraitCell = { ch: 'P', fg: { r: 255, g: 0, b: 0 }, bg: { r: 0, g: 255, b: 0 } };
  const face: PortraitAsset = {
    width: 3, height: 20, loop: false,
    frames: [{ width: 3, height: 20, durationMs: 100, cells: Array(60).fill(coloredPortraitCell) }],
  };
  const portraits: PortraitAssets = Object.assign(new Map([['face', face]]), {
    characters: new Map([
      ['Guide', { id: 'guide', scriptName: 'Guide', portraits: [{ facing: 'right' as const, emotion: '', portrait: 'face' }] }],
      ['Other', { id: 'other', scriptName: 'Other', portraits: [{ facing: 'left' as const, emotion: '', portrait: 'face' }] }],
    ]),
  });
  const { session, getText, getCell, getCellAtText } = openChoiceSession(
    '+setConv2(Guide, Other)\nGuide: "Pick a route."\n+awaitChoice("Which route?", "Left", "Right")\nGuide: "Onward."',
    true, portraits,
  );
  try {
    vi.advanceTimersByTime(238);
    const left = session.getPortraitScreenRect('left');
    if (!left) throw new Error('Missing left portrait');
    expect(getCell(left.x, left.y)).toEqual(coloredPortraitCell);
    const normalMessage = getCellAtText('Pick a route.');
    session.input(' ');
    expect(getCellAtText('Pick a route.')).toEqual({
      ch: 'P', fg: { r: 210, g: 210, b: 210 }, bg: { r: 23, g: 23, b: 23 },
    });
    expect(getCell(left.x, left.y)).toEqual({
      ch: 'P', fg: { r: 54, g: 54, b: 54 }, bg: { r: 182, g: 182, b: 182 },
    });
    expect(getCell(0, 0)).toEqual(STANDARD_BACKGROUND);

    session.resize(40, 16);
    vi.advanceTimersByTime(170);
    expect(getCellAtText('Which route?')).toEqual({ ...UI_INK, ch: 'W' });
    const right = session.getPortraitScreenRect('right');
    if (!right) throw new Error('Missing right portrait');
    const bottom = getText().split('\n').findIndex((row) => row.startsWith('└'));
    expect(bottom).toBeGreaterThanOrEqual(Math.max(0, right.y));
    expect(bottom).toBeLessThan(right.y + right.height);
    expect(getCell(right.x, bottom)).toEqual({ ...UI_INK, ch: '─' });

    session.resize(100, 40);
    session.input('1');
    expect(getCellAtText('Onward.').bg).toEqual({ r: 23, g: 23, b: 23 });
    vi.advanceTimersByTime(170);
    expect(getCellAtText('Onward.')).toEqual({ ...normalMessage, ch: 'O' });
    expect(getCell(left.x, left.y)).toEqual(coloredPortraitCell);
  } finally {
    session.close();
  }
});
