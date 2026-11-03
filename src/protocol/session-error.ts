export function getSessionErrorText(error: unknown): string {
  const text = error instanceof Error ? (error.stack ?? error.message) : String(error);
  // Never let error text inject terminal control sequences after restoring the screen.
  return [...text].map((character) => {
    const code = character.codePointAt(0) ?? 0;
    return (code < 32 && code !== 10 && code !== 9) || (code >= 127 && code <= 159)
      ? ' '
      : character;
  }).join('').slice(0, 16_384);
}
