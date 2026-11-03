import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Cell } from '../../game/cell-buffer.js';
import type { PortraitAsset, PortraitAssets, PortraitFrame } from '../../game/portrait-assets.js';
import { parseRpgScript, ScriptRunner } from '../../game/rpgscript/__tests__/test-support.js';
import { Scene } from '../../game/scene.js';
import { Character } from '../../game/character.js';
import { Sprite } from '../../game/sprite.js';
import { getDefaultAssetsRoot } from '../../game/load-scene.js';
import { getDialoguePortrait, loadPortraitAssets } from '../../game/portrait-assets.js';
import { getPlainText } from '../../game/terminal.js';
import { TerminalScreen } from '../../client/terminal-screen.js';
import { LayoutStandardScene, STANDARD_BACKGROUND } from '../../renderer/ui/layout-standard-scene.js';
import { CellBuffer } from '../../game/cell-buffer.js';
import { createGameSession } from '../game-session.js';

const clear: Cell = { ch: ' ', fg: { r: 255, g: 255, b: 255 }, bg: { r: 0, g: 0, b: 0 } };
const createFrame = (ch: string, durationMs: number): PortraitFrame => ({
  width: 1,
  height: 1,
  durationMs,
  cells: [{ ...clear, ch }],
});
const frames = [createFrame('X', 50), createFrame('Y', 50)];
const animation: PortraitAsset = { width: 1, height: 1, loop: true, frames };
const portraits: PortraitAssets = Object.assign(new Map([['talking', animation]]), {
  characters: new Map([['Guide', { id: 'guide', scriptName: 'Guide', portraits: [
    { facing: 'right' as const, emotion: '', portrait: 'talking' },
  ] }]]),
});

function isVisible(text: string): string {
  const csi = new RegExp(`${String.fromCharCode(0x1b)}\\[[0-9;?]*[A-Za-z]`, 'g');
  return text.replace(csi, '');
}

