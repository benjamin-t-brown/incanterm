import { expect, it } from 'vitest';
import { getAnimationChoiceLabels } from '../animation-choice-labels.js';

it('shows animation names without IDs while keeping duplicate names selectable', () => {
  const choices = getAnimationChoiceLabels(
    ['idle-a', 'idle-b', 'walk-a', 'deleted'],
    { 'idle-a': 'Idle Down', 'idle-b': 'Idle Down', 'walk-a': 'Walk Down' },
    ['idle-a', 'idle-b', 'walk-a'],
  );
  expect([...choices.entries()]).toEqual([
    ['idle-a', 'Idle Down'],
    ['idle-b', 'Idle Down (2)'],
    ['walk-a', 'Walk Down'],
    ['deleted', 'Missing animation'],
  ]);
});

it('does not reuse another animation name for a duplicate suffix', () => {
  const choices = getAnimationChoiceLabels(
    ['a', 'b', 'c'],
    { a: 'Idle', b: 'Idle', c: 'Idle (2)' },
    ['a', 'b', 'c'],
  );
  expect([...choices.values()]).toEqual(['Idle', 'Idle (3)', 'Idle (2)']);
});
