import { expect, it } from 'vitest';
import { createCharacter, parseCharacter } from '../../editor/schema.js';
import { Character } from '../character.js';
import { findCharacter } from '../character-movement.js';
import { Scene } from '../scene.js';
import { Sprite } from '../sprite.js';

it('validates slash-separated character actor aliases', () => {
  const character = createCharacter('ralgo', 'idle');
  expect(parseCharacter({ ...character, scriptName: 'Mr. Ralgo/Mr Ralgo/Ralgo' })).toMatchObject({
    ok: true,
    value: { scriptName: 'Mr. Ralgo/Mr Ralgo/Ralgo' },
  });
  for (const scriptName of ['Ralgo/', '/Ralgo', 'Ralgo/Ralgo', 'Ralgo/Mr:Ralgo']) {
    expect(parseCharacter({ ...character, scriptName }).ok).toBe(false);
  }
});

it('accepts comma-separated and mixed actor aliases and explains invalid entries', () => {
  const character = createCharacter('ada', 'idle');
  expect(parseCharacter({ ...character, scriptName: 'Ada,Adalais' })).toMatchObject({
    ok: true,
    value: { scriptName: 'Ada,Adalais' },
  });
  expect(parseCharacter({ ...character, scriptName: 'Ada, Adalais/Ms Adalais' }).ok).toBe(true);
  expect(parseCharacter({ ...character, scriptName: 'Ada,' })).toMatchObject({
    ok: false,
    error: expect.stringContaining('trailing separator'),
  });
  expect(parseCharacter({ ...character, scriptName: 'Ada,Ada' })).toMatchObject({
    ok: false,
    error: expect.stringContaining('"Ada" is listed more than once'),
  });
  expect(parseCharacter({ ...character, scriptName: 'Ada,Adalais!' })).toMatchObject({
    ok: false,
    error: expect.stringContaining('Invalid script name "Adalais!"'),
  });
});

it('resolves every script alias to the same scene character', () => {
  const ink = { ch: '@', fg: { r: 255, g: 255, b: 255 }, bg: { r: 0, g: 0, b: 0 } };
  const sprite = new Sprite('ralgo', 1, 1, 0, 0, [ink]);
  const ralgo = new Character('ralgo-instance', 1, 1, 0, sprite, 'ralgo', undefined, 'idle', 'down', 150, new Map(), undefined, 'Mr. Ralgo/Mr Ralgo/Ralgo');
  const scene = new Scene('room', 5, 5, 'regular-z', ink, [ralgo], [], new Set());
  expect(findCharacter(scene, 'Ralgo')).toBe(ralgo);
  expect(findCharacter(scene, 'Mr Ralgo')).toBe(ralgo);
  expect(findCharacter(scene, 'Mr. Ralgo')).toBe(ralgo);
  expect(findCharacter(scene, 'Mr Ralgo').clone().scriptName).toBe('Mr. Ralgo/Mr Ralgo/Ralgo');
  const ada = new Character('ada-instance', 1, 1, 0, sprite, 'ada', undefined, 'idle', 'down', 150, new Map(), undefined, 'Ada,Adalais');
  const adaScene = new Scene('classroom', 5, 5, 'regular-z', ink, [ada], [], new Set());
  expect(findCharacter(adaScene, 'Ada')).toBe(ada);
  expect(findCharacter(adaScene, 'Adalais')).toBe(ada);
});

it('ignores case for character IDs, instance names, actor aliases, and the controlled player', () => {
  const ink = { ch: '@', fg: { r: 255, g: 255, b: 255 }, bg: { r: 0, g: 0, b: 0 } };
  const sprite = new Sprite('hero', 1, 1, 0, 0, [ink]);
  const hero = new Character('Hero-ID', 1, 1, 0, sprite, 'Hero-Asset', 'Hero-Instance',
    'idle', 'down', 150, new Map(), undefined, 'Johnathan/John,Johnny');
  const scene = new Scene('room', 5, 5, 'regular-z', ink, [hero], [], new Set());
  for (const reference of ['hero-id', 'HERO-ID', 'hero-asset', 'HERO-ASSET', 'hero-instance',
    'HERO-INSTANCE', 'johnathan', 'JOHNATHAN', 'john', 'JOHNNY', 'PLAYER', 'Player']) {
    expect(findCharacter(scene, reference, hero)).toBe(hero);
  }
});

it('preserves ID, instance name, and asset ID priority over case-insensitive script aliases', () => {
  const ink = { ch: '@', fg: { r: 255, g: 255, b: 255 }, bg: { r: 0, g: 0, b: 0 } };
  const sprite = new Sprite('hero', 1, 1, 0, 0, [ink]);
  const actor = new Character('actor', 1, 1, 0, sprite, 'asset', 'Instance',
    'idle', 'down', 150, new Map(), undefined, 'Hero');
  const hero = new Character('HERO', 2, 1, 0, sprite, 'INSTANCE', 'ASSET', 'idle', 'down');
  const scene = new Scene('room', 5, 5, 'regular-z', ink, [actor, hero], [], new Set());
  expect(findCharacter(scene, 'Hero')).toBe(hero);
  expect(findCharacter(scene, 'instance')).toBe(actor);
  expect(findCharacter(scene, 'asset')).toBe(hero);
});
