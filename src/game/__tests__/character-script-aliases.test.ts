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

it('resolves every script alias to the same scene character', () => {
  const ink = { ch: '@', fg: { r: 255, g: 255, b: 255 }, bg: { r: 0, g: 0, b: 0 } };
  const sprite = new Sprite('ralgo', 1, 1, 0, 0, [ink]);
  const ralgo = new Character('ralgo-instance', 1, 1, 0, sprite, 'ralgo', undefined, 'idle', 'down', 150, new Map(), undefined, 'Mr. Ralgo/Mr Ralgo/Ralgo');
  const scene = new Scene('room', 5, 5, 'regular-z', ink, [ralgo], [], new Set());
  expect(findCharacter(scene, 'Ralgo')).toBe(ralgo);
  expect(findCharacter(scene, 'Mr Ralgo')).toBe(ralgo);
  expect(findCharacter(scene, 'Mr. Ralgo')).toBe(ralgo);
  expect(findCharacter(scene, 'Mr Ralgo').clone().scriptName).toBe('Mr. Ralgo/Mr Ralgo/Ralgo');
});
