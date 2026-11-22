import { findNearestWalkAnchor, type Point } from './character-movement.js';
import type { Character } from './character.js';
import { getPropClimbHeight } from './prop-climb-height.js';
import { Prop, type Scene } from './scene.js';

const MAX_CLIMB_RISE = 2;
const NEIGHBORS = [-1, 0, 1].flatMap(y => [-1, 0, 1].filter(x => x || y).map(x => ({ x, y })));

type ClimbStep = Readonly<Point> & (
  { kind: 'floor' | 'landing' } | { kind: 'roof'; instanceId: string }
);
type ShelfTop = {
  instanceId: string;
  base: Point[];
  roof: Point[];
  height: number;
  topRow: number;
};
type SearchNode = { shelf: ShelfTop; previous: SearchNode | ClimbStep };

/** When a player is supplied, the first waypoint must be a reachable walk anchor. */
export function getPropClimbPath(
  scene: Scene,
  landing: Point,
  player?: Character,
  mode: 'waypoints' | 'shelfCenters' = 'waypoints',
): ClimbStep[] {
  if (!isInsideScene(scene, landing)) return [];
  const bases = new Map<number, string>();
  const shelves = new Map<string, ShelfTop>();
  for (const entity of scene.entities) {
    if (!(entity instanceof Prop) || !entity.slidable) continue;
    const base = getWorldCells(scene, entity, entity.slidable.footprint);
    for (const cell of base) bases.set(getCellIndex(scene, cell), entity.id);
    if (!base.length) continue;
    const lowestBaseRow = Math.max(...base.map(cell => cell.y));
    const lowestRoofRow = entity.climbOffsets.length
      ? entity.y + Math.max(...entity.climbOffsets.map(cell => cell.y))
      : undefined;
    const height = getPropClimbHeight(lowestBaseRow, lowestRoofRow, entity.climbHeight);
    if (height === undefined) continue;
    const topRow = lowestBaseRow + 1 - height;
    if (topRow < 0 || topRow >= scene.height) continue;
    const roof = getWorldCells(scene, entity, entity.climbOffsets);
    shelves.set(entity.id, { instanceId: entity.id, base, roof, height, topRow });
  }

  const queue: SearchNode[] = [];
  const seen = new Set<string>();
  function visitShelf(shelf: ShelfTop, previous: SearchNode | ClimbStep): void {
    if (seen.has(shelf.instanceId)) return;
    seen.add(shelf.instanceId);
    queue.push({ shelf, previous });
  }

  for (const shelf of shelves.values()) {
    if (shelf.height > MAX_CLIMB_RISE) continue;
    const floor = player
      ? findReachableFloorEntry(scene, bases, shelf, player)
      : getFloorEntry(scene, bases, shelf);
    if (floor) visitShelf(shelf, { kind: 'floor', ...floor });
  }

  for (const node of queue) {
    const { shelf } = node;
    if (canReachLanding(shelf, landing)) {
      return mode === 'shelfCenters'
        ? getShelfCenterSteps(node, landing)
        : getStepsToLanding(scene, bases, node, landing, player !== undefined);
    }
    for (const id of getAdjacentBases(scene, bases, shelf)) {
      const candidate = shelves.get(id);
      if (candidate && canClimbRise(candidate.height - shelf.height)) visitShelf(candidate, node);
    }
  }
  return [];
}

function isInsideScene(scene: Scene, { x, y }: Point): boolean {
  return x >= 0 && x < scene.width && y >= 0 && y < scene.height;
}

function getCellIndex(scene: Scene, { x, y }: Point): number {
  return y * scene.width + x;
}

function getWorldCells(scene: Scene, anchor: Point, offsets: readonly Point[]): Point[] {
  return offsets.map(({ x, y }) => ({ x: x + anchor.x, y: y + anchor.y })).filter(cell => isInsideScene(scene, cell));
}

function getAdjacentBases(scene: Scene, bases: ReadonlyMap<number, string>, shelf: ShelfTop): Set<string> {
  const neighbors = new Set<string>();
  for (const contact of shelf.base) {
    for (const cell of getWorldCells(scene, contact, NEIGHBORS)) {
      const id = bases.get(getCellIndex(scene, cell));
      if (id !== undefined && id !== shelf.instanceId) neighbors.add(id);
    }
  }
  return neighbors;
}

function* getFloorCells(
  scene: Scene,
  bases: ReadonlyMap<number, string>,
  shelf: ShelfTop,
): Iterable<Point> {
  for (const contact of shelf.base) {
    for (const cell of getWorldCells(scene, contact, NEIGHBORS)) {
      const rise = cell.y - shelf.topRow;
      if (rise >= 1 && rise <= MAX_CLIMB_RISE && !bases.has(getCellIndex(scene, cell)))
        yield cell;
    }
  }
}

