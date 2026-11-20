import { expect, it } from 'vitest';
import { createPropSlideScene } from '../../../game/__tests__/prop-slide-fixture.js';
import { getSceneSlidePreview } from '../scene-slide-authoring.js';

it('previews both placements with the shared asset shape and without copying it into the scene', () => {
  const scene = createPropSlideScene();
  for (const e of scene.entities) e.slidable = { actionScript: 'push' };
  const assets = new Map([['shelf', [{ x: 0, y: 0 }, { x: -1, y: -1 }]]]);
  expect(getSceneSlidePreview(scene, 'first', 'right', assets)).toMatchObject({
    finalAnchor: { x: 3, y: 2 }, obstruction: { reason: 'prop', instanceId: 'second' },
  });
  expect(scene.entities.map(e => e.slidable?.footprint)).toEqual([undefined, undefined]);
});
