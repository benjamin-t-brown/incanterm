import { findExactPath, findNearestWalkAnchor, isWalkAnchorClear, type Point } from './character-movement.js';
import type { Character } from './character.js';
import type { PlayerControl } from './player-control.js';
import { Prop, type Scene } from './scene.js';
import {
  getSceneSlideSetup, getSlidePath, SLIDE_DIRECTIONS,
  type SlideCell, type SlideDirection, type SlidePositions,
} from './prop-slide.js';

export const PROP_SLIDE_STEP_MS = 120;

export type PropSlideSettle = Readonly<{
  sceneId: string;
  instanceId: string;
  from: SlideCell;
  to: SlideCell;
}>;

type Stand = { point: Point; cell: Point; contact: Point; length: number };
type PropSlideOperation = {
  scene: Scene;
  player: Character;
  prop: Prop;
  from: SlideCell;
  stand?: Stand;
  dodging?: boolean;
  direction?: SlideDirection;
  finish: (settled: boolean) => void;
  motion?: { positions: SlidePositions; path: SlideCell[]; playerAnchor: Point; index: number; elapsedMs: number };
};
type GetSlideResult = () => boolean | undefined;
type SlideSetup = NonNullable<ReturnType<typeof getSceneSlideSetup>>;
const APPROACH_VECTORS = [-1, 0, 1].flatMap(y =>
  [-1, 0, 1].filter(x => x !== 0 || y !== 0).map(x => ({ x, y })));

function isSamePoint(a: SlideCell, b: SlideCell): boolean {
  return a.x === b.x && a.y === b.y;
}

function isAtStand(player: Character, point: Point): boolean {
  return player.x === point.x && player.bottomY === point.y;
}

