import {
  isInvisibleFrame,
  type AnimationDocument,
  type PropVisual,
  type SpriteDocument,
  type VisibleAnimationFrame,
} from '../schema.js';

export function propVisualEditHref(visual: PropVisual): string {
  const page = visual.type === 'sprite' ? '/art' : '/animation';
  return `${page}?id=${encodeURIComponent(visual.id)}`;
}

export async function propVisualSize(
  visual: PropVisual,
  loadSprite: (id: string) => Promise<SpriteDocument>,
  loadAnimation: (id: string) => Promise<AnimationDocument>,
): Promise<{ width: number; height: number } | null> {
  let spriteId: string;
  if (visual.type === 'sprite') {
    spriteId = visual.id;
  } else {
    const animation = await loadAnimation(visual.id);
    const first = animation.frames.find((frame) => !isInvisibleFrame(frame));
    if (!first || isInvisibleFrame(first)) return null;
    spriteId = first.sprite;
  }
  const sprite = await loadSprite(spriteId);
  return { width: sprite.width, height: sprite.height };
}

export function animationsUsingSheet(
  clips: AnimationDocument[],
  sheet: string,
): { animation: AnimationDocument; frame: VisibleAnimationFrame }[] {
  return clips.flatMap((animation) => {
    const frame = animation.frames.find(
      (frame): frame is VisibleAnimationFrame => !isInvisibleFrame(frame) && frame.sprite === sheet,
    );
    return frame ? [{ animation, frame }] : [];
  });
}
