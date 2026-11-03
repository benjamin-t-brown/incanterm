import { afterEach, expect, it, vi } from 'vitest';
import { parseRpgScript } from '../../game/rpgscript/__tests__/test-support.js';
import { Scene } from '../../game/scene.js';
import { Character } from '../../game/character.js';
import { Sprite } from '../../game/sprite.js';
import { LayoutStandardScene } from '../../renderer/ui/layout-standard-scene.js';
import { createGameSession } from '../game-session.js';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it('resolves timer characters in the session and preserves main dialogue when another timer errors', () => {
  vi.useFakeTimers();
  const log = vi.spyOn(LayoutStandardScene.prototype, 'appendLog');
  const ink = { ch: '@', fg: { r: 255, g: 255, b: 255 }, bg: { r: 0, g: 0, b: 0 } };
  const sprite = new Sprite('actor', 1, 1, 0, 0, [ink]);
  const character = new Character('ralgo-id', 0, 0, 0, sprite, 'actor', 'Ralgo', 'idle', 'right', 100);
  const scene = new Scene('room', 4, 4, 'bottom-up', ink, [character], ['entry', 'clock', 'missing']);
  const scripts = parseRpgScript('#entry\nload,talk\n#clock\ntimer,tick,Ralgo,100\n#missing\ntimer,tick,Absent,100\n@talk\nGuide: "Hello"\n+log("Main finished")\n@tick(ch)\n+log("Tick [ch]")', 'timer.rpgscript');
  const session = createGameSession(scene, () => {}, scripts);
  try {
    session.open();
    vi.advanceTimersByTime(102);
    expect(log.mock.calls.some(([message]) => message.includes('Tick ralgo-id'))).toBe(true);
    expect(log.mock.calls.some(([message]) => message.includes('RPGSCRIPT ERROR') && message.includes('Absent'))).toBe(true);
    expect(log.mock.calls.some(([message]) => message.includes('Main finished'))).toBe(false);
    session.input(' ');
    expect(log.mock.calls.some(([message]) => message.includes('Main finished'))).toBe(true);
  } finally {
    session.close();
  }
});

it('fires scene-bound timers repeatedly and stops on close', () => {
  vi.useFakeTimers();
  const log = vi.spyOn(LayoutStandardScene.prototype, 'appendLog');
  const scene = new Scene('room', 2, 2, 'bottom-up', { ch: ' ', fg: { r: 0, g: 0, b: 0 }, bg: { r: 0, g: 0, b: 0 } }, [], ['clock']);
  const scripts = parseRpgScript('#clock\ntimer,clock\n@clock\n+log("Tick!")\n#unused\ntimer,other,100\n@other\n+log("Wrong scene")', 'timer.rpgscript');
  const session = createGameSession(scene, () => {}, scripts);
  try {
    session.open();
    vi.advanceTimersByTime(999);
    expect(log).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1041);
    expect(log).toHaveBeenCalledTimes(2);
    expect(log.mock.calls.every(([message]) => message.includes('Tick!'))).toBe(true);
    session.close();
    vi.advanceTimersByTime(2000);
    expect(log).toHaveBeenCalledTimes(2);
  } finally {
    session.close();
  }
});
