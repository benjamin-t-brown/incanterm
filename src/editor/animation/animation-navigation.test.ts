import { describe, expect, it } from 'vitest';
import { createAnimation } from '../schema.js';
import { firstAnimationSheet, wrappedFrameIndex } from './animation-navigation.js';

describe('animation frame navigation', () => {
  it('wraps right from the last frame to the first', () => {
    expect(wrappedFrameIndex(2, 1, 3)).toBe(0);
  });

  it('wraps left from the first frame to the last', () => {
    expect(wrappedFrameIndex(0, -1, 3)).toBe(2);
  });

  it('keeps normal navigation and a single-frame reel unchanged', () => {
    expect(wrappedFrameIndex(1, 1, 3)).toBe(2);
    expect(wrappedFrameIndex(1, -1, 3)).toBe(0);
    expect(wrappedFrameIndex(0, 1, 1)).toBe(0);
  });
});

describe('animation spritesheet selection', () => {
  it('selects the first available visible frame, not the alphabetically first sheet', () => {
    const clip = createAnimation('walk');
    clip.frames = [
      { invisible: true, durationMs: 100 },
      { sprite: 'missing', index: 0, durationMs: 100 },
      { sprite: 'z-body', index: 0, durationMs: 100 },
      { sprite: 'a-body', index: 0, durationMs: 100 },
    ];
    expect(firstAnimationSheet(clip, ['a-body', 'z-body'])).toBe('z-body');
    expect(firstAnimationSheet(clip, ['a-body'])).toBe('a-body');
    expect(firstAnimationSheet(clip, [])).toBeNull();
  });
});
