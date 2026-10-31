import { describe, expect, it } from 'vitest';
import { compareSceneDrawRank, sceneDepth } from './scene-order.js';

describe('scene draw order', () => {
  it('uses ground Y in bottom-up and explicit z in regular-z', () => {
    expect(sceneDepth('bottom-up', 10, -100, 2, 3)).toBe(15);
    expect(sceneDepth('regular-z', 10, -100, 2, 3)).toBe(-98);
  });

  it('draws backgrounds first, then lower depth, retaining scene order on ties', () => {
    const ranked = [
      { id: 'near', background: false, depth: 5, order: 0 },
      { id: 'tie', background: false, depth: 5, order: 1 },
      { id: 'back', background: true, depth: 999, order: 2 },
      { id: 'far', background: false, depth: -5, order: 3 },
    ];
    ranked.sort(compareSceneDrawRank);
    expect(ranked.map(({ id }) => id)).toEqual(['back', 'far', 'near', 'tie']);
  });
});
