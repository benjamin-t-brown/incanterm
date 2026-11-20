import { expect, it } from 'vitest';
import { AnimatedProp } from '../animated-prop.js';
import { Character } from '../character.js';
import { PlayerControl } from '../player-control.js';
import { parseRpgScript, ScriptRunner } from '../rpgscript/runtime.js';
import { Prop, Scene } from '../scene.js';
import { sceneCommandsShim } from '../scene-commands-shim.js';
import { commands } from '../scene-commands.js';
import { Sprite } from '../sprite.js';

function createPositionRunner(body: string) {
  const black = { r: 0, g: 0, b: 0 };
  const cell = { ch: '.', fg: black, bg: black };
  const sprite = new Sprite('test', 1, 3, 0, 1, [cell, cell, cell]);
  const hero = new Character('hero', 1, 1, 0, sprite, 'hero', 'Hero', 'idle', 'right');
  const crate = new AnimatedProp(
    'crate-1',
    3,
    2,
    0,
    0,
    sprite,
    new Map(),
    'default',
    'Crate',
    'crate',
    false,
    [
      { x: 0, y: 0 },
      { x: 0, y: 1 },
    ],
  );
  const other = new Prop('crate-2', 2, 1, 0, 0, sprite, false, 'Crate');
  const scene = new Scene('room', 8, 6, 'bottom-up', cell, [hero, crate, other], [], new Set([19]));
  const playerControl = new PlayerControl(scene);
  playerControl.setPlayerWalkCh('hero');
  const scripts = parseRpgScript(`@start\n${body}`, 'position.rpgscript', { commands });
  const runner = new ScriptRunner(scripts, {
    commands,
    context: { scene, playerControl },
  });
  return { hero, crate, other, scene, runner, playerControl };
}

it('captures character feet as a list and places the player without continuing its walk', () => {
  const { hero, runner, scene } = createPositionRunner(`
    +[old]=getCharacterPos(player)
    +setChPos(player, [old]->0, 4)
    +new=getCharacterPos(hero)
    +old=[old]
  `);
  hero.walkTo(scene, { x: 6, y: 2 });
  expect(hero.isWalking()).toBe(true);
  runner.start('start');
  scene.update(1000);
  expect(runner.getGlobal('old')).toEqual([1, 2]);
  expect(runner.getGlobal('new')).toEqual([1, 4]);
  expect([hero.x, hero.y, hero.isWalking()]).toEqual([1, 3, false]);
});

it('does not resume a walk paused by a conversation after setting the character position', () => {
  const { hero, runner, scene, playerControl } = createPositionRunner('+setChPos(hero, 2, 4)');
  hero.walkTo(scene, { x: 6, y: 2 });
  playerControl.startConversation(hero);
  runner.start('start');
  playerControl.endConversation(true);
  expect(hero.isWalking()).toBe(false);
  expect([hero.x, hero.bottomY]).toEqual([2, 4]);
});

it.each([1, 2])('can use a returned coordinate check as an early guard (feet row %i)', (y) => {
  const { runner } = createPositionRunner(`
    +setChPos(hero, 1, ${y})
    +?is(+:isUpstairs()):{
      <
    }
    +continued=true
    @isUpstairs
      +[chPos]=+getChPos(Hero)
      +[result]=?lte([chPos]->1, 1)
      <[result]
  `);
  runner.start('start');
  expect(runner.getGlobal('continued')).toBe(y === 1 ? undefined : true);
});

it('moves both sprite and animated props and keeps overlapping scene blockers in place', () => {
  const { crate, other, scene, runner } = createPositionRunner(`
    +before=getPropPos(CRATE-1)
    +setPropPos(crate-1, 5, 4)
    +after=getPropPos(crate-1)
    +setPropPos(crate-2, {before}->0, {before}->1)
    +other=getPropPos(crate-2)
  `);
  expect(scene.blockedCells).toEqual(new Set([19, 27]));
  runner.start('start');
  expect(runner.getGlobal('before')).toEqual([3, 2]);
  expect(runner.getGlobal('after')).toEqual([5, 4]);
  expect(runner.getGlobal('other')).toEqual([3, 2]);
  expect([crate.x, crate.y, other.x, other.y]).toEqual([5, 4, 3, 2]);
  expect(scene.blockedCells).toEqual(new Set([19, 37, 45]));
});

it.each([
  ['+p=getPropPos(crate)', 'prop crate is ambiguous'],
  ['+p=getCharacterPos(missing)', 'has no character missing'],
  ['+setPropPos(missing, 2, 3)', 'has no prop missing'],
  ['+setChPos(hero, 1.5, 2)', 'setChPos requires integer coordinates'],
  ['+setPropPos(crate-1, 1, right)', 'setPropPos requires integer coordinates'],
])('reports invalid position commands: %s', (body, error) => {
  const { runner } = createPositionRunner(body);
  expect(() => runner.start('start')).toThrow(error);
});

it('rejects capturing a setter or supplying extra getter arguments', () => {
  expect(() => createPositionRunner('+p=setChPos(hero, 1, 2)')).toThrow(
    'setChPos does not return a value',
  );
  expect(() => createPositionRunner('+p=getCharacterPos(hero, 1)')).toThrow('getCharacterPos');
});

it('validates setters in the scene-free shim and reports that getters need a scene', () => {
  const scripts = parseRpgScript(
    `
    @start
      +setChPos(hero, 1, 3)
      +setPropPos(crate, 2, 2)
    @read
      +p=getPropPos(crate)
    `,
    'shim-position.rpgscript',
    { commands: sceneCommandsShim },
  );
  const runner = new ScriptRunner(scripts, { commands: sceneCommandsShim, context: undefined });
  runner.start('start');
  expect(runner.isIdle()).toBe(true);
  expect(() => runner.start('read')).toThrow('getPropPos requires a world scene');
});
