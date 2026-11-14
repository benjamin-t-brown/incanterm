import fs from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createAnimation, createCharacter as createCharacterDocument } from '../../editor/schema.js';
import { Character } from '../character.js';
import { loadSceneByReference } from '../load-scene.js';
import { createSceneFixtureAssets, createSceneFixtureDocuments } from './scene-fixture.js';
import { PlayerControl } from '../player-control.js';
import { Scene } from '../scene.js';
import { Sprite } from '../sprite.js';
import { ScriptRunner } from '../rpgscript/index.js';
import { parseRpgScript } from '../rpgscript/__tests__/test-support.js';
import { commands } from '../scene-commands.js';
import { createGameSession } from '../../server/game-session.js';

const ink = { ch: '@', fg: { r: 255, g: 255, b: 255 }, bg: { r: 0, g: 0, b: 0 } };

function createCharacter(): Character {
  return new Character('hero', 1, 1, 0, new Sprite('hero', 1, 2, 0, 0, [ink, ink]),
    'hero', 'hero', 'idle', 'down');
}

describe('spawning the controlled player', () => {
  it.each([false, true])('only enables session spawning when opted in (%s)', async (allowPlayerSpawn) => {
    const loadCharacter = vi.fn(async () => createCharacter());
    const scene = new Scene('room', 7, 7, 'bottom-up', ink, [], ['entry'], new Set(), [], [],
      [{ id: 'spawn', name: 'MarkerPlayer', x: 4, y: 5 }], loadCharacter);
    const scripts = parseRpgScript('#entry\nload,start\n@start\n+setPlayerWalkCh(hero)', 'spawn.rpgscript');
    const errors = vi.fn();
    const session = createGameSession(scene, () => {}, scripts, undefined, undefined, undefined,
      errors, undefined, undefined, undefined, allowPlayerSpawn);
    try {
      session.open();
      if (allowPlayerSpawn) {
        await vi.waitFor(() => expect(loadCharacter).toHaveBeenCalledOnce());
        expect(errors).not.toHaveBeenCalled();
      } else {
        expect(loadCharacter).not.toHaveBeenCalled();
      }
    } finally {
      session.close();
    }
  });

  it('does not spawn missing characters during normal play, even with MarkerPlayer', () => {
    const player = createCharacter();
    const loadCharacter = vi.fn(async () => createCharacter());
    const scene = new Scene('room', 7, 7, 'bottom-up', ink, [player], [], new Set(), [], [],
      [{ id: 'spawn', name: 'MarkerPlayer', x: 4, y: 5 }], loadCharacter);
    const control = new PlayerControl(scene);
    control.setPlayerWalkCh('hero');

    expect(() => control.setPlayerWalkCh('missing')).toThrow('no character missing');
    expect(loadCharacter).not.toHaveBeenCalled();
    expect(control.playerWalkCh).toBe(player);
    expect(scene.entities).toEqual([player]);
    expect([player.x, player.y]).toEqual([1, 1]);
  });

  it('disables loopback spawning after changing rooms', () => {
    const player = createCharacter();
    const loadCharacter = vi.fn(async () => createCharacter());
    const scene = new Scene('room', 7, 7, 'bottom-up', ink, [player], [], new Set(), [], [],
      [{ id: 'spawn', name: 'MarkerPlayer', x: 4, y: 5 }], loadCharacter);
    const control = new PlayerControl(scene, true);
    control.changeScene(scene, player);

    expect(() => control.setPlayerWalkCh('missing')).toThrow('no character missing');
    expect(loadCharacter).not.toHaveBeenCalled();
    expect(control.playerWalkCh).toBe(player);
  });

  it('loads a character by actor alias at MarkerPlayer and does not duplicate them', async () => {
    const root = await createSceneFixtureAssets();
    try {
      for (const folder of ['animations', 'characters']) await fs.mkdir(path.join(root, folder));
      const animation = createAnimation('idle');
      animation.frames = [{ sprite: 'target', index: 0, durationMs: 100 }];
      await fs.writeFile(path.join(root, 'animations', 'idle.json'), JSON.stringify(animation));
      await fs.writeFile(path.join(root, 'characters', 'hero.json'), JSON.stringify({
        ...createCharacterDocument('hero', 'idle'), scriptName: 'Actor/AlternateActor',
      }));
      const { scene: document } = createSceneFixtureDocuments();
      document.entities = [{ id: 'spawn', type: 'Marker', name: 'MarkerPlayer', x: 4, y: 5 }];
      await fs.writeFile(path.join(root, 'scenes', `${document.id}.json`), JSON.stringify(document));
      const scene = await loadSceneByReference(root, document.id);
      const control = new PlayerControl(scene, true);
      await control.setPlayerWalkCh('Actor');
      const player = control.playerWalkCh;
      const marker = scene.getMarker('MarkerPlayer');
      if (!player || !marker) throw new Error('Expected a player and spawn marker');
      expect(player).toBeInstanceOf(Character);
      expect(player.x).toBe(marker.x);
      expect(player.bottomY).toBe(marker.y);
      await control.setPlayerWalkCh('AlternateActor');
      await control.setPlayerWalkCh('hero');
      expect(control.playerWalkCh).toBe(player);
      expect(scene.entities).toEqual([player]);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('logs a missing-marker error without loading or changing the player', () => {
    const player = createCharacter();
    const loadCharacter = vi.fn(async () => createCharacter());
    const scene = new Scene('room', 7, 7, 'bottom-up', ink, [player], [], new Set(), [], [], [], loadCharacter);
    const control = new PlayerControl(scene, true);
    control.setPlayerWalkCh('hero');
    const errors: string[] = [];
    const runner = new ScriptRunner(parseRpgScript('@start\n+setPlayerWalkCh(missing)', 'spawn.rpgscript'), {
      commands, context: { scene, playerControl: control },
      onCommandError: (error) => errors.push(String(error)),
    });
    runner.start('start');
    expect(errors.join('\n')).toContain('no marker MarkerPlayer');
    expect(loadCharacter).not.toHaveBeenCalled();
    expect(control.playerWalkCh).toBe(player);
  });

  it('waits for spawning before running subsequent script commands', async () => {
    const player = createCharacter();
    const scene = new Scene('room', 7, 7, 'bottom-up', ink, [], [], new Set(), [], [],
      [{ id: 'spawn', name: 'MarkerPlayer', x: 4, y: 5 }], async () => player);
    const control = new PlayerControl(scene, true);
    const runner = new ScriptRunner(parseRpgScript('@start\n+setPlayerWalkCh(hero)\n+setStorage(ready,true)', 'spawn.rpgscript'), {
      commands, context: { scene, playerControl: control },
    });
    runner.start('start');
    expect(runner.getStorage('ready')).toBeUndefined();
    await vi.waitFor(() => {
      runner.update();
      expect(runner.getStorage('ready')).toBe(true);
    });
    expect(player.x).toBe(4);
    expect(player.bottomY).toBe(5);
  });
});
