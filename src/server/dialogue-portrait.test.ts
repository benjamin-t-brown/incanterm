import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Cell } from '../game/cell-buffer.js';
import type { PortraitAsset, PortraitAssets, PortraitFrame } from '../game/portrait-assets.js';
import { parseRpgScript, ScriptRunner } from '../game/rpgscript/index.js';
import { Scene } from '../game/scene.js';
import { createGameSession } from './game-session.js';

const clear: Cell = { ch: ' ', fg: { r: 255, g: 255, b: 255 }, bg: { r: 0, g: 0, b: 0 } };
const frame = (ch: string, durationMs: number): PortraitFrame => ({
  width: 1,
  height: 1,
  durationMs,
  cells: [{ ...clear, ch }],
});
const frames = [frame('X', 50), frame('Y', 50)];
const animation: PortraitAsset = { width: 1, height: 1, loop: true, frames };
const portraits: PortraitAssets = new Map([['talking', animation]]);

function visible(text: string): string {
  const csi = new RegExp(`${String.fromCharCode(0x1b)}\\[[0-9;?]*[A-Za-z]`, 'g');
  return text.replace(csi, '');
}

describe('dialogue portraits', () => {
  afterEach(() => vi.useRealTimers());

  it('sets the portrait storage before dialogue and allows changing/clearing it', () => {
    const runner = new ScriptRunner(
      parseRpgScript(
        '@start\n+setConv(face_1)\nGuide: "First"\n+setConv("{next}")\nGuide: "Next"\n+setConv("")',
        'portraits.rpgscript',
      ),
    );
    runner.setStorage('next', 'talking');
    runner.start('start');
    expect(runner.getStorage('dialogue.portraitLeft')).toBe('face_1');
    runner.advance();
    expect(runner.getStorage('dialogue.portraitLeft')).toBe('talking');
    runner.advance();
    expect(runner.getStorage('dialogue.portraitLeft')).toBe('');
  });

  it('accepts a portrait name passed through a script parameter', () => {
    const runner = new ScriptRunner(
      parseRpgScript('@start(port)\n+setConv([port])\nGuide: "Hello"', 'portraits.rpgscript'),
    );
    runner.start('start', ['face_1']);
    expect(runner.getStorage('dialogue.portraitLeft')).toBe('face_1');
    expect(runner.dialogue?.text).toBe('Hello');
  });

  it('animates the left portrait while dialogue is shown and stops after it ends', () => {
    vi.useFakeTimers();
    const scene = new Scene('room', 1, 1, 'regular-z', clear, [], ['entry']);
    const scripts = parseRpgScript(
      '#entry\nload,start\n@start\n+setConv(talking)\nGuide: "Hello"',
      'portrait.rpgscript',
    );
    const framesSent: string[] = [];
    const session = createGameSession(
      scene,
      (text) => framesSent.push(visible(text)),
      scripts,
      portraits,
    );
    try {
      session.open();
      expect(framesSent.at(-1)).toContain('X');
      expect(framesSent.at(-1)).toContain('Guide: Hello');
      vi.advanceTimersByTime(50);
      expect(framesSent.at(-1)).toContain('Y');
      vi.advanceTimersByTime(50);
      expect(framesSent.at(-1)).toContain('X');
      session.input(' ');
      expect(framesSent.at(-1)).toContain('Inventory');
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
      '#entry\nload,start\n@start\n+setConv(does-not-exist)\nGuide: "Hello"',
      'portrait.rpgscript',
    );
    const framesSent: string[] = [];
    const session = createGameSession(
      scene,
      (text) => framesSent.push(visible(text)),
      scripts,
      portraits,
    );
    try {
      session.open();
      expect(framesSent.at(-1)).toContain('Guide: Hello');
      expect(framesSent.at(-1)).not.toContain('┌');
    } finally {
      session.close();
    }
  });

  it('stops portrait redraws when a connection closes mid-dialogue', () => {
    vi.useFakeTimers();
    const scene = new Scene('room', 1, 1, 'regular-z', clear, [], ['entry']);
    const scripts = parseRpgScript(
      '#entry\nload,start\n@start\n+setConv(talking)\nGuide: "Hello"',
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
