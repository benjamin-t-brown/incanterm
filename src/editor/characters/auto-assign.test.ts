import { describe, expect, it } from 'vitest';
import { createCharacter } from '../schema.js';
import { assignCharacterAnimations } from './auto-assign.js';

describe('character animation folder assignment', () => {
  it('maps the eight generated labels to states without relying on folder order', () => {
    const states = [
      'walk right',
      'idle down',
      'idle up',
      'walk left',
      'idle left',
      'walk up',
      'idle right',
      'walk down',
      'talking',
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
    expect(result).toMatchObject({ matched: 9, ambiguous: [] });
    expect(result.animations['idle-up']).toBe('clip-2');
    expect(result.animations['walk-down']).toBe('clip-7');
    expect(result.animations.talking).toBe('clip-8');
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
