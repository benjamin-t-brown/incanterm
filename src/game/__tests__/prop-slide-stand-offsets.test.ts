import { expect, it } from 'vitest';
import { parseScene } from '../../editor/schema.js';
import { createPropSlideScene } from './prop-slide-fixture.js';

it('round-trips a partial set of local stand overrides without changing old slide data', () => {
  const scene = createPropSlideScene();
  const [first, second] = scene.entities;
  if (!first.slidable) throw new Error('Expected a slidable prop');
  first.slidable = { ...first.slidable, standOffsets: { down: { x: -2, y: 3 } } };
  const parsed = parseScene(JSON.parse(JSON.stringify(scene)));
  if (!parsed.ok) throw new Error(parsed.error);
  expect(parsed.value.entities[0]).toEqual(first);
  expect(parsed.value.entities[1]).toEqual(second);
  expect(parsed.value.propSlide).toEqual(scene.propSlide);
});

it.each([
  [{ northwest: { x: 0, y: 0 } }, 'keyed by left, right, up, or down'],
  [{ left: { x: 1.5, y: 2 } }, 'contain integer x and y'],
  [{ right: { y: 2 } }, 'contain integer x and y'],
])('rejects a malformed stand override %j', (standOffsets, error) => {
  const scene = createPropSlideScene();
  const [first, second] = scene.entities;
  expect(parseScene({
    ...scene, entities: [{ ...first, slidable: { ...first.slidable, standOffsets } }, second],
  })).toMatchObject({ ok: false, error: expect.stringContaining(error) });
});
