import { afterEach, describe, expect, it, vi } from 'vitest';
import { Character } from '../../game/character.js';
import { Scene } from '../../game/scene.js';
import { Sprite } from '../../game/sprite.js';
import { createGameSession } from '../game-session.js';
import { TerminalScreen } from '../../client/terminal-screen.js';
import { parseRpgScript } from '../../game/rpgscript/runtime.js';
import { commands } from '../../game/scene-commands.js';

const ink = { ch: 'X', fg: { r: 255, g: 255, b: 255 }, bg: { r: 0, g: 0, b: 0 } };

describe('animation frame redraws', () => {
  afterEach(() => vi.useRealTimers());

  it('continues simulation while blocked and sends only the latest state when writable', () => {
    vi.useFakeTimers();
    const sprite = new Sprite('hero', 1, 1, 0, 0, [{ ...ink, ch: '@' }]);
    const character = new Character(
      'hero',
      1,
      1,
      0,
      sprite,
      'hero',
      undefined,
      'idle',
      'down',
      100,
    );
    const scene = new Scene(
      'room',
      120,
      40,
      'regular-z',
      { ...ink, ch: '.' },
      [character],
      ['entry'],
    );
    const scripts = parseRpgScript(
      '#entry\nload,start\n@start\n+chWalkToCoord(hero, 8, 1)',
      'walk',
      { commands },
    );
    let writable = true;
    const frames: string[] = [];
    const terminal = new TerminalScreen();
    const session = createGameSession(
      scene,
      (data, cols, rows) => {
        frames.push(data);
        terminal.apply(data, cols, rows);
      },
      scripts,
      undefined,
      () => writable,
    );
    try {
      session.resize(120, 40);
      session.open();
      expect(terminal.buffer.get(1, 1).ch).toBe('@');
      writable = false;
      vi.advanceTimersByTime(340);
      expect(frames).toHaveLength(1);
      writable = true;
      vi.advanceTimersByTime(34);
      expect(frames).toHaveLength(2);
      expect(frames[1]).not.toContain('\x1b[2J');
      expect(terminal.buffer.get(1, 1).ch).toBe(' ');
      expect(terminal.buffer.get(8, 1).ch).toBe('@');
      writable = false;
      session.resize(121, 41);
      vi.advanceTimersByTime(100);
      expect(frames).toHaveLength(2);
      writable = true;
      vi.advanceTimersByTime(34);
      expect(frames).toHaveLength(3);
      expect(frames[2]).toContain('\x1b[2J');
    } finally {
      session.close();
    }
  });

  it('does not advance the simulation when input requests a repaint', () => {
    vi.useFakeTimers();
    const update = vi.spyOn(Scene.prototype, 'update');
    const session = createGameSession(new Scene('room', 1, 1, 'regular-z', ink, []), () => {});
    try {
      session.open();
      update.mockClear();
      vi.advanceTimersByTime(10);
      session.input('\t');
      session.resize(100, 40);
      expect(update).not.toHaveBeenCalled();
      vi.advanceTimersByTime(24);
      expect(update).toHaveBeenCalledExactlyOnceWith(34);
    } finally {
      session.close();
      update.mockRestore();
    }
  });

  it('skips unchanged ticks, repaints animation in place, and clears on resize', () => {
    vi.useFakeTimers();
    const first = new Sprite('first', 1, 1, 0, 0, [ink]);
    const second = new Sprite('second', 1, 1, 0, 0, [{ ...ink, ch: 'Y' }]);
    const character = new Character(
      'hero',
      0,
      0,
      0,
      first,
      'hero',
      undefined,
      'idle',
      'down',
      150,
      new Map([
        [
          'idle-down',
          {
            loop: true,
            frames: [
              { sprite: first, durationMs: 100 },
              { sprite: second, durationMs: 100 },
            ],
          },
        ],
      ]),
    );
    const scene = new Scene('room', 2, 2, 'regular-z', ink, [character]);
    const frames: string[] = [];
    const session = createGameSession(scene, (text) => frames.push(text));
    try {
      session.open();
      expect(frames).toHaveLength(1);
      expect(frames[0]).toContain('\x1b[2J');
      vi.advanceTimersByTime(68);
      expect(frames).toHaveLength(1);
      vi.advanceTimersByTime(34);
      expect(frames).toHaveLength(2);
      expect(frames[1]).toContain('Y');
      expect(frames[1]).not.toContain('\x1b[2J');
      session.resize(81, 25);
      expect(frames).toHaveLength(3);
      expect(frames[2]).toContain('\x1b[2J');
      session.resize(81, 25);
      expect(frames).toHaveLength(4);
      expect(frames[3]).not.toContain('\x1b[2J');
    } finally {
      session.close();
    }
  });
});