describe('dialogue portraits', () => {
  afterEach(() => vi.useRealTimers());

  it('shows the assigned Eva portrait in a rounded frame when clicked to talk', async () => {
    const assets = await loadPortraitAssets(getDefaultAssetsRoot());
    const evaPortrait = getDialoguePortrait(assets, 'Eva');
    expect(evaPortrait?.asset.frames[0].cells?.some((cell) => cell.ch !== ' ')).toBe(true);
    expect(getDialoguePortrait(assets, 'Johnathan')).toBeDefined();
    const sprite = new Sprite('person', 1, 1, 0, 0, [{ ...clear, ch: '@' }]);
    const player = new Character('hero', 1, 2, 0, sprite, 'hero', 'Player', 'idle', 'right');
    const eva = new Character('eva', 3, 2, 0, sprite, 'eva', 'Eva', 'idle', 'left', 100, new Map(), 'talk');
    const scene = new Scene('room', 10, 5, 'regular-z', clear, [player, eva], ['entry']);
    const scripts = parseRpgScript('#entry\nload,start\n@start\n+setPlayerWalkCh(hero)\n@talk\n+setConv()\nEva: "Hello"\n+endConv()', 'room.rpgscript');
    vi.useFakeTimers();
    const screen = new TerminalScreen();
    const session = createGameSession(scene, (text, cols, rows) => screen.apply(text, cols, rows), scripts, assets);
    session.resize(120, 40);
    try {
      session.open();
      const layout = new LayoutStandardScene(scene);
      layout.render(new CellBuffer(120, 40, STANDARD_BACKGROUND));
      let click: { x: number; y: number } | undefined;
      for (let y = 0; y < 40; y++) for (let x = 0; x < 120; x++) {
        const point = layout.getScenePoint(x, y);
        if (point?.x === eva.x && point.y === eva.y) click = { x, y };
      }
      expect(click).toBeDefined();
      if (!click) return;
      session.input(`\x1b[<0;${click.x + 1};${click.y + 1}M`);
      vi.advanceTimersByTime(300);
      const text = getPlainText(screen.buffer);
      expect(text).toContain('Eva');
      expect(text).not.toContain('Eva:');
      expect(text).toContain('Hello');
      expect(text).toContain('[Space/Enter]');
      expect(text).not.toContain('Eva: Hello  [Space/Enter]');
      const lines = text.split('\n');
      const dialogueRow = lines.findIndex((line) => line.includes('Hello'));
      expect(lines[dialogueRow + 2].indexOf('[Space/Enter]')).toBe(lines[dialogueRow].indexOf('Hello'));
      const labelRow = lines.findIndex((line) => line.includes('Eva'));
      const labelX = lines[labelRow].indexOf('Eva');
      expect(lines[labelRow][labelX - 1]).toBe(' ');
      expect(lines[labelRow][labelX + 'Eva'.length]).toBe(' ');
      expect(lines[labelRow - 1][labelX - 2]).toBe('╔');
      expect(lines[labelRow + 1][labelX - 2]).toBe('╚');
      expect(screen.buffer.get(labelX - 2, labelRow - 1).fg).toEqual({ r: 64, g: 160, b: 255 });
      expect(dialogueRow).toBeGreaterThan(labelRow + 1);
      for (let x = labelX; x < labelX + 'Eva'.length; x++)
        expect(screen.buffer.get(x, labelRow).fg).toEqual({ r: 64, g: 160, b: 255 });
      expect(screen.buffer.get(lines[dialogueRow].indexOf('Hello'), dialogueRow).fg)
        .toEqual({ r: 205, g: 211, b: 209 });
      expect(text).toContain('╔');
      expect(text).toContain('^');
      expect((text.match(/╔/g) ?? [])).toHaveLength(1);
      expect(text).toContain('╭');
    } finally {
      session.close();
    }
  });

  it('refreshes portraits for an already-open conversation after assets change', async () => {
    const scene = new Scene('room', 1, 1, 'regular-z', clear, [], ['entry']);
    const scripts = parseRpgScript('#entry\nload,start\n@start\n+setConv()\nGuide: "Hello"', 'room.rpgscript');
    let resolveReload: ((value: PortraitAssets) => void) | undefined;
    const reload = () => new Promise<PortraitAssets>((resolve) => { resolveReload = resolve; });
    const screen = new TerminalScreen();
    const session = createGameSession(
      scene, (text, cols, rows) => screen.apply(text, cols, rows), scripts, new Map(), () => true, reload,
    );
    session.resize(80, 40);
    try {
      session.open();
      expect(getPlainText(screen.buffer)).toContain('Guide');
      expect(getPlainText(screen.buffer)).not.toContain('Guide:');
      expect(getPlainText(screen.buffer)).toContain('Hello');
      expect(getPlainText(screen.buffer)).not.toContain('X');
      resolveReload?.(portraits);
      await Promise.resolve();
      expect(getPlainText(screen.buffer)).toContain('X');
    } finally {
      session.close();
    }
  });

  it('prefers the right portrait regardless of where the speaker stands', () => {
    const scene = new Scene('room', 1, 1, 'regular-z', clear, [], ['entry']);
    const assets: PortraitAssets = Object.assign(new Map([
      ['left', { ...animation, frames: [createFrame('L', 100)] }],
      ['right', { ...animation, frames: [createFrame('R', 100)] }],
    ]), { characters: new Map([['Eva', { id: 'eva', scriptName: 'Eva', portraits: [
      { facing: 'left' as const, emotion: '', portrait: 'left' },
      { facing: 'right' as const, emotion: '', portrait: 'right' },
    ] }]]) });
    const scripts = parseRpgScript('#entry\nload,start\n@start\n+setConv()\nEva: "Hi"\n+endConv()', 'right.rpgscript');
    const frames: string[] = [];
    const session = createGameSession(scene, (text) => frames.push(isVisible(text)), scripts, assets);
    try {
      session.open();
      expect(frames.at(-1)).toContain('R');
      expect(frames.at(-1)).not.toContain('L');
    } finally {
      session.close();
    }
  });

  it('opens and ends a conversation around dialogue', () => {
    const runner = new ScriptRunner(
      parseRpgScript(
        '@start\n+setConv()\nGuide: "First"\nGuide&happy: "Next"\n+endConv()',
        'portraits.rpgscript',
      ),
    );
    runner.start('start');
    expect(runner.getStorage('dialogue.active')).toBe(true);
    runner.advance();
    expect(runner.dialogue?.emotion).toBe('happy');
    runner.advance();
    expect(runner.getStorage('dialogue.active')).toBe(false);
  });

  it('renders both setConv2 participants and highlights the speaking character', () => {
    const scene = new Scene('room', 1, 1, 'regular-z', clear, [], ['entry']);
    const scripts = parseRpgScript(
      '#entry\nload,start\n@start\n+setConv2(Johnathan, Eva)\n+playDialogue(Johnathan, "Hello")\n+playDialogue(Eva, "Hi")\n+endConv()',
      'two-speakers.rpgscript',
    );
    const assets: PortraitAssets = Object.assign(new Map([
      ['johnathan-right', { ...animation, width: 3, height: 2, frames: [{ ...createFrame('J', 100), width: 3, height: 2, cells: Array.from({ length: 6 }, () => ({ ...clear, ch: 'J' })) }] }],
      ['eva-left', { ...animation, width: 3, height: 2, frames: [{ ...createFrame('E', 100), width: 3, height: 2, cells: Array.from({ length: 6 }, () => ({ ...clear, ch: 'E' })) }] }],
    ]), { characters: new Map([
      ['Johnathan', { id: 'johnathan', scriptName: 'Johnathan', portraits: [
        { facing: 'right' as const, emotion: '', portrait: 'johnathan-right' },
      ] }],
      ['Eva', { id: 'eva', scriptName: 'Eva', portraits: [
        { facing: 'left' as const, emotion: '', portrait: 'eva-left' },
      ] }],
    ]) });
    const screen = new TerminalScreen();
    const session = createGameSession(scene, (text, cols, rows) => screen.apply(text, cols, rows), scripts, assets);
    session.resize(120, 40);
    try {
      session.open();
      const first = getPlainText(screen.buffer);
      expect(first).toContain('Johnathan');
      expect(first).toContain('Eva');
      expect(first).toContain('Hello');
      expect(first).toContain('JJJ');
      expect(first).toContain('EEE');
      expect(first.split('\n')[36][0]).toBe('╭');
      expect(first.split('\n')[36][115]).toBe('╭');
      const firstNames = first.split('\n').findIndex((line) => line.includes('Johnathan'));
      const leftNameX = first.split('\n')[firstNames].indexOf('Johnathan') - 2;
      const rightNameX = first.split('\n')[firstNames].indexOf('Eva') - 2;
      expect(screen.buffer.get(leftNameX, firstNames - 1).fg).toEqual({ r: 255, g: 255, b: 255 });
      expect(screen.buffer.get(rightNameX, firstNames - 1).fg).toEqual({ r: 128, g: 128, b: 128 });
      expect(screen.buffer.get(0, 36).fg).toEqual({ r: 255, g: 255, b: 255 });
      expect(screen.buffer.get(115, 36).fg).toEqual({ r: 128, g: 128, b: 128 });
      session.input(' ');
      expect(getPlainText(screen.buffer)).toContain('Hi');
      expect(screen.buffer.get(leftNameX, firstNames - 1).fg).toEqual({ r: 128, g: 128, b: 128 });
      expect(screen.buffer.get(rightNameX, firstNames - 1).fg).toEqual({ r: 255, g: 255, b: 255 });
      expect(screen.buffer.get(0, 36).fg).toEqual({ r: 128, g: 128, b: 128 });
      expect(screen.buffer.get(115, 36).fg).toEqual({ r: 255, g: 255, b: 255 });
      session.input(' ');
      expect(getPlainText(screen.buffer)).toContain('Inventory');
      expect(getPlainText(screen.buffer)).not.toContain('Johnathan');
    } finally {
      session.close();
    }
  });

  it('requires exactly two names and clears setConv2 when switching modes', () => {
    expect(() => parseRpgScript('@start\n+setConv2(Eva)', 'invalid.rpgscript')).toThrow();
    expect(() => parseRpgScript('@start\n+setConv2(Eva, Johnathan, Guide)', 'invalid.rpgscript')).toThrow();
    const runner = new ScriptRunner(parseRpgScript(
      '@start\n+setConv2(Johnathan, Eva)\nEva: "First"\n+setConv()\nGuide: "Next"\n+endConv()',
      'two-speakers.rpgscript',
    ));
    runner.start('start');
    expect(runner.getStorage('dialogue.leftActor')).toBe('Johnathan');
    expect(runner.getStorage('dialogue.rightActor')).toBe('Eva');
    runner.advance();
    expect(runner.getStorage('dialogue.leftActor')).toBeUndefined();
    expect(runner.getStorage('dialogue.rightActor')).toBeUndefined();
    runner.advance();
    expect(runner.getStorage('dialogue.active')).toBe(false);
  });

  it('does not show the advance hint for an empty conversation panel', () => {
    const scene = new Scene('room', 1, 1, 'regular-z', clear, [], ['entry']);
    const scripts = parseRpgScript('#entry\nload,start\n@start\n+setConv()', 'empty.rpgscript');
    const framesSent: string[] = [];
    const session = createGameSession(scene, (text) => framesSent.push(isVisible(text)), scripts);
    try {
      session.open();
      expect(framesSent.at(-1)).toContain('╔');
      expect(framesSent.at(-1)).not.toContain('[Space/Enter]');
    } finally {
      session.close();
    }
  });

  it('keeps the grey advance hint visible while dialogue waits', () => {
    vi.useFakeTimers();
    const scene = new Scene('room', 1, 1, 'regular-z', clear, [], ['entry']);
    const scripts = parseRpgScript(
      '#entry\nload,start\n@start\n+setConv()\nGuide: "First"\nGuide: "Second"\n+endConv()',
      'hint.rpgscript',
    );
    const screen = new TerminalScreen();
    const session = createGameSession(scene, (text, cols, rows) => screen.apply(text, cols, rows), scripts);
    session.resize(120, 40);
    try {
      session.open();
      expect(getPlainText(screen.buffer)).toContain('[Space/Enter]');
      const hintRow = getPlainText(screen.buffer).split('\n').findIndex((line) => line.includes('[Space/Enter]'));
      expect(screen.buffer.get(2, hintRow).fg).toEqual({ r: 128, g: 128, b: 128 });
      vi.advanceTimersByTime(510);
      expect(getPlainText(screen.buffer)).toContain('[Space/Enter]');
      expect(getPlainText(screen.buffer)).toContain('First');
      vi.advanceTimersByTime(510);
      expect(getPlainText(screen.buffer)).toContain('[Space/Enter]');
      vi.advanceTimersByTime(510);
      expect(getPlainText(screen.buffer)).toContain('[Space/Enter]');
      session.input(' ');
      expect(getPlainText(screen.buffer)).toContain('Second');
      expect(getPlainText(screen.buffer)).toContain('[Space/Enter]');
      session.input(' ');
      expect(getPlainText(screen.buffer)).not.toContain('[Space/Enter]');
      vi.advanceTimersByTime(1020);
      expect(getPlainText(screen.buffer)).not.toContain('[Space/Enter]');
    } finally {
      session.close();
    }
  });

  it('rejects the removed portrait argument', () => {
    const runner = new ScriptRunner(
      parseRpgScript('@start\n+setConv()\nGuide: "Hello"', 'portraits.rpgscript'),
    );
    expect(() => parseRpgScript('@start\n+setConv(face_1)', 'portraits.rpgscript')).toThrow();
    runner.start('start');
    expect(runner.getStorage('dialogue.active')).toBe(true);
    expect(runner.dialogue?.text).toBe('Hello');
  });

  it('accepts an emotion in an explicit playDialogue call', () => {
    const runner = new ScriptRunner(parseRpgScript(
      '@start\n+setConv()\n+playDialogue(Eva, "Hello", happy)\n+endConv()', 'portrait.rpgscript',
    ));
    runner.start('start');
    expect(runner.dialogue).toEqual({ actor: 'Eva', text: 'Hello', emotion: 'happy' });
    runner.advance();
    expect(runner.getStorage('dialogue.active')).toBe(false);
  });

  it('animates the left portrait while dialogue is shown and stops after it ends', () => {
    vi.useFakeTimers();
    const scene = new Scene('room', 1, 1, 'regular-z', clear, [], ['entry']);
    const scripts = parseRpgScript(
      '#entry\nload,start\n@start\n+setConv()\nGuide: "Hello"\n+endConv()',
      'portrait.rpgscript',
    );
    const framesSent: string[] = [];
    const session = createGameSession(
      scene,
      (text) => framesSent.push(isVisible(text)),
      scripts,
      portraits,
    );
    try {
      session.open();
      expect(framesSent.at(-1)).toContain('X');
      expect(framesSent.at(-1)).toContain('Guide');
      expect(framesSent.at(-1)).toContain('Hello');
      expect(framesSent.at(-1)).toContain('[Space/Enter]');
      vi.advanceTimersByTime(68);
      expect(framesSent.at(-1)).toContain('Y');
      vi.advanceTimersByTime(34);
      expect(framesSent.at(-1)).toContain('X');
      session.input(' ');
      expect(framesSent.at(-1)).toContain('Inventory');
      expect(framesSent.at(-1)).not.toContain('[Space/Enter]');
      const count = framesSent.length;
      vi.advanceTimersByTime(150);
      expect(framesSent).toHaveLength(count);
    } finally {
      session.close();
    }
  });

  it('still displays dialogue if the selected portrait asset is missing', () => {
    const scene = new Scene('room', 1, 1, 'regular-z', clear, [], ['entry']);
    const scripts = parseRpgScript(
      '#entry\nload,start\n@start\n+setConv()\nNobody: "Hello"\n+endConv()',
      'portrait.rpgscript',
    );
    const framesSent: string[] = [];
    const session = createGameSession(
      scene,
      (text) => framesSent.push(isVisible(text)),
      scripts,
      portraits,
    );
    try {
      session.open();
      expect(framesSent.at(-1)).toContain('Nobody');
      expect(framesSent.at(-1)).toContain('Hello');
      expect(framesSent.at(-1)).not.toContain('┌');
    } finally {
      session.close();
    }
  });

  it('stops portrait redraws when a connection closes mid-dialogue', () => {
    vi.useFakeTimers();
    const scene = new Scene('room', 1, 1, 'regular-z', clear, [], ['entry']);
    const scripts = parseRpgScript(
      '#entry\nload,start\n@start\n+setConv()\nGuide: "Hello"',
      'portrait.rpgscript',
    );
    let paints = 0;
    const session = createGameSession(scene, () => paints++, scripts, portraits);
    session.open();
    session.close();
    vi.advanceTimersByTime(200);
    expect(paints).toBe(1);
  });
});