function findReachableFloorEntry(
  scene: Scene,
  bases: ReadonlyMap<number, string>,
  shelf: ShelfTop,
  player: Character,
): Point | undefined {
  const anchors = new Set<number>();
  for (const cell of getFloorCells(scene, bases, shelf)) {
    // Any column of the player's feet can reach the shelf; the pathfinder
    // still requires the whole footing to fit on every step.
    const rightmost = cell.x + player.sprite.originX;
    const left = Math.max(0, rightmost - player.sprite.width + 1);
    const right = Math.min(scene.width - 1, rightmost);
    for (let x = left; x <= right; x++) anchors.add(getCellIndex(scene, { x, y: cell.y }));
  }
  if (anchors.size)
    return findNearestWalkAnchor(scene, player, (point) => anchors.has(getCellIndex(scene, point)));
}

function getFloorEntry(
  scene: Scene,
  bases: ReadonlyMap<number, string>,
  shelf: ShelfTop,
  nearX = shelf.base[0].x,
): Point | undefined {
  let closest: Point | undefined;
  let distance = Infinity;
  for (const cell of getFloorCells(scene, bases, shelf)) {
    const cost = Math.abs(nearX - cell.x) + cell.y - shelf.topRow;
    if (cost < distance) {
      closest = cell;
      distance = cost;
    }
  }
  return closest;
}

function canClimbRise(rise: number): boolean {
  return rise >= 0 && rise <= MAX_CLIMB_RISE;
}

function canReachLanding(shelf: ShelfTop, landing: Point): boolean {
  return (
    canClimbRise(shelf.topRow - landing.y) &&
    shelf.base.some(cell => Math.abs(cell.x - landing.x) <= 1)
  );
}

function getShelfSurface(shelf: ShelfTop): Point[] {
  if (shelf.roof.length) return shelf.roof;
  const columns = new Set(shelf.base.map(cell => cell.x));
  return [...columns].map(x => ({ x, y: shelf.topRow }));
}

function getShelfCenterSteps(node: SearchNode, landing: Point): ClimbStep[] {
  const steps: ClimbStep[] = [{ kind: 'landing', x: landing.x, y: landing.y }];
  let step: SearchNode | ClimbStep = node;
  while ('shelf' in step) {
    const { shelf, previous }: SearchNode = step;
    const surface = getShelfSurface(shelf);
    const columns = surface.map(cell => cell.x);
    const centerX = (Math.min(...columns) + Math.max(...columns)) / 2;
    const center = surface.reduce((best, cell) => {
      const distance = Math.abs(cell.x - centerX);
      const bestDistance = Math.abs(best.x - centerX);
      return distance < bestDistance || (distance === bestDistance && cell.y < best.y) ? cell : best;
    });
    steps.push({ kind: 'roof', instanceId: shelf.instanceId, ...center });
    step = previous;
  }
  steps.push(step);
  return steps.reverse();
}

function getClosestWaypoint(cells: readonly Point[], next: Point): Point {
  let closest = cells[0];
  let distance = Infinity;
  for (const cell of cells) {
    const cost = Math.abs(cell.x - next.x) + Math.abs(cell.y - next.y);
    if (cost < distance) {
      closest = cell;
      distance = cost;
    }
  }
  return closest;
}

/** Return exit-to-entry waypoints, following painted cells when they connect. */
function getShelfWaypoints(scene: Scene, surface: readonly Point[], entry: Point, exit: Point): Point[] {
  const cells = new Map(surface.map(cell => [getCellIndex(scene, cell), cell]));
  const queue = [entry];
  const previous = new Map<Point, Point | undefined>([[entry, undefined]]);
  for (const waypoint of queue) {
    if (waypoint === exit) {
      const path = [];
      for (let cell: Point | undefined = exit; cell; cell = previous.get(cell)) path.push(cell);
      return path;
    }
    for (const point of getWorldCells(scene, waypoint, NEIGHBORS)) {
      const cell = cells.get(getCellIndex(scene, point));
      if (!cell || previous.has(cell)) continue;
      previous.set(cell, waypoint);
      queue.push(cell);
    }
  }
  // A missing connection in the art doesn't invalidate the logical climb.
  return [exit];
}

function getStepsToLanding(
  scene: Scene,
  bases: ReadonlyMap<number, string>,
  node: SearchNode,
  landing: Point,
  keepFloorAnchor: boolean,
): ClimbStep[] {
  const steps: ClimbStep[] = [{ kind: 'landing', x: landing.x, y: landing.y }];
  let step: SearchNode | ClimbStep = node;
  let next = landing;
  while ('shelf' in step) {
    const { shelf, previous }: SearchNode = step;
    const surface = getShelfSurface(shelf);
    const exit = getClosestWaypoint(surface, next);
    const from: Point =
      'shelf' in previous
        ? getClosestWaypoint(getShelfSurface(previous.shelf), exit)
        : keepFloorAnchor
          ? previous
          : (getFloorEntry(scene, bases, shelf, exit.x) ?? previous);
    const entry = getClosestWaypoint(surface, from);
    const waypoints = getShelfWaypoints(scene, surface, entry, exit);
    for (const point of waypoints) steps.push({ kind: 'roof', instanceId: shelf.instanceId, ...point });
    next = waypoints[waypoints.length - 1];
    step = 'shelf' in previous ? previous : { kind: 'floor', x: from.x, y: from.y };
  }
  steps.push(step);
  return steps.reverse();
}
