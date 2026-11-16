import { getCharacterVariantNames, getCharacterVisual, isCharacterVariantName, type CharacterDocument } from '../schema.js';

/** Copy only visual data: aliases, portraits, speed, and facing belong to the character. */
export function addCharacterVariant(character: CharacterDocument, name: string, sourceVariant?: string): void {
  if (!isCharacterVariantName(name)) throw new Error('Use a variant name with letters, numbers, hyphens, or underscores.');
  if (getCharacterVariantNames(character).includes(name)) throw new Error(`Variant ${name} already exists.`);
  if (Object.keys(character.variants ?? {}).length >= 32) throw new Error('Maximum 32 additional variants.');
  const visual = getCharacterVisual(character, sourceVariant);
  if (!visual) throw new Error(`Missing source variant ${sourceVariant}`);
  character.variants ??= {};
  character.variants[name] = structuredClone({
    animations: visual.animations, customAnimations: visual.customAnimations,
  });
}

export function renameDefaultCharacterVariant(character: CharacterDocument, name: string): void {
  if (!isCharacterVariantName(name)) throw new Error('Use a variant name with letters, numbers, hyphens, or underscores.');
  if (Object.hasOwn(character.variants ?? {}, name)) throw new Error(`Variant ${name} already exists.`);
  character.defaultVariant = name;
}
