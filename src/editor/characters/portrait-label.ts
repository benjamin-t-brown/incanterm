export function getPortraitAssetLabel(
  portrait: string,
  spriteLabels: Readonly<Record<string, string>>,
  animationLabels: Readonly<Record<string, string>>,
): string {
  if (Object.hasOwn(animationLabels, portrait)) return animationLabels[portrait];
  const frame = /^(.+)_(\d+)$/.exec(portrait);
  if (frame && Object.hasOwn(spriteLabels, frame[1]))
    return `${spriteLabels[frame[1]]} · Frame ${Number(frame[2]) + 1}`;
  return 'Missing portrait asset';
}
