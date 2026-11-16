import { expect, it } from 'vitest';
import {
  createCharacter, createScene, getCharacterAnimation, getCharacterVariantNames,
  getCharacterVisual, parseCharacter, parseScene,
} from '../../schema.js';
import { addCharacterVariant, renameDefaultCharacterVariant } from '../character-variants.js';
import { assignCharacterAnimations } from '../auto-assign.js';
import { getMissingAnimationStates } from '../missing-animation.js';

it('keeps legacy characters as one default visual without changing their serialized fields', () => {
  const character = createCharacter('actor', 'idle');
  expect(parseCharacter(character)).toEqual({ ok: true, value: character });
  expect(getCharacterVariantNames(character)).toEqual(['default']);
  expect(getCharacterVisual(character)).toBe(character);
  expect(getCharacterAnimation(character, 'walk', 'left')).toBe('idle');
  expect(getCharacterVisual(character, 'missing')).toBeUndefined();
});

it('copies only independent visual data and keeps character identity and portraits shared', () => {
  const character = {
    ...createCharacter('actor', 'small'), scriptName: 'Actor/A',
    portraits: [{ facing: 'left' as const, emotion: '', portrait: 'portrait_0' }],
  };
  renameDefaultCharacterVariant(character, '3x3');
  character.customAnimations.wave = 'wave';
  addCharacterVariant(character, '5x5', '3x3');
  const visual = getCharacterVisual(character, '5x5');
  if (!visual) throw new Error('Missing variant');
  visual.animations['idle-left'] = 'large';
  visual.customAnimations.wave = 'large-wave';
  expect(getCharacterVariantNames(character)).toEqual(['3x3', '5x5']);
  expect(getCharacterAnimation(character, 'idle', 'left')).toBe('small');
  expect(getCharacterAnimation(character, 'idle', 'left', '5x5')).toBe('large');
  expect(getCharacterAnimation(character, 'wave', 'right', '5x5')).toBe('large-wave');
  expect(character.customAnimations.wave).toBe('wave');
  expect(visual).not.toHaveProperty('scriptName');
  expect(parseCharacter(character)).toEqual({ ok: true, value: character });
});

it('fills and diagnoses the selected variant without modifying the default animations', () => {
  const character = createCharacter('actor', 'small');
  addCharacterVariant(character, 'closeup');
  const visual = getCharacterVisual(character, 'closeup');
  if (!visual) throw new Error('Missing variant');
  const result = assignCharacterAnimations(visual, 'large', {
    folders: ['large'], placements: { large: 'large' },
  }, { large: 'Large idle left' });
  visual.animations = result.animations;
  expect(getMissingAnimationStates(visual, 'large')).toEqual([{ name: 'idle-left', extra: false }]);
  expect(getMissingAnimationStates(character, 'large')).toEqual([]);
});

it('rejects invalid, duplicate, incomplete, and excessive variants', () => {
  const character = createCharacter('actor', 'small');
  addCharacterVariant(character, 'large');
  for (const name of ['', 'bad name', '__proto__', 'constructor', 'default', 'large']) {
    expect(() => addCharacterVariant(character, name)).toThrow();
  }
  expect(() => addCharacterVariant(character, 'other', 'missing')).toThrow('Missing source');
  expect(() => renameDefaultCharacterVariant(character, 'large')).toThrow('already exists');
  for (const value of [
    { defaultVariant: 'bad name' },
    { variants: [] },
    { variants: { default: character } },
    { variants: { 'bad name': character } },
    { variants: { large: {} } },
    { variants: { large: { animations: {}, customAnimations: {} } } },
    { variants: { large: { animations: character.animations, customAnimations: { '': 'small' } } } },
    { variants: Object.fromEntries(Array.from({ length: 33 }, (_, index) => [`v${index}`, character])) },
  ]) {
    expect(parseCharacter({ ...character, ...value }).ok).toBe(false);
  }
});

it('round-trips scene variant references and rejects malformed names', () => {
  const scene = createScene('room');
  scene.entities.push({
    id: 'actor-1', type: 'Character', character: 'actor', variant: '5x5',
    state: 'idle', facing: 'down', x: 1, y: 1, z: 0,
  });
  expect(parseScene(scene)).toEqual({ ok: true, value: scene });
  expect(parseScene({
    ...scene, entities: [{ ...scene.entities[0], variant: 'bad name' }],
  }).ok).toBe(false);
});
