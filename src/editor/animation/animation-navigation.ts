import { isInvisibleFrame, type AnimationDocument } from '../schema.js';

export function wrappedFrameIndex(index: number, direction: -1 | 1, count: number): number {
  if (count === 0) return 0;
  return (index + direction + count) % count;
}

export function firstAnimationSheet(
  animation: AnimationDocument,
  available: readonly string[],
): string | null {
  const frame = animation.frames.find(
    (entry) => !isInvisibleFrame(entry) && available.includes(entry.sprite),
  );
  return frame && !isInvisibleFrame(frame) ? frame.sprite : null;
}
