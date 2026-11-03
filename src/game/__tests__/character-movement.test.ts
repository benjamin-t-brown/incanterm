import { describe, expect, it } from 'vitest';
import { Character } from '../character.js';
import { findPath } from '../character-movement.js';
import { Scene } from '../scene.js';
import { Sprite } from '../sprite.js';
import { PlayerControl } from '../player-control.js';

const ink = { ch: '@', fg: { r: 255, g: 255, b: 255 }, bg: { r: 0, g: 0, b: 0 } };
function createCharacter(id: string, width: number, originX: number, x: number, feetY: number) {
  const sprite = new Sprite(
    id,
    width,
    3,
    originX,
    1,
    Array.from({ length: width * 3 }, () => ink),
  );
  return new Character(id, x, feetY - 1, 0, sprite, id, undefined, 'idle', 'down');
}
function createScene(characters: Character[], blocked: number[] = []) {
  return new Scene('room', 8, 8, 'regular-z', ink, characters, [], new Set(blocked));
}

describe('character walking footprints', () => {
  it.each([
    [3, 0],
    [3, 1],
    [3, 2],
    [4, 0],
    [4, 3],
  ])('places the bottom center on clicks for width %i and origin %i', (width, originX) => {
    const character = createCharacter('walker', width, originX, originX, 1);
    const scene = createScene([character]);
    const control = new PlayerControl(scene);
    control.setPlayerWalkCh('walker');
    control.click(4, 5, () => false);
    scene.update(3000);
    expect(character.x - originX + Math.floor(width / 2)).toBe(4);
    expect(character.bottomY).toBe(5);
    expect(character.state).toBe('idle');
  });

  it('approaches an edge click without allowing the footprint outside the scene', () => {
    const character = createCharacter('walker', 3, 0, 3, 2);
    const scene = createScene([character]);
    const control = new PlayerControl(scene);
    control.setPlayerWalkCh('walker');
    control.click(0, 2, () => false);
    scene.update(3000);
    expect(character.x).toBe(0);
    expect(character.bottomY).toBe(2);
  });

  it('requires a passage as wide as the character', () => {
    const character = createCharacter('wide', 3, 1, 3, 1);
    const narrowWall = Array.from({ length: 8 }, (_, x) => x)
      .filter((x) => x !== 2 && x !== 3)
      .map((x) => 3 * 8 + x);
    expect(
      findPath(createScene([character], narrowWall), character, { x: 3, y: 5 }).at(-1)?.y,
    ).toBe(2);
    const wideWall = narrowWall.filter((cell) => cell !== 3 * 8 + 4);
    expect(findPath(createScene([character], wideWall), character, { x: 3, y: 5 }).at(-1)).toEqual({
      x: 3,
      y: 5,
    });
  });

  it('keeps the full width inside scene boundaries, accounting for the origin', () => {
    const character = createCharacter('wide', 3, 1, 3, 2);
    expect(findPath(createScene([character]), character, { x: 0, y: 2 }).at(-1)).toEqual({
      x: 1,
      y: 2,
    });
    expect(findPath(createScene([character]), character, { x: 7, y: 2 }).at(-1)).toEqual({
      x: 6,
      y: 2,
    });
  });

  it('blocks the full feet row of other characters, but not their upper sprite rows', () => {
    const mover = createCharacter('mover', 1, 0, 0, 3);
    const other = createCharacter('other', 3, 1, 3, 3);
    const scene = createScene([mover, other]);
    const path = findPath(scene, mover, { x: 2, y: 3 });
    expect(path.at(-1)).not.toEqual({ x: 2, y: 3 });
    expect(findPath(scene, mover, { x: 3, y: 2 }).at(-1)).toEqual({ x: 3, y: 2 });
  });

  it('checks the entire width when avoiding diagonal corners and moving obstacles', () => {
    const mover = createCharacter('mover', 3, 1, 2, 1);
    const scene = createScene([mover], [1 * 8 + 4]);
    const path = findPath(scene, mover, { x: 3, y: 2 });
    expect(path[0]).not.toEqual({ x: 3, y: 2 });
    expect(path.at(-1)).toEqual({ x: 3, y: 2 });
    const other = createCharacter('other', 3, 1, 6, 6);
    const movingScene = createScene([mover, other]);
    mover.walkTo(movingScene, { x: 3, y: 2 });
    other.x = 5;
    other.y = 1; // Feet at y=2, covering x=4..6 and the mover's destination edge.
    movingScene.update(1000);
    expect(mover.x === 3 && mover.bottomY === 2).toBe(false);
    expect(mover.state).toBe('idle');
  });
});
