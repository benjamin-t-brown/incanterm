import { expect, it } from 'vitest';
import { Character } from '../character.js';
import { PlayerControl } from '../player-control.js';
import { parseRpgScript, ScriptRunner } from '../rpgscript/runtime.js';
import { commands } from '../scene-commands.js';
import { Scene } from '../scene.js';
import { Sprite } from '../sprite.js';

const ink = { ch: '@', fg: { r: 255, g: 255, b: 255 }, bg: { r: 0, g: 0, b: 0 } };

function createStopRunner(source: string) {
  const sprite = new Sprite('actor', 1, 1, 0, 0, [ink]);
  const hero = new Character('hero', 0, 1, 0, sprite, 'actor', 'Player', 'idle', 'right', 100);
  const scene = new Scene('room', 7, 4, 'regular-z', ink, [hero], [], new Set(), [], [], [
    { id: 'marker-1', name: 'Exit', x: 4, y: 1 },
  ]);
  const control = new PlayerControl(scene);
  control.setPlayerWalkCh('hero');
  const runner = new ScriptRunner(parseRpgScript(source, 'stop.rpgscript', { commands }), {
    commands,
    context: { scene, playerControl: control },
    getCharacterId: (reference) => findHeroId(reference, hero, control),
    isCharacterBusy: () => false,
  });
  return { hero, scene, control, runner };
}

function findHeroId(reference: string, hero: Character, control: PlayerControl): string {
  if (reference === 'player' || reference === hero.id || reference === hero.instanceName) return hero.id;
  throw new Error(`Scene room has no character ${reference}`);
}

it('stops a waited walk in place and lets the waiting script continue', () => {
  const { hero, scene, runner } = createStopRunner(
    '@start\n+callChSubscript(hero, walk)\n+stopCh(hero)\n@walk(ch)\n+walkToMarker([ch], Exit)\n+setStorage(continued, true)',
  );
  runner.start('start');
  expect(hero.isWalking()).toBe(false);
  expect(hero.x).toBe(0);
  expect(runner.getGlobal('continued')).toBeUndefined();
  runner.update();
  expect(runner.getGlobal('continued')).toBe(true);
  scene.update(200);
  expect(hero.x).toBe(0);
});

it('stops mid-walk without retrying toward the marker', () => {
  const { hero, scene, control, runner } = createStopRunner(
    '@start\n+callChSubscript(hero, walk)\n@walk(ch)\n+walkToMarker([ch], Exit)\n+setStorage(continued, true)',
  );
  runner.start('start');
  scene.update(100);
  control.update();
  runner.update();
  expect(hero.isWalking()).toBe(true);
  expect(hero.x).toBe(2);
  control.stopCharacter(hero);
  runner.update();
  expect(hero.isWalking()).toBe(false);
  expect(hero.x).toBe(2);
  expect(runner.getGlobal('continued')).toBe(true);
  scene.update(200);
  expect(hero.x).toBe(2);
});

it('rejects a missing character', () => {
  const { runner } = createStopRunner('@start\n+stopCh(missing)');
  expect(() => runner.start('start')).toThrow('no character missing');
});
