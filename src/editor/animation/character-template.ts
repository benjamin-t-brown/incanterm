import { createAnimation, type AnimationDocument, type CharacterState } from '../schema.js';

// Frame positions match the test3x3 spritesheet. The remaining frames are available
// for custom actions without changing the standard idle/walk/talking clips.
const FRAMES: Record<CharacterState, readonly number[]> = {
  'idle-up': [6],
  'idle-down': [0],
  'idle-left': [2],
  'idle-right': [4],
  'walk-up': [14, 15],
  'walk-down': [8, 9],
  'walk-left': [10, 11],
  'walk-right': [12, 13],
  'talking-up': [6, 7],
  'talking-down': [0, 1],
  'talking-left': [2, 3],
  'talking-right': [4, 5],
};

export const CHARACTER_TEMPLATE_FRAMES = 16;

export function getCharacterTemplateAnimation(
  id: string,
  label: string,
  spriteId: string,
  state: CharacterState,
): AnimationDocument {
  const animation = createAnimation(id, label);
  animation.frames = FRAMES[state].map((index) => ({
    sprite: spriteId,
    index,
    durationMs: state.startsWith('talking-') ? 500 : animation.defaultDurationMs,
  }));
  return animation;
}