function getDistanceSquared(a: Point, b: Point): number {
  return (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
}

function getStandOverCell(
  scene: Scene, player: Character, cell: Point, contact: Point,
): Stand | undefined {
  const exact = findExactPath(scene, player, cell);
  if (exact) return { point: cell, cell, contact, length: exact.length };
  let best: Stand | undefined;
  // A stand cell can be under any column of the player's feet. Navigation
  // still checks all those columns against the walking mask.
  for (let column = 0; column < player.sprite.width; column++) {
    const point = { x: cell.x + player.sprite.originX - column, y: cell.y };
    const path = findExactPath(scene, player, point);
    if (path && (!best || path.length < best.length))
      best = { point, cell, contact, length: path.length };
  }
  return best;
}

function getAuthoredStand(
  scene: Scene, player: Character, prop: Prop, direction: SlideDirection,
): Stand | undefined {
  if (!prop.slidable) return;
  const { footprint, standOffsets } = prop.slidable;
  const override = standOffsets?.[direction];
  if (!override || footprint.some(cell => isSamePoint(cell, override))) return;
  const contact = footprint.reduce<SlideCell | undefined>((best, cell) =>
    !best || getDistanceSquared(override, cell) < getDistanceSquared(override, best) ? cell : best, undefined);
  return contact && getStandOverCell(scene, player,
    { x: prop.x + override.x, y: prop.y + override.y },
    { x: prop.x + contact.x, y: prop.y + contact.y });
}

function getAutomaticStand(
  scene: Scene, player: Character, prop: Prop, vectors: readonly SlideCell[],
): Stand | undefined {
  // Use the walking boundary for character staging. Props with no walking
  // blockers can still be approached using their slide footprint.
  const offsets = prop.blockingOffsets.length ? prop.blockingOffsets : prop.slidable?.footprint ?? [];
  const occupied = new Set(offsets.map(({ x, y }) => `${x},${y}`));
  const candidates = new Map<string, { cell: Point; contact: Point; distance: number }>();
  for (const offset of offsets) {
    const contact = { x: prop.x + offset.x, y: prop.y + offset.y };
    if (contact.x < 0 || contact.x >= scene.width || contact.y < 0 || contact.y >= scene.height) continue;
    for (const vector of vectors) {
      if (occupied.has(`${offset.x - vector.x},${offset.y - vector.y}`)) continue;
      const cell = { x: contact.x - vector.x, y: contact.y - vector.y };
      if (cell.x < 0 || cell.x >= scene.width || cell.y < 0 || cell.y >= scene.height) continue;
      const distance = Math.abs(vector.x) + Math.abs(vector.y);
      for (let column = 0; column < player.sprite.width; column++) {
        const key = `${cell.x + player.sprite.originX - column},${cell.y}`;
        const existing = candidates.get(key);
        if (!existing || distance < existing.distance) candidates.set(key, { cell, contact, distance });
      }
    }
  }
  if (!candidates.size) return;
  const point = findNearestWalkAnchor(scene, player, ({ x, y }) => candidates.has(`${x},${y}`));
  if (!point) return;
  const candidate = candidates.get(`${point.x},${point.y}`);
  const path = findExactPath(scene, player, point);
  if (candidate && path) return { point, cell: candidate.cell, contact: candidate.contact, length: path.length };
}

function getReachableStand(scene: Scene, player: Character, prop: Prop, direction?: SlideDirection): Stand | undefined {
  if (direction) {
    if (prop.slidable?.standOffsets?.[direction]) return getAuthoredStand(scene, player, prop, direction);
    const vector = scene.propSlide?.directions[direction];
    return vector && getAutomaticStand(scene, player, prop, [vector]);
  }
  let best = getAutomaticStand(scene, player, prop, APPROACH_VECTORS);
  for (const side of SLIDE_DIRECTIONS) {
    const stand = getAuthoredStand(scene, player, prop, side);
    if (stand && (!best || stand.length < best.length)) best = stand;
  }
  return best;
}

function setFacingTowardProp(player: Character, stand: Stand): void {
  const dx = stand.contact.x - stand.cell.x;
  const dy = stand.contact.y - stand.cell.y;
  player.facing = Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
  player.animate(0);
}

function getSweptSlideCells(scene: Scene, prop: Prop, path: readonly SlideCell[]): ReadonlySet<number> {
  const cells = new Set<number>();
  // Use both masks to stage the player, but never feed walking blockers into
  // the slide solver. They must not change the route or stop.
  const offsets = [...(prop.slidable?.footprint ?? []), ...prop.blockingOffsets];
  for (const anchor of path) {
    for (const offset of offsets) {
      const x = anchor.x + offset.x;
      const y = anchor.y + offset.y;
      if (x >= 0 && x < scene.width && y >= 0 && y < scene.height) cells.add(y * scene.width + x);
    }
  }
  return cells;
}

/** One session-owned operation; only the session clock advances anchors or emits a commit. */
export class PropSlideControl {
  private operation?: PropSlideOperation;

  constructor(private readonly control: PlayerControl, private readonly onSettle?: (event: PropSlideSettle) => void) {}

  private getTarget(instanceId: string): { scene: Scene; prop: Prop; player: Character } | undefined {
    const { scene, playerWalkCh: player } = this.control;
    const prop = scene.entities.find((entity) => entity instanceof Prop && entity.slidable && entity.id === instanceId);
    if (!scene.propSlide || !(prop instanceof Prop) || !player || !scene.entities.includes(player)) return;
    return { scene, prop, player };
  }

  private getPushPath(setup: SlideSetup, instanceId: string, direction: SlideDirection): SlideCell[] | undefined {
    const result = getSlidePath(setup.board, setup.positions, instanceId, direction);
    if (result.ok && result.path.length) return result.path;
  }

  canChoosePush(instanceId: string): boolean {
    return !this.operation && this.getTarget(instanceId) !== undefined;
  }

  getPushes(instanceId: string): SlideDirection[] {
    const target = this.getTarget(instanceId);
    if (!target || this.operation) return [];
    const setup = getSceneSlideSetup(target.scene);
    if (!setup) return [];
    return SLIDE_DIRECTIONS.filter((direction) => this.getPushPath(setup, instanceId, direction));
  }

  startApproach(instanceId: string): GetSlideResult {
    return this.startWalk(instanceId);
  }

  startSlide(instanceId: string, direction: SlideDirection): GetSlideResult {
    return this.startWalk(instanceId, direction);
  }

  private startWalk(instanceId: string, direction?: SlideDirection): GetSlideResult {
    const target = this.getTarget(instanceId);
    if (!target || this.operation) return () => false;
    const { scene, prop, player } = target;
    const setup = getSceneSlideSetup(scene);
    if (!setup || (direction && !this.getPushPath(setup, instanceId, direction))) return () => false;
    const stand = getReachableStand(scene, player, prop, direction);
    if (!stand && !direction) return () => false;
    let result: boolean | undefined;
    const operation: PropSlideOperation = {
      ...target, from: { x: prop.x, y: prop.y }, stand, direction,
      finish: (settled) => { result = settled; },
    };
    this.operation = operation;
    if (stand) this.control.walkScripted(player, stand.point, true);
    this.update(0);
    return () => result;
  }

  /** Roll back synchronously; a cancelled operation never emits a settle event. */
  cancel(): boolean {
    const operation = this.operation;
    if (!operation) return false;
    this.operation = undefined;
    if (operation.motion) {
      operation.prop.x = operation.from.x;
      operation.prop.y = operation.from.y;
    }
    this.control.stopCharacter(operation.player);
    operation.finish(false);
    return true;
  }

  update(deltaMs: number): void {
    const operation = this.operation;
    if (!operation) return;
    const { scene, player, prop, from, stand, motion, direction } = operation;
    const expected = motion?.path[motion.index - 1] ?? from;
    if (scene !== this.control.scene || player !== this.control.playerWalkCh ||
      !scene.entities.includes(player) || !scene.entities.includes(prop) ||
      !isSamePoint(prop, expected) || ((stand || operation.dodging) && this.control.wasWalkCancelled(player))) {
      this.cancel();
      return;
    }
    if (motion) {
      this.advanceSlide(operation, motion, deltaMs);
      return;
    }
    if (player.isWalking()) return;
    const reached = !operation.dodging && stand && isAtStand(player, stand.point) &&
      findExactPath(scene, player, stand.point) !== undefined;
    if (reached) setFacingTowardProp(player, stand);
    if (!direction) {
      this.operation = undefined;
      operation.finish(!!reached);
      return;
    }
    // A choice can go stale while the player is walking to the pushing side.
    const setup = getSceneSlideSetup(scene);
    const path = setup && this.getPushPath(setup, prop.id, direction);
    if (!setup || !path) {
      this.cancel();
      return;
    }
    const playerAnchor = { x: player.x, y: player.bottomY };
    if (!reached) {
      const swept = getSweptSlideCells(scene, prop, path);
      const isClearOfSlide = ({ x, y }: Point) => isWalkAnchorClear(scene, player, x, y, swept);
      if (!isClearOfSlide(playerAnchor)) {
        const safe = operation.dodging ? undefined : findNearestWalkAnchor(scene, player, isClearOfSlide);
        if (!safe) {
          this.cancel();
          return;
        }
        operation.dodging = true;
        this.control.walkScripted(player, safe, true);
        return;
      }
    }
    operation.motion = { positions: setup.positions, path, playerAnchor, index: 0, elapsedMs: 0 };
  }

  private advanceSlide(operation: PropSlideOperation, motion: NonNullable<PropSlideOperation['motion']>, deltaMs: number): void {
    const { scene, player, prop, from } = operation;
    if (player.isWalking() || !isAtStand(player, motion.playerAnchor)) {
      this.cancel();
      return;
    }
    motion.elapsedMs += deltaMs;
    if (motion.elapsedMs < PROP_SLIDE_STEP_MS) return;
    const positions = getSceneSlideSetup(scene)?.positions;
    if (!positions || positions.size !== motion.positions.size ||
      [...positions].some(([id, anchor]) => {
        const previous = motion.positions.get(id);
        return id !== prop.id && (!previous || !isSamePoint(anchor, previous));
      })) {
      this.cancel();
      return;
    }
    while (motion.elapsedMs >= PROP_SLIDE_STEP_MS && motion.index < motion.path.length) {
      motion.elapsedMs -= PROP_SLIDE_STEP_MS;
      const anchor = motion.path[motion.index++];
      prop.x = anchor.x;
      prop.y = anchor.y;
    }
    if (motion.index === motion.path.length) {
      this.operation = undefined;
      this.onSettle?.({ sceneId: scene.id, instanceId: prop.id, from: { ...from }, to: { x: prop.x, y: prop.y } });
      operation.finish(true);
    }
  }
}
