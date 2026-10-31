import { describe, expect, it } from 'vitest';
import { CHARACTER_STATES, createCharacter } from '../schema.js';
import { assignCharacterAnimations, characterFromAnimationFolder } from './auto-assign.js';

describe('character animation folder assignment', () => {
  it('maps the twelve generated labels to states without relying on folder order', () => {
    const states = [
      'walk right',
      'idle down',
      'idle up',
      'walk left',
      'idle left',
      'walk up',
      'idle right',
      'walk down',
      'talking up',
      'talking down',
      'talking left',
      'talking right',
    ];
    const placements = Object.fromEntries(states.map((_state, index) => [`clip-${index}`, 'hero']));
    const labels = Object.fromEntries(
      states.map((state, index) => [`clip-${index}`, `hero ${state}`]),
    );
    const result = assignCharacterAnimations(
      createCharacter('hero', 'fallback'),
      'hero',
      { folders: ['hero'], placements },
      labels,
    );
    expect(result).toMatchObject({ matched: 12, ambiguous: [] });
    expect(result.animations['idle-up']).toBe('clip-2');
    expect(result.animations['walk-down']).toBe('clip-7');
    expect(result.animations['talking-up']).toBe('clip-8');
    expect(result.animations['talking-right']).toBe('clip-11');
  });

  it('leaves missing and ambiguous states unchanged and excludes nested folders', () => {
    const result = assignCharacterAnimations(
      createCharacter('hero', 'fallback'),
      'hero',
      {
        folders: ['hero', 'hero/other'],
        placements: { a: 'hero', b: 'hero', c: 'hero/other', d: 'hero' },
      },
      { a: 'Hero IDLE-UP', b: 'other idle up', c: 'hero walk down', d: 'hero walk-left' },
    );
    expect(result.matched).toBe(1);
    expect(result.ambiguous).toEqual(['idle-up']);
    expect(result.animations['idle-up']).toBe('fallback');
    expect(result.animations['walk-down']).toBe('fallback');
    expect(result.animations['walk-left']).toBe('d');
  });
});

describe('character from animation folder', () => {
  const labels = Object.fromEntries(
    CHARACTER_STATES.map((state, index) => [`clip-${index}`, `hero ${state.replace('-', ' ')}`]),
  );
  const folders = {
    folders: ['actors', 'actors/hero'],
    placements: Object.fromEntries(
      CHARACTER_STATES.map((_state, index) => [`clip-${index}`, 'actors/hero']),
    ),
  };

  it('fills all twelve defaults without creating custom states', () => {
    const result = characterFromAnimationFolder('hero', 'actors/hero', folders, labels);
    expect(result.missing).toEqual([]);
    expect(result.ambiguous).toEqual([]);
    expect(result.character?.animations['idle-up']).toBe('clip-0');
    expect(result.character?.animations['talking-right']).toBe('clip-11');
    expect(result.character?.customAnimations).toEqual({});
    expect(result.character?.defaultFacing).toBe('down');
  });

  it('refuses incomplete and ambiguous folders rather than leaving fallback clips', () => {
    const incomplete = { ...folders, placements: { ...folders.placements } };
    delete incomplete.placements['clip-11'];
    expect(characterFromAnimationFolder('hero', 'actors/hero', incomplete, labels)).toMatchObject({
      character: null,
      missing: ['talking-right'],
    });
    const ambiguous = {
      ...folders,
      placements: { ...folders.placements, duplicate: 'actors/hero' },
    };
    expect(
      characterFromAnimationFolder('hero', 'actors/hero', ambiguous, {
        ...labels,
        duplicate: 'other idle up',
      }),
    ).toMatchObject({
      character: null,
      ambiguous: ['idle-up'],
    });
  });
});
