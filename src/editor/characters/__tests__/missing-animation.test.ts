import { expect, it } from 'vitest';
import { createCharacter } from '../../schema.js';
import { getMissingAnimationStates } from '../missing-animation.js';

it('finds all standard and custom fields referencing a missing animation', () => {
  const character = createCharacter('hero', 'existing');
  character.animations['idle-up'] = 'missing';
  character.animations['walk-left'] = 'missing';
  character.customAnimations.wave = 'missing';
  character.customAnimations.sit = 'existing';
  expect(getMissingAnimationStates(character, 'missing')).toEqual([
    { name: 'idle-up', extra: false },
    { name: 'walk-left', extra: false },
    { name: 'wave', extra: true },
  ]);
  expect(getMissingAnimationStates(character, 'unknown')).toEqual([]);
});
