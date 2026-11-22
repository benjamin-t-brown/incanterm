import { afterEach, expect, it, vi } from 'vitest';
import { TerminalScreen } from '../../client/terminal-screen.js';
import { Character } from '../../game/character.js';
import { parseRpgScript } from '../../game/rpgscript/__tests__/test-support.js';
import { Prop, Scene } from '../../game/scene.js';
import { Sprite } from '../../game/sprite.js';
import { getPlainText } from '../../game/terminal.js';
import { CANCEL_UI_AND_OPEN_LOG_INPUT } from '../../protocol/input.js';
import type { SelectionRect } from '../../protocol/messages.js';
import { createGameSession } from '../game-session.js';

afterEach(() => vi.useRealTimers());

function createCancelSession(source: string, withOverlappingArt = false) {
  const ink = { ch: ' ', fg: { r: 255, g: 255, b: 255 }, bg: { r: 0, g: 0, b: 0 } };
  const hero = new Character('hero', 0, 1, 0, new Sprite('actor', 1, 1, 0, 0, [
    withOverlappingArt ? { ...ink, ch: 'Ω' } : ink,
  ]),
    'actor', 'Hero', 'idle', 'right', 100);
  const entities = withOverlappingArt
    ? [hero, new Prop('shelf', 0, 1, 0, 1, new Sprite('shelf', 1, 1, 0, 0, [{ ...ink, ch: '§' }]))]
    : [hero];
  const scene = new Scene('room', 10, 10, 'regular-z', ink, entities, ['entry'], new Set(), [], [], [
    { id: 'exit', name: 'Exit', x: 8, y: 1 },
  ]);
  const screen = new TerminalScreen();
  let logSelection: SelectionRect | undefined;
  const scripts = parseRpgScript(
    `#entry\nload,start\n@start\n+setPlayerWalkCh(hero)\n+log("Diagnostic entry")\n${source}\n+log("UNREACHABLE")`,
    'cancel-ui.rpgscript',
  );
  const session = createGameSession(scene, (text, cols, rows, selection) => {
    screen.apply(text, cols, rows);
    logSelection = selection;
  }, scripts);
  session.resize(120, 40);
  session.open();
  return { session, screen, getLogSelection: () => logSelection };
}

const cancellationCases = [
  '+setConv()\n+bad={missing}+1',
  '+setConv2(Hero, Guide)\nHero: "Interrupted dialogue"',
  '+setConv()\n+awaitChoice("Interrupted choice", "First choice", "Other choice")',
  '+setConv()\n+showCenterToast("Interrupted toast")',
  '+setConv()\n+waitMs(1000)',
  '+setConv()\n+walkToMarker(hero, Exit)',
].flatMap((source) => [CANCEL_UI_AND_OPEN_LOG_INPUT, '\x00'].map((key) => [key, source]));

it.each(cancellationCases)('immediately exposes the log with %j and aborts the interaction: %s', (key, source) => {
  vi.useFakeTimers();
  const { session, screen, getLogSelection } = createCancelSession(source);
  try {
    expect(getLogSelection()).toBeUndefined();
    session.input(key);
    expect(getLogSelection()).toBeDefined();
    const text = getPlainText(screen.buffer);
    expect(text).toContain('Diagnostic entry');
    expect(text).not.toContain('Interrupted');
    expect(text).not.toContain('UNREACHABLE');
    expect(session.getPortraitScreenRect()).toBeUndefined();
    if (source.includes('{missing}')) expect(text).toContain('[RPGSCRIPT ERROR]');
    // Ordinary dismiss/advance input and later simulation ticks must not resume the script.
    session.input('1');
    session.input('\r');
    vi.advanceTimersByTime(2000);
    expect(getLogSelection()).toBeDefined();
    expect(getPlainText(screen.buffer)).not.toContain('UNREACHABLE');
  } finally {
    session.close();
  }
});

it('opens the log from another tab even with a partial mouse packet pending', () => {
  const { session, screen, getLogSelection } = createCancelSession('');
  try {
    session.input('\t');
    expect(getLogSelection()).toBeUndefined();
    session.input('\x1b[<0;');
    session.input(CANCEL_UI_AND_OPEN_LOG_INPUT);
    expect(getLogSelection()).toBeDefined();
    expect(getPlainText(screen.buffer)).toContain('Diagnostic entry');
    session.input('\t');
    expect(getLogSelection()).toBeUndefined();
    session.input(CANCEL_UI_AND_OPEN_LOG_INPUT);
    expect(getLogSelection()).toBeDefined();
  } finally {
    session.close();
  }
});

it('restores normal player depth when a foreground animation is canceled', () => {
  vi.useFakeTimers();
  const { session, screen } = createCancelSession('+setConv()\n+setChForeground(player, true)\n+waitMs(1000)', true);
  try {
    expect(getPlainText(screen.buffer)).toContain('Ω');
    session.input(CANCEL_UI_AND_OPEN_LOG_INPUT);
    expect(getPlainText(screen.buffer)).not.toContain('Ω');
    expect(getPlainText(screen.buffer)).toContain('§');
  } finally {
    session.close();
  }
});

