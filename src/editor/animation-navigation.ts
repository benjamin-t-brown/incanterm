export function wrappedFrameIndex(index: number, direction: -1 | 1, count: number): number {
  if (count === 0) return 0;
  return (index + direction + count) % count;
}
