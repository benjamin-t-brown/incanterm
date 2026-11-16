import {
  createProp,
  getPropLabelError,
  type PropDocument,
  type SpriteDocument,
} from '../schema.js';

export function createSpriteProp(
  id: string,
  label: string,
  sprite: SpriteDocument,
  index: number,
): PropDocument {
  const labelError = getPropLabelError(label);
  if (labelError) throw new Error(labelError);
  if (!Number.isInteger(index) || index < 0 || index >= sprite.sprites.length)
    throw new Error('Select an existing sprite frame');
  return {
    ...createProp(id, { type: 'sprite', id: sprite.id, index }),
    label: label.trim(),
    width: sprite.width,
    height: sprite.height,
  };
}
