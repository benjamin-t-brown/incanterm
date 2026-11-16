import { isCharacterStateName, PROP_DEFAULT_STATE, type PropDocument } from '../schema.js';

export function updatePropCustomState(
  prop: PropDocument,
  name: string,
  animation: string,
  previousName: string | null = null,
): void {
  const nextName = name.trim();
  if (
    !isCharacterStateName(nextName) ||
    nextName === PROP_DEFAULT_STATE ||
    (nextName !== previousName && nextName in prop.customAnimations)
  )
    throw new Error('Use a unique lowercase state name (spaces allowed)');
  if (previousName !== null && !Object.hasOwn(prop.customAnimations, previousName))
    throw new Error('This custom state no longer exists');
  if (previousName === null && Object.keys(prop.customAnimations).length >= 64)
    throw new Error('Maximum 64 custom states');

  if (previousName === null) {
    prop.customAnimations[nextName] = animation;
  } else {
    prop.customAnimations = Object.fromEntries(
      Object.entries(prop.customAnimations).map(([key, value]) =>
        key === previousName ? [nextName, animation] : [key, value],
      ),
    );
  }
}
