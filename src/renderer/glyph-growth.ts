export const DEFAULT_GROWTH_SEQUENCES = ['_,n8', '`^d$', '_~6%', '.,bB', "'=\\#"] as const;
export const DEFAULT_SHORT_GROWTH_SEQUENCES = ['.,<n', '_.v+', ',-+a', '-+=o'] as const;
export const GROWING_FG = { r: 128, g: 128, b: 128 };

/** Lowercase x-height letters and low punctuation; ascenders, descenders, capitals and digits are tall. */
export function isShortCharacter(character: string): boolean {
  return /^[acemnorsuvwxz.,:;_-]$/.test(character);
}

export function getRandomGrowthSequence(
  character: string,
  tallSequences: readonly string[],
  shortSequences: readonly string[],
): string {
  const sequences = isShortCharacter(character) ? shortSequences : tallSequences;
  return sequences[Math.floor(Math.random() * sequences.length)];
}
