import { Character } from './character.js';
import type { Scene } from './scene.js';

export type Point = { x: number; y: number };

// Eight-way shortest-cell paths. Character timing accounts for narrower horizontal cells.
export function findPath(scene: Scene, character: Character, target: Point): Point[] {
  const blocked = new Set(scene.blockedCells);
  for (const entity of scene.entities) {
    if (!(entity instanceof Character) || entity === character) continue;
    const left = entity.x - entity.sprite.originX;
    if (entity.bottomY < 0 || entity.bottomY >= scene.height) continue;
    for (let x = Math.max(0, left); x < Math.min(scene.width, left + entity.sprite.width); x++)
      blocked.add(entity.bottomY * scene.width + x);
  }
  const isValid = (x: number, y: number): boolean => {
    const left = x - character.sprite.originX;
    if (
      !Number.isInteger(x) ||
      !Number.isInteger(y) ||
      left < 0 ||
      left + character.sprite.width > scene.width ||
      y < 0 ||
      y >= scene.height
    )
      return false;
    for (let column = left; column < left + character.sprite.width; column++)
      if (blocked.has(y * scene.width + column)) return false;
    return true;
  };
  if (
    !Number.isInteger(target.x) ||
    !Number.isInteger(target.y) ||
    target.x < 0 ||
    target.y < 0 ||
    target.x >= scene.width ||
    target.y >= scene.height
  )
    return [];
  const start = character.bottomY * scene.width + character.x;
  const goal = target.y * scene.width + target.x;
  const parents = new Map<number, number>([[start, start]]);
  const queue = [start];
  let closest = start;
  let closestDistance = Infinity;
  for (let head = 0; head < queue.length; head++) {
    const cell = queue[head];
    const x = cell % scene.width,
      y = Math.floor(cell / scene.width);
    const distance = (target.x - x) ** 2 + (target.y - y) ** 2;
    // BFS visits shorter paths first, so equal-distance candidates keep that tie-break.
    if (distance < closestDistance) {
      closest = cell;
      closestDistance = distance;
    }
    if (cell === goal) break;
    const directions = [-1, 0, 1]
      .flatMap((dy) => [-1, 0, 1].map((dx) => ({ dx, dy })))
      .filter(({ dx, dy }) => dx || dy)
      .sort(
        (a, b) =>
          (target.x - x - a.dx) ** 2 +
          (target.y - y - a.dy) ** 2 -
          ((target.x - x - b.dx) ** 2 + (target.y - y - b.dy) ** 2),
      );
    for (const { dx, dy } of directions) {
      if (!isValid(x + dx, y + dy)) continue;
      if (dx && dy && (!isValid(x + dx, y) || !isValid(x, y + dy))) continue;
      const next = (y + dy) * scene.width + x + dx;
      if (!parents.has(next)) {
        parents.set(next, cell);
        queue.push(next);
      }
    }
  }
  const result: Point[] = [];
  for (let at = closest; at !== start; at = parents.get(at) ?? start)
    result.push({ x: at % scene.width, y: Math.floor(at / scene.width) });
  return result.reverse();
}

export function findCharacter(scene: Scene, idOrInstanceName: string): Character {
  const characters = scene.entities.filter(
    (entity): entity is Character => entity instanceof Character,
  );
  const character =
    characters.find((entity) => entity.id === idOrInstanceName) ??
    characters.find((entity) => entity.instanceName === idOrInstanceName) ??
    characters.find((entity) => entity.characterId === idOrInstanceName);
  if (!character) throw new Error(`Scene ${scene.id} has no character ${idOrInstanceName}`);
  return character;
}
