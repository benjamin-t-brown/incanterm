import { expect, it } from 'vitest';
import { Character } from '../character.js';
import { findExactPath } from '../character-movement.js';
import { PlayerControl } from '../player-control.js';
import { type SlideDirection } from '../prop-slide.js';
import { PROP_SLIDE_STEP_MS, PropSlideControl } from '../prop-slide-control.js';
import { Prop, Scene } from '../scene.js';
import { Sprite } from '../sprite.js';

const ink = { ch: '#', fg: { r: 255, g: 255, b: 255 }, bg: { r: 0, g: 0, b: 0 } };
const directions = {
  left: { x: -1, y: 0 }, right: { x: 1, y: 0 }, up: { x: 0, y: -1 }, down: { x: 0, y: 1 },
} satisfies Record<SlideDirection, { x: number; y: number }>;

it.each([
  { direction: 'right', start: 2, spot: 4, anchor: 3, authored: false },
  { direction: 'left', start: 8, spot: 6, anchor: 7, authored: false },
  { direction: 'right', start: 2, spot: 4, anchor: 3, authored: true },
] as const)('walks to push $direction with an edge of the feet over the stand cell (authored: $authored)', ({
  direction, start, spot, anchor, authored,
}) => {
  const player = new Character('player', start, 2, 0,
    new Sprite('walker', 3, 1, 1, 0, [ink, ink, ink]), 'walker', undefined, 'idle', 'up');
  const shelf = new Prop('shelf', 5, 2, 0, 0, new Sprite('shelf', 1, 1, 0, 0, [ink]),
    false, undefined, [{ x: 0, y: 0 }], {
      footprint: [{ x: 0, y: 0 }],
      actionScript: 'push',
      ...(authored ? { standOffsets: { [direction]: { x: spot - 5, y: 0 } } } : {}),
    });
  const scene = new Scene('room', 12, 5, 'bottom-up', ink, [player, shelf], [],
    undefined, [], [], [], undefined, undefined, {
      travelCells: Array.from({ length: 60 }, (_, index) => index),
      directions,
    });
  const control = new PlayerControl(scene);
  control.setPlayerWalkCh(player.id);
  const slide = new PropSlideControl(control);

  // Centering on the stand cell would put another foot on the shelf's walking blocker.
  expect(findExactPath(scene, player, { x: spot, y: 2 })).toBeUndefined();
  const getResult = slide.startSlide(shelf.id, direction);
  expect(player.isWalking()).toBe(true);
  scene.update(1000);
  slide.update(0);
  expect({ x: player.x, y: player.bottomY, facing: player.facing }).toEqual({ x: anchor, y: 2, facing: direction });
  expect(shelf.x).toBe(5);
  slide.update(12 * PROP_SLIDE_STEP_MS);
  expect(getResult()).toBe(true);
  expect(shelf.x).toBe(direction === 'right' ? 11 : 0);
});

it.each([true, false])('uses the walking boundary for approach and push, falling back for unpainted props: %s', (hasWalkingMask) => {
  const row = hasWalkingMask ? 2 : 6;
  const player = new Character('player', 3, row - 1, 0,
    new Sprite('walker', 3, 1, 1, 0, [ink, ink, ink]), 'walker', undefined, 'idle', 'right');
  const shelf = new Prop('shelf', 5, 2, 0, 0, new Sprite('shelf', 1, 1, 0, 0, [ink]),
    false, undefined, hasWalkingMask ? [{ x: 0, y: 0 }] : [],
    { footprint: [{ x: 0, y: 4 }], actionScript: 'push' });
  const width = 12;
  const blocked = new Set(Array.from({ length: width }, (_, x) => 4 * width + x));
  blocked.add(6 * width + 8); // The walking-only obstacle must not stop the slide.
  const scene = new Scene('room', width, 8, 'bottom-up', ink, [player, shelf], [],
    blocked, [], [], [], undefined, undefined, {
      travelCells: Array.from({ length: width * 8 }, (_, index) => index),
      directions: { ...directions, up: { x: -1, y: -1 }, down: { x: 1, y: 1 } },
    });
  const control = new PlayerControl(scene);
  control.setPlayerWalkCh(player.id);
  const slide = new PropSlideControl(control);

  // The right foot is diagonally adjacent, even though the room's Down is down-right.
  expect(slide.startApproach(shelf.id)()).toBe(true);
  expect(player.isWalking()).toBe(false);
  const getResult = slide.startSlide(shelf.id, 'right');
  expect(player.isWalking()).toBe(true);
  scene.update(1000);
  slide.update(0);
  expect({ x: player.x, y: player.bottomY, facing: player.facing }).toEqual({ x: 3, y: row, facing: 'right' });
  slide.update(12 * PROP_SLIDE_STEP_MS);
  expect(getResult()).toBe(true);
  expect(shelf.x).toBe(11);
});

