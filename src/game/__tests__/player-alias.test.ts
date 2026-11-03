import { expect, it } from 'vitest';
import { Character } from '../character.js';
import { findCharacter } from '../character-movement.js';
import { PlayerControl } from '../player-control.js';
import { parseRpgScript, ScriptRunner } from '../rpgscript/runtime.js';
import { commands } from '../scene-commands.js';
import { Scene } from '../scene.js';
import { Sprite } from '../sprite.js';

function createPlayerAliasScene() {
  const ink = { ch: '@', fg: { r: 255, g: 255, b: 255 }, bg: { r: 0, g: 0, b: 0 } };
  const sprite = new Sprite('actor', 1, 1, 0, 0, [ink]);
  const hero = new Character('hero', 0, 1, 0, sprite, 'hero-asset', 'Hero', 'idle', 'down', 100);
  const namedPlayer = new Character('player', 0, 3, 0, sprite, 'player-asset', 'Player', 'idle', 'down', 100);
  const scene = new Scene('room', 7, 5, 'regular-z', ink, [hero, namedPlayer], [], new Set(), [], [], [
    { id: 'exit', name: 'Exit', x: 4, y: 1 },
  ]);
  const control = new PlayerControl(scene);
  return { scene, hero, namedPlayer, control };
}

function runPlayerAliasScript(source: string, scene: Scene, control: PlayerControl): void {
  const runner = new ScriptRunner(parseRpgScript(`@start\n${source}`, 'alias.rpgscript', { commands }), {
    commands, context: { scene, playerControl: control },
  });
  runner.start('start');
}

it('prefers the controlled character over a literal player for every character scene command', () => {
  const { scene, hero, namedPlayer, control } = createPlayerAliasScene();
  control.setPlayerWalkCh('hero');
  runPlayerAliasScript('+setFacing(player, left)\n+chWalkToCoord(player, 2, 1)', scene, control);
  expect(hero.facing).toBe('left');
  expect(namedPlayer.facing).toBe('down');
  scene.update(50);
  expect(hero.x).toBe(1);
  expect(namedPlayer.x).toBe(0);
  runPlayerAliasScript('+walkToMarker(player, Exit, true)', scene, control);
  expect(hero.isWalking()).toBe(true);
  expect(namedPlayer.isWalking()).toBe(false);
  scene.update(150);
  expect(hero.x).toBe(4);
  expect(namedPlayer.x).toBe(0);
  runPlayerAliasScript('+setPlayerWalkCh(player)', scene, control);
  expect(control.playerWalkCh).toBe(hero);
});

it('falls back to the character literally named player when no character is controlled', () => {
  const { scene, hero, namedPlayer, control } = createPlayerAliasScene();
  expect(findCharacter(scene, 'player')).toBe(namedPlayer);
  runPlayerAliasScript('+setFacing(player, right)\n+chWalkToCoord(player, 2, 3)', scene, control);
  expect(namedPlayer.facing).toBe('right');
  scene.update(100);
  expect(namedPlayer.x).toBe(2);
  expect(hero.x).toBe(0);
  runPlayerAliasScript('+setPlayerWalkCh(player)', scene, control);
  expect(control.playerWalkCh).toBe(namedPlayer);
});

it('uses normal lookup for names other than the exact player alias', () => {
  const { scene, namedPlayer, control } = createPlayerAliasScene();
  control.setPlayerWalkCh('hero');
  runPlayerAliasScript('+setFacing(player-asset, up)', scene, control);
  expect(namedPlayer.facing).toBe('up');
});
