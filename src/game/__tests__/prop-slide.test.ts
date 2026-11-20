import { expect, it } from 'vitest';
import { getSceneSlideSetup, getSlidePath, type PropSlideArea } from '../prop-slide.js';

const directions: PropSlideArea['directions'] = {
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
  up: { x: -1, y: -1 },
  down: { x: 1, y: 1 },
};

function createAngledBoard() {
  const width = 6;
  const height = 6;
  return {
    width,
    height,
    propSlide: {
      // (3,2) is a diagonal corner, not part of the translated footprint.
      travelCells: Array.from({ length: width * height }, (_, index) => index).filter(
        (index) => index !== 2 * width + 3,
      ),
      directions,
    },
    entities: [
      {
        id: 'angled',
        name: 'Shelf',
        x: 2,
        y: 2,
        slidable: { footprint: [{ x: 0, y: 0 }, { x: -2, y: -1 }], actionScript: 'push' },
      },
      {
        id: 'other',
        name: 'Shelf',
        x: 2,
        y: 3,
        slidable: { footprint: [{ x: 0, y: 0 }], actionScript: 'push' },
      },
    ],
  };
}

function requireSlideSetup(scene: Parameters<typeof getSceneSlideSetup>[0]) {
  const setup = getSceneSlideSetup(scene);
  if (!setup) throw new Error('Fixture must define a slide board');
  return setup;
}

it('takes one diagonal step despite a missing corner and stops at a trailing-end collision', () => {
  const { board, positions } = requireSlideSetup(createAngledBoard());
  expect(getSlidePath(board, positions, 'angled', 'down')).toEqual({
    ok: true,
    path: [{ x: 3, y: 3 }],
    finalAnchor: { x: 3, y: 3 },
    obstruction: { cell: { x: 2, y: 3 }, reason: 'prop', instanceId: 'other' },
  });
  expect(positions.get('angled')).toEqual({ x: 2, y: 2 });
  expect(positions.get('other')).toEqual({ x: 2, y: 3 });

  const movedPositions = new Map(positions);
  movedPositions.set('other', { x: 4, y: 0 });
  expect(getSlidePath(board, movedPositions, 'angled', 'down')).toEqual({
    ok: true,
    path: [{ x: 3, y: 3 }, { x: 4, y: 4 }, { x: 5, y: 5 }],
    finalAnchor: { x: 5, y: 5 },
    obstruction: { cell: { x: 6, y: 6 }, reason: 'outside-travel' },
  });
});

it('returns no legal anchors when the first step is blocked and never pushes the other shelf', () => {
  const { board, positions } = requireSlideSetup(createAngledBoard());
  const result = getSlidePath(board, positions, 'angled', 'right');
  expect(result).toEqual({
    ok: true,
    path: [],
    finalAnchor: { x: 2, y: 2 },
    obstruction: { cell: { x: 3, y: 2 }, reason: 'outside-travel' },
  });
  expect(getSlidePath(board, positions, 'other', 'up')).toMatchObject({
    ok: true,
    path: [{ x: 1, y: 2 }],
    finalAnchor: { x: 1, y: 2 },
    obstruction: { cell: { x: 0, y: 1 }, reason: 'prop', instanceId: 'angled' },
  });
  const afterFirstStep = new Map(positions);
  afterFirstStep.set('angled', { x: 3, y: 3 });
  expect(getSlidePath(board, afterFirstStep, 'angled', 'down')).toEqual({
    ok: true,
    path: [],
    finalAnchor: { x: 3, y: 3 },
    obstruction: { cell: { x: 2, y: 3 }, reason: 'prop', instanceId: 'other' },
  });
  expect(getSlidePath(board, positions, 'Shelf', 'down')).toMatchObject({ ok: false });
});

it('stops a crate against a statue and leaves a matching undecorated crate out of the push board', () => {
  const slidable = { footprint: [{ x: 0, y: 0 }], actionScript: 'push' };
  const crate = { id: 'moving-crate', prop: 'crate', x: 0, y: 0 };
  const { board, positions } = requireSlideSetup({
    width: 5, height: 1, propSlide: { travelCells: [0, 1, 2, 3, 4], directions },
    entities: [
      { ...crate, slidable },
      { id: 'statue', x: 3, y: 0, slidable },
      { ...crate, id: 'fixed-crate', x: 4 },
    ],
  });
  expect(getSlidePath(board, positions, crate.id, 'right')).toMatchObject({
    ok: true, finalAnchor: { x: 2, y: 0 }, obstruction: { reason: 'prop', instanceId: 'statue' },
  });
  expect(getSlidePath(board, positions, 'fixed-crate', 'left')).toMatchObject({ ok: false });
});

it('does not wrap at row boundaries or require the placement anchor itself to be painted', () => {
  const { board, positions } = requireSlideSetup({
    width: 3,
    height: 2,
    propSlide: { travelCells: [2, 3, 4, 5], directions },
    entities: [
      {
        id: 'offset',
        x: 1,
        y: 0,
        slidable: { footprint: [{ x: 0, y: 1 }], actionScript: 'push' },
      },
    ],
  });
  expect(getSlidePath(board, positions, 'offset', 'left')).toEqual({
    ok: true,
    path: [{ x: 0, y: 0 }],
    finalAnchor: { x: 0, y: 0 },
    obstruction: { cell: { x: -1, y: 1 }, reason: 'outside-travel' },
  });
});

it('rejects a missing position or an incomplete draft footprint', () => {
  const scene = createAngledBoard();
  const { board, positions } = requireSlideSetup(scene);
  expect(getSlidePath(board, new Map(), 'angled', 'down')).toMatchObject({
    ok: false,
    error: expect.stringContaining('angled'),
  });
  scene.entities[0].slidable.footprint = [];
  const incomplete = requireSlideSetup(scene);
  expect(getSlidePath(incomplete.board, positions, 'angled', 'down')).toEqual({
    ok: false,
    error: 'Prop angled needs a nonempty slide footprint',
  });
});
