import type { CharacterVisual } from '../schema.js';

export function getMissingAnimationStates(
  character: CharacterVisual,
  animationId: string,
): { name: string; extra: boolean }[] {
  return [
    ...Object.entries(character.animations)
      .filter(([, id]) => id === animationId)
      .map(([name]) => ({ name, extra: false })),
    ...Object.entries(character.customAnimations)
      .filter(([, id]) => id === animationId)
      .map(([name]) => ({ name, extra: true })),
  ];
}