function createDodgeFixture(playerY: number, boxedIn = false, walkingMaskOnly = false) {
  const player = new Character('player', 10, playerY, 0,
    new Sprite('walker', 3, 1, 1, 0, [ink, ink, ink]), 'walker', undefined, 'idle', 'up');
  const shelf = new Prop('shelf', 5, 2, 0, 0, new Sprite('shelf', 1, 1, 0, 0, [ink]),
    false, undefined, [{ x: 0, y: walkingMaskOnly ? 1 : 0 }], {
      footprint: [{ x: 0, y: 0 }],
      actionScript: 'push',
      standOffsets: { right: { x: -3, y: 0 } },
    });
  const width = 12;
  const travelCells = Array.from({ length: width * 5 }, (_, index) => index);
  const blocked = new Set([2 * width + 2]);
  if (boxedIn) for (const index of travelCells) if (Math.floor(index / width) !== 2) blocked.add(index);
  const scene = new Scene('room', width, 5, 'bottom-up', ink, [player, shelf], [],
    blocked, [], [], [], undefined, undefined, { travelCells, directions });
  const control = new PlayerControl(scene);
  control.setPlayerWalkCh(player.id);
  return { scene, player, shelf, slide: new PropSlideControl(control) };
}

it.each([false, true])('steps clear before sliding, including when only the walking mask sweeps the player: %s', (walkingMaskOnly) => {
  const row = walkingMaskOnly ? 3 : 2;
  const { scene, player, shelf, slide } = createDodgeFixture(row, false, walkingMaskOnly);
  const getResult = slide.startSlide(shelf.id, 'right');
  expect(player.isWalking()).toBe(true);
  slide.update(PROP_SLIDE_STEP_MS);
  expect(shelf.x).toBe(5);
  expect(getResult()).toBeUndefined();

  scene.update(1000);
  slide.update(0);
  expect(player.x).toBe(10);
  expect(player.bottomY).not.toBe(row);
  expect(shelf.x).toBe(5);
  slide.update(12 * PROP_SLIDE_STEP_MS);
  expect(getResult()).toBe(true);
  expect(shelf.x).toBe(11);
});

it('pushes without a walk when the player is already clear of the slide', () => {
  const { player, shelf, slide } = createDodgeFixture(1);
  const getResult = slide.startSlide(shelf.id, 'right');
  expect(player.isWalking()).toBe(false);
  slide.update(12 * PROP_SLIDE_STEP_MS);
  expect(getResult()).toBe(true);
  expect(shelf.x).toBe(11);
});

it('cancels without moving the shelf when the player cannot clear its path', () => {
  const { player, shelf, slide } = createDodgeFixture(2, true);
  expect(slide.getPushes(shelf.id)).toContain('right');
  const getResult = slide.startSlide(shelf.id, 'right');
  expect(getResult()).toBe(false);
  expect(player.isWalking()).toBe(false);
  expect(shelf.x).toBe(5);
});

it('can cancel the sidestep before the shelf moves', () => {
  const { scene, player, shelf, slide } = createDodgeFixture(2);
  const getResult = slide.startSlide(shelf.id, 'right');
  expect(player.isWalking()).toBe(true);
  expect(slide.cancel()).toBe(true);
  scene.update(1000);
  slide.update(12 * PROP_SLIDE_STEP_MS);
  expect(player.isWalking()).toBe(false);
  expect(getResult()).toBe(false);
  expect(shelf.x).toBe(5);
});
