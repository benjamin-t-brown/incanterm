export const PROP_SLIDE_COMMAND_NAMES = [
  'approachSlideProp', 'getPropPushes', 'choosePropPush', 'slideProp', 'resetPropSlides',
] as const;

export const COMMAND_NAMES = [
  'callChSubscript',
  'setBusy',
  'getCharacterPos',
  'getChPos',
  'getPropPos',
  'setChPos',
  'setPropPos',
  'walkTo',
  'walkToMarker',
  'walkToOffset',
  'setFacing',
  'setCharacterVariant',
  'bark',
  'changeScene',
  'spawnAtMarker',
  'lookAtMarker',
  'face',
  'playAnimation',
  'showEntity',
  'hideEntity',
  'moveEntity',
  'enableEntity',
  'disableEntity',
  'changeAnimation',
  'startEffect',
  'stopEffect',
  'say',
  'choice',
  'ask',
  'setInteraction',
  'setFlag',
  'setVar',
  'addVar',
  'giveItem',
  'removeItem',
  'hasItem',
  'enterScene',
  'placePlayer',
  'transition',
  'playSound',
  'playMusic',
  'stopMusic',
  'fade',
  'wait',
  ...PROP_SLIDE_COMMAND_NAMES,
] as const;

const KNOWN = new Set<string>(COMMAND_NAMES);

export function isKnownCommand(name: string): boolean {
  return name === 'callScript' || KNOWN.has(name);
}
