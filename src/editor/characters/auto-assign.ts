import { CHARACTER_STATES, type CharacterDocument } from '../schema.js';
import type { AssetFolders } from '../asset-folders.js';

export function assignCharacterAnimations(
  character: CharacterDocument,
  folder: string,
  folders: AssetFolders,
  labels: Record<string, string>,
): { animations: CharacterDocument['animations']; matched: number; ambiguous: string[] } {
  const animations = { ...character.animations };
  const ids = Object.entries(folders.placements)
    .filter(([, placement]) => placement === folder)
    .map(([id]) => id);
  let matched = 0;
  const ambiguous: string[] = [];
  for (const state of CHARACTER_STATES) {
    const suffix = state.replace('-', '[ -]');
    const pattern = new RegExp(`(?:^|[\\s_-])${suffix}$`, 'i');
    const matches = ids.filter((id) => pattern.test(labels[id] ?? ''));
    if (matches.length === 1) {
      animations[state] = matches[0];
      matched++;
    } else if (matches.length > 1) ambiguous.push(state);
  }
  return { animations, matched, ambiguous };
}
