export const COMMAND_NAMES = [
  'walkTo',
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
] as const;

const KNOWN = new Set<string>(COMMAND_NAMES);

export function isKnownCommand(name: string): boolean {
  return name === 'callScript' || KNOWN.has(name);
}
