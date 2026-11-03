import { expect, it } from 'vitest';
import fs from 'node:fs/promises';
import { Character } from '../character.js';
import { PlayerControl } from '../player-control.js';
import { parseRpgScript, ScriptRunner } from '../rpgscript/runtime.js';
import { commands } from '../scene-commands.js';
import { Scene } from '../scene.js';
import { Sprite } from '../sprite.js';

function createFacingRunner(source: string, controlled = false) {
  const ink = { ch: '@', fg: { r: 255, g: 255, b: 255 }, bg: { r: 0, g: 0, b: 0 } };
  const sprite = new Sprite('hero', 1, 1, 0, 0, [ink]);
  const hero = new Character('hero-1', 1, 1, 0, sprite, 'hero-asset', 'Hero', 'idle', 'down',
    100, new Map(), undefined, 'SceneHero');
  const scene = new Scene('room', 4, 4, 'regular-z', ink, [hero]);
  const control = new PlayerControl(scene);
  if (controlled) control.setPlayerWalkCh('hero-1');
  const runner = new ScriptRunner(parseRpgScript(source, 'facing.rpgscript', { commands }), {
    commands, context: { scene, playerControl: control },
  });
  return { hero, runner };
}

it.each(['up', 'down', 'left', 'right'] as const)('faces a character %s', (direction) => {
  const { hero, runner } = createFacingRunner(`@start\n+setFacing(hero-1, ${direction})`);
  runner.start('start');
  expect(hero.facing).toBe(direction);
  expect(runner.isIdle()).toBe(true);
});

it('resolves character asset, instance name, scene script name and script arguments', () => {
  const { hero, runner } = createFacingRunner(
    '@start(who, direction)\n+setFacing(hero-asset, left)\n+setFacing(Hero, up)\n+setFacing([who], [direction])',
  );
  runner.start('start', ['SceneHero', 'right']);
  expect(hero.facing).toBe('right');
});

it('passes the player alias and direction through the authored ld utility', async () => {
  const utility = await fs.readFile('assets/scripts/utils.rpgscript', 'utf8');
  const { hero, runner } = createFacingRunner(`${utility}\n@start\n+:ld(player, up)`, true);
  runner.start('start');
  expect(hero.facing).toBe('up');
  expect(runner.isIdle()).toBe(true);
});

it.each([
  ['setFacing(missing, left)', 'no character missing'],
  ['setFacing(hero-1, northwest)', 'direction must be up, down, left, or right'],
  ['setFacing(hero-1, 1)', 'direction must be up, down, left, or right'],
])('rejects an invalid facing request: %s', (command, error) => {
  const { runner } = createFacingRunner(`@start\n+${command}`);
  expect(() => runner.start('start')).toThrow(error);
});
