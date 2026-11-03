import { afterEach, describe, expect, it, vi } from 'vitest';
import { Character } from '../../game/character.js';
import { getDefaultAssetsRoot, loadScene } from '../../game/load-scene.js';
import { loadRpgScripts } from '../../game/rpgscript/index.js';
import { commands } from '../../game/scene-commands.js';
import { createGameSession } from '../game-session.js';

describe('classroom player control', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('selects Johnathan on load and walks him in response to a floor click', async () => {
    const root = getDefaultAssetsRoot();
    const scene = await loadScene(root, 'classroom1');
    const scripts = await loadRpgScripts(root, { commands });
    const character = scene.entities.find((entity) => entity.id === 'johnathan-1');
    expect(character).toBeInstanceOf(Character);
    if (!(character instanceof Character)) throw new Error('Missing classroom character');
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
      expect(controlled.id).toBe('johnathan-1');
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
