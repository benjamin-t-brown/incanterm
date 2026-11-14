export function getPortraitAssetChoice(
  portrait: string,
  spriteIds: readonly string[],
  animationIds: readonly string[],
): { kind: 'sprite' | 'animation'; id: string; index: number } {
  const frame = /^(.+)_(\d+)$/.exec(portrait);
  if (frame && spriteIds.includes(frame[1]) && !animationIds.includes(portrait))
    return { kind: 'sprite', id: frame[1], index: Number(frame[2]) };
  return { kind: 'animation', id: portrait, index: 0 };
}

export function getDefaultPortraitSpriteChoice(
  portraits: readonly { portrait: string }[],
  spriteIds: readonly string[],
  animationIds: readonly string[],
): ReturnType<typeof getPortraitAssetChoice> | undefined {
  for (let index = portraits.length - 1; index >= 0; index--) {
    const choice = getPortraitAssetChoice(portraits[index].portrait, spriteIds, animationIds);
    if (choice.kind === 'sprite') return choice;
  }
  return undefined;
}