it.each([
  '+setConv()\n+bad={missing}+1',
  '+setConv()\nHero: "Retained dialogue"',
  '+setConv()\n+awaitChoice("Retained choice", "First choice", "Other choice")',
  '+showCenterToast("Retained toast")',
])('toggles a large log window with plain backtick without changing the interaction: %s', (source) => {
  vi.useFakeTimers();
  const { session, screen, getLogSelection } = createCancelSession(source);
  try {
    vi.advanceTimersByTime(2000);
    const original = getPlainText(screen.buffer);
    session.input('`');
    expect(getLogSelection()).toEqual({ x: 2, y: 2, width: 116, height: 36 });
    const log = getPlainText(screen.buffer);
    expect(log).toContain('Log | ` to return');
    expect(log).toContain('Diagnostic entry');
    expect(log).not.toContain('Retained');
    expect(log).not.toContain('Inventory');
    if (source.includes('{missing}')) expect(log).toContain('[RPGSCRIPT ERROR]');
    for (const key of [' ', '\r', '1', '\t', '\x1b[<0;1;1M']) session.input(key);
    expect(getPlainText(screen.buffer)).toBe(log);
    session.input('`');
    expect(getPlainText(screen.buffer)).toBe(original);
    session.input('`');
    expect(getPlainText(screen.buffer)).toBe(log);
  } finally {
    session.close();
  }
});

it('scrolls the log window above a toast without dismissing it', () => {
  const entries = Array.from({ length: 70 }, (_, index) => `+log("Entry ${index}")`).join('\n');
  const { session, screen } = createCancelSession(`${entries}\n+showCenterToast("Retained toast")`);
  try {
    session.input('`');
    expect(getPlainText(screen.buffer)).toContain('Entry 69');
    session.input('\x1b[5~');
    expect(getPlainText(screen.buffer)).toContain('Entry 0');
    expect(getPlainText(screen.buffer)).not.toContain('Entry 69');
    session.input('\x1b[6~');
    expect(getPlainText(screen.buffer)).toContain('Entry 69');
    session.resize(80, 24);
    expect(getPlainText(screen.buffer)).toContain('Entry 69');
    session.input('`');
    expect(getPlainText(screen.buffer)).toContain('Retained toast');
  } finally {
    session.close();
  }
});

it('dumps live globals and locals only in the backtick log window without advancing gameplay', () => {
  vi.useFakeTimers();
  const { session, screen } = createCancelSession(`
+score=42
+vars.flags=|true, 0, {missing}|
+empty={missing}
+[outer]="outer value"
+callChSubscript(hero, work)
+:child("child argument")
+score=43
@child(arg)
+showCenterToast("Retained toast")
@work(owner)
+[task]="background value"
+waitMs(1000)`);
  try {
    session.input('s');
    expect(getPlainText(screen.buffer)).toContain('Retained toast');
    session.input('`');
    expect(getPlainText(screen.buffer)).not.toContain('[RPGSCRIPT VAR STATE]');
    session.input('s');
    const snapshot = getPlainText(screen.buffer);
    expect(snapshot).toContain('[RPGSCRIPT VAR STATE]');
    expect(snapshot).toContain('score: 42');
    expect(snapshot).toContain("'vars.flags': [ true, 0, undefined ]");
    expect(snapshot).toContain('empty: undefined');
    expect(snapshot).toContain("script: 'start', locals: { outer: 'outer value' }");
    expect(snapshot).toContain("script: 'child', locals: { arg: 'child argument' }");
    expect(snapshot).toContain("ownerId: 'hero'");
    expect(snapshot).toContain("owner: 'hero', task: 'background value'");
    expect(snapshot).not.toContain('Retained toast');

    session.input('`');
    expect(getPlainText(screen.buffer)).toContain('Retained toast');
    session.input('\r');
    session.input('`');
    session.input('s');
    const updated = getPlainText(screen.buffer);
    expect(updated).toContain('score: 43');
    expect(updated).toContain('foreground: []');
  } finally {
    session.close();
  }
});

it('shows the start of a large variable dump and lets the player scroll to the end', () => {
  vi.useFakeTimers();
  const variables = Array.from({ length: 120 }, (_, index) => `+var${index}=${index}`).join('\n');
  const { session, screen } = createCancelSession(variables);
  try {
    session.input('`');
    session.input('s');
    const firstPage = getPlainText(screen.buffer);
    expect(firstPage).toContain('[RPGSCRIPT VAR STATE]');
    expect(firstPage).toContain('var0: 0');
    expect(firstPage).not.toContain('var119: 119');
    for (let page = 0; page < 4; page++) session.input('\x1b[6~');
    const lastPage = getPlainText(screen.buffer);
    expect(lastPage).toContain('var119: 119');
    expect(lastPage).toContain('background: []');
  } finally {
    session.close();
  }
});
