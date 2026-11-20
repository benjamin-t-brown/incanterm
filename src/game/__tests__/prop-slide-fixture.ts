import { createProp, createScene, createSprite, type SceneEntity } from '../../editor/schema.js';
import type { PropSlideArea } from '../prop-slide.js';

export function createPropSlideFixtureDocuments() {
  const sprite = createSprite('shelf-art', 3, 3);
  sprite.originX = 1;
  sprite.originY = 1;
  sprite.sprites[0].layers[0].cells[0] = { ch: 'S', fg: 'white', bg: 'black' };
  const prop = {
    ...createProp('shelf', { type: 'sprite', id: sprite.id, index: 0 }),
    width: 3,
    height: 3,
    blockedCells: [0, 5, 8],
  };
  return { scene: createPropSlideScene(), sprite, prop };
}

export function createPropSlideScene() {
  const scene = createScene('shelves', undefined, 8, 6);
  const propSlide: PropSlideArea = {
    // The only hole is at (4,1), which is walking-clear.
    travelCells: Array.from({ length: 48 }, (_, index) => index).filter((index) => index !== 12),
    directions: {
      left: { x: -1, y: 0 },
      right: { x: 1, y: 0 },
      up: { x: -1, y: -1 },
      down: { x: 1, y: 1 },
    },
  };
  const first: Extract<SceneEntity, { prop: string }> = {
    id: 'first',
    type: 'Prop',
    prop: 'shelf',
    name: 'Shelf',
    x: 2,
    y: 2,
    z: 0,
    slidable: { footprint: [{ x: 0, y: 0 }, { x: -1, y: -1 }], actionScript: 'pushShelf' },
  };
  const second = {
    ...first,
    id: 'second',
    x: 5,
    y: 3,
    slidable: { footprint: [{ x: 0, y: 0 }], actionScript: 'pushShelf' },
  };
  return { ...scene, propSlide, blockedCells: [19], entities: [first, second] };
}
