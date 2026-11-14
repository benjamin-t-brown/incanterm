import { expect, it } from 'vitest';
import { Character } from '../character.js';
import { PlayerControl } from '../player-control.js';
import { parseRpgScript, ScriptRunner } from '../rpgscript/runtime.js';
import { commands } from '../scene-commands.js';
import { Scene } from '../scene.js';
import { Sprite } from '../sprite.js';

function createDespawnRunner(source: string) {
  const ink = { ch: '@', fg: { r: 255, g: 255, b: 255 }, bg: { r: 0, g: 0, b: 0 } };
  const sprite = new Sprite('body', 1, 1, 0, 0, [ink]);
  const hero = new Character('hero-1', 1, 1, 0, sprite, 'hero-asset', 'Hero', 'idle', 'down',
    100, new Map(), undefined, 'SceneHero');
  const npc = new Character('npc-1', 3, 1, 0, sprite, 'npc-asset', 'Npc', 'idle', 'left',
    100, new Map(), 'talkNpc', 'Npc');
  const scene = new Scene('room', 8, 4, 'regular-z', ink, [hero, npc]);
  const control = new PlayerControl(scene);
  control.setPlayerWalkCh('hero-1');
  const cleared: string[] = [];
  const runner = new ScriptRunner(parseRpgScript(source, 'despawn.rpgscript', { commands }), {
    commands,
    context: {
      scene,
      playerControl: control,
      clearBark: (character) => cleared.push(`bark:${character.id}`),
      clearCharacterSubscript: (ownerId) => cleared.push(`sub:${ownerId}`),
    },
  });
  return { hero, npc, scene, control, runner, cleared };
}

it('removes a character from the scene and clears related state', () => {
  const { hero, npc, scene, control, runner, cleared } = createDespawnRunner(
    '@start\n+despawnCh(Npc)',
  );
  control.startConversation(npc);
  npc.walkTo(scene, { x: 5, y: 1 });
  expect(npc.isWalking()).toBe(true);
  runner.start('start');
  expect(scene.entities).toEqual([hero]);
  expect(npc.isWalking()).toBe(false);
  expect(npc.isBusy()).toBe(false);
  expect(cleared).toEqual(['bark:npc-1', 'sub:npc-1']);
  expect(runner.isIdle()).toBe(true);
});

it('resolves instance names and clears the player walker when despawned', () => {
  const { hero, npc, scene, control, runner } = createDespawnRunner(
    '@start\n+despawnCh(Hero)',
  );
  runner.start('start');
  expect(scene.entities).toEqual([npc]);
  expect(control.playerWalkCh).toBeUndefined();
  expect(hero.isWalking()).toBe(false);
});

it('rejects a missing character', () => {
  const { runner } = createDespawnRunner('@start\n+despawnCh(missing)');
  expect(() => runner.start('start')).toThrow('no character missing');
});
