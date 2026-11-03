import { getCharacterScriptNames } from '../editor/schema.js';
import { Character } from './character.js';
import type { Scene } from './scene.js';

export type Point = { x: number; y: number };

// Horizontal cells are narrower than vertical cells; diagonals are deliberately
// costlier than either straight step so a walk does not weave through open gaps.
const HORIZONTAL_COST = 2;
const VERTICAL_COST = 4;
const DIAGONAL_COST = 5;

type PathEntry = { cell: number; cost: number; order: number };

function pushPathEntry(heap: PathEntry[], entry: PathEntry): void {
  let index = heap.length;
  heap.push(entry);
  while (index > 0) {
    const parent = Math.floor((index - 1) / 2);
    if (heap[parent].cost < entry.cost ||
      (heap[parent].cost === entry.cost && heap[parent].order < entry.order)) break;
    heap[index] = heap[parent];
    index = parent;
  }
  heap[index] = entry;
}

function removePathEntry(heap: PathEntry[]): PathEntry | undefined {
  const first = heap[0];
  const last = heap.pop();
  if (!first || !last || !heap.length) return first;
  let index = 0;
  while (index * 2 + 1 < heap.length) {
    let child = index * 2 + 1;
    if (child + 1 < heap.length &&
      (heap[child + 1].cost < heap[child].cost ||
        (heap[child + 1].cost === heap[child].cost && heap[child + 1].order < heap[child].order))) child++;
    if (last.cost < heap[child].cost ||
      (last.cost === heap[child].cost && last.order < heap[child].order)) break;
    heap[index] = heap[child];
    index = child;
  }
  heap[index] = last;
  return first;
}

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
  const costs = new Map<number, number>([[start, 0]]);
  const queue: PathEntry[] = [{ cell: start, cost: 0, order: 0 }];
  let order = 0;
  let closest = start;
  let closestDistance = Infinity;
  while (queue.length) {
    const entry = removePathEntry(queue);
    if (!entry || entry.cost !== costs.get(entry.cell)) continue;
    const { cell } = entry;
    const x = cell % scene.width,
      y = Math.floor(cell / scene.width);
    const distance = (target.x - x) ** 2 + (target.y - y) ** 2;
    // Dijkstra visits cheaper paths first, so equal-distance candidates keep that tie-break.
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
      const cost = entry.cost + (dx && dy ? DIAGONAL_COST : dx ? HORIZONTAL_COST : VERTICAL_COST);
      if (cost >= (costs.get(next) ?? Infinity)) continue;
      costs.set(next, cost);
      parents.set(next, cell);
      pushPathEntry(queue, { cell: next, cost, order: ++order });
    }
  }
  const result: Point[] = [];
  for (let at = closest; at !== start; at = parents.get(at) ?? start)
    result.push({ x: at % scene.width, y: Math.floor(at / scene.width) });
  return result.reverse();
}

export function findCharacter(scene: Scene, reference: string, controlled?: Character): Character {
  if (reference === 'player' && controlled && scene.entities.includes(controlled)) return controlled;
  const characters = scene.entities.filter(
    (entity): entity is Character => entity instanceof Character,
  );
  const character =
    characters.find((entity) => entity.id === reference) ??
    characters.find((entity) => entity.instanceName === reference) ??
    characters.find((entity) => entity.characterId === reference) ??
    characters.find((entity) => getCharacterScriptNames(entity.scriptName).includes(reference));
  if (!character) throw new Error(`Scene ${scene.id} has no character ${reference}`);
  return character;
}
