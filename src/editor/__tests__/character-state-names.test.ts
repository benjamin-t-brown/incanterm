import { expect, it } from 'vitest';
import { createCharacter, createScene, isCharacterStateName, parseCharacter, parseScene } from '../schema.js';
import { addSceneCharacter } from '../scenes/scene-characters.js';

it('allows spaces in custom character states and scene starting states', () => {
  const character = createCharacter('hero', 'stand');
  character.customAnimations['big jump'] = 'jump';
  expect(parseCharacter(character)).toMatchObject({
    ok: true,
    value: { customAnimations: { 'big jump': 'jump' } },
  });

  const scene = createScene('cast');
  addSceneCharacter(scene, character, 0, 0).state = 'big jump';
  expect(parseScene(scene).ok).toBe(true);
  expect(isCharacterStateName('big jump')).toBe(true);
  expect(isCharacterStateName(' big jump ')).toBe(false);
  expect(isCharacterStateName('big  jump')).toBe(false);
});
