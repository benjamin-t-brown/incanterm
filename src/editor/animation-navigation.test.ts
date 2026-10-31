import { describe, expect, it } from 'vitest';
import { wrappedFrameIndex } from './animation-navigation.js';

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
