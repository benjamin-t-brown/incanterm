import { afterEach, describe, expect, it, vi } from 'vitest';
import { Character } from '../../game/character.js';
import { parseRpgScript } from '../../game/rpgscript/__tests__/test-support.js';
import { Scene } from '../../game/scene.js';
import { Sprite } from '../../game/sprite.js';
import { createGameSession } from '../game-session.js';

describe('session player control', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('selects the player on load and walks them in response to a floor click', () => {
    const ink = { ch: '@', fg: { r: 255, g: 255, b: 255 }, bg: { r: 0, g: 0, b: 0 } };
    const sprite = new Sprite('actor', 3, 2, 0, 0, Array(6).fill(ink));
    const character = new Character(
      'hero-1',
      10,
      10,
      0,
      sprite,
      'hero',
      'Hero',
      'idle',
      'down',
      100,
    );
    const scene = new Scene(
      'room',
      120,
      40,
      'bottom-up',
      { ...ink, ch: ' ' },
      [character],
      ['entry'],
    );
    const scripts = parseRpgScript(
      '#entry\nload,start\n@start\n+setPlayerWalkCh(hero-1)',
      'control.rpgscript',
    );
    const centerOffset = Math.floor(character.sprite.width / 2) - character.sprite.originX;
    const target = { x: character.x + centerOffset + 2, y: character.bottomY };
    const walk = vi.spyOn(Character.prototype, 'walkTo');
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.useFakeTimers();
    const session = createGameSession(scene, () => {}, scripts);
    try {
      session.resize(120, 40);
      session.open();
      session.input(`\x1b[<0;${target.x + 1};${target.y + 1}M`);
      expect(walk).toHaveBeenCalledTimes(1);
      const controlled = walk.mock.contexts[0];
      if (!(controlled instanceof Character)) throw new Error('Click did not select a character');
      expect(controlled.instanceName).toBe('Hero');
      expect(walk.mock.calls[0][1]).toEqual({ x: target.x - centerOffset, y: target.y });
      vi.advanceTimersByTime(1000);
      expect(controlled.x + centerOffset).toBe(target.x);
      expect(controlled.bottomY).toBe(target.y);
      expect(controlled.state).toBe('idle');
      expect(character.x).toBe(target.x - centerOffset - 2);
    } finally {
      session.close();
    }
  });
});
