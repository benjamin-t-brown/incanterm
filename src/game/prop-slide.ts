export const SLIDE_DIRECTIONS = ['left', 'right', 'up', 'down'] as const;
export type SlideDirection = (typeof SLIDE_DIRECTIONS)[number];
export type SlideCell = Readonly<{ x: number; y: number }>;

export type PropSlideArea = Readonly<{
  /** Row-major scene indexes, independent of walking masks. */
  travelCells: readonly number[];
  directions: Readonly<Record<SlideDirection, SlideCell>>;
}>;

export type Slidable = Readonly<{
  /**
   * Offsets from the placement anchor: scene cell minus prop position.
   * For a sprite-local cell, subtract the sprite origin to get this offset.
   */
  footprint: readonly SlideCell[];
  actionScript: string;
  /** Preferred player stand cells relative to the prop anchor, by push direction. */
  standOffsets?: Readonly<Partial<Record<SlideDirection, SlideCell>>>;
}>;

export type SlideBoard = {
  width: number;
  height: number;
  area: PropSlideArea;
  slidableProps: ReadonlyMap<string, Slidable>;
};
/** Scene documents bind actions; only older documents carry inline offsets. */
export type SlideBinding = Omit<Slidable, 'footprint'> & { footprint?: readonly SlideCell[] };

export function getPropSlideFootprint(
  asset: { slideCells?: readonly number[]; width: number },
  origin: { originX: number; originY: number },
): SlideCell[] | undefined {
  return asset.slideCells?.map(cell => ({
    x: cell % asset.width - origin.originX,
    y: Math.floor(cell / asset.width) - origin.originY,
  }));
}
export type SlidePositions = ReadonlyMap<string, SlideCell>;

export type SlideObstruction =
  | { cell: SlideCell; reason: 'outside-travel' }
  | { cell: SlideCell; reason: 'prop'; instanceId: string };

export type SlidePathResult =
  | {
      ok: true;
      /** Legal anchors in order, excluding the starting anchor. */
      path: SlideCell[];
      finalAnchor: SlideCell;
      /** If multiple cells are obstructed at the same step, footprint order breaks ties. */
      obstruction: SlideObstruction;
    }
  | { ok: false; error: string };

/** Build the same query input from editor entities or current runtime entities. */
export function getSceneSlideSetup(scene: {
  width: number;
  height: number;
  propSlide?: PropSlideArea;
  entities: readonly { id: string; x: number; y: number; slidable?: SlideBinding }[];
}, footprints?: ReadonlyMap<string, readonly SlideCell[]>): { board: SlideBoard; positions: SlidePositions } | undefined {
  if (!scene.propSlide) return undefined;
  const slidableProps = new Map<string, Slidable>();
  const positions = new Map<string, SlideCell>();
  for (const entity of scene.entities) {
    if (!entity.slidable) continue;
    slidableProps.set(entity.id, { ...entity.slidable, footprint: footprints?.get(entity.id) ?? entity.slidable.footprint ?? [] });
    positions.set(entity.id, { x: entity.x, y: entity.y });
  }
  return {
    board: { width: scene.width, height: scene.height, area: scene.propSlide, slidableProps },
    positions,
  };
}

export function isSlideVector(cell: { x: unknown; y: unknown }): cell is SlideCell {
  return (
    typeof cell.x === 'number' &&
    typeof cell.y === 'number' &&
    Number.isInteger(cell.x) &&
    Number.isInteger(cell.y) &&
    Math.max(Math.abs(cell.x), Math.abs(cell.y)) === 1
  );
}

export function getSlideLayoutError(board: SlideBoard, positions: SlidePositions): string | undefined {
  const layout = getSlideLayout(board, positions);
  return layout.ok ? undefined : layout.error;
}

function getSlideLayout(
  board: SlideBoard,
  positions: SlidePositions,
):
  | { ok: true; travel: ReadonlySet<number>; occupied: ReadonlyMap<number, string> }
  | { ok: false; error: string } {
  const travel = new Set(board.area.travelCells);
  const occupied = new Map<number, string>();
  for (const [id, { footprint }] of board.slidableProps) {
    const anchor = positions.get(id);
    if (!anchor || !Number.isSafeInteger(anchor.x) || !Number.isSafeInteger(anchor.y))
      return { ok: false, error: `Prop ${id} needs an integer placement anchor` };
    if (!footprint.length)
      return { ok: false, error: `Prop ${id} needs a nonempty slide footprint` };
    for (const offset of footprint) {
      if (!Number.isSafeInteger(offset.x) || !Number.isSafeInteger(offset.y))
        return { ok: false, error: `Prop ${id} slide footprint offsets must be integers` };
      // Both the authored anchor and the painted cell are inside the scene.
      if (Math.abs(offset.x) >= board.width || Math.abs(offset.y) >= board.height)
        return { ok: false, error: `Prop ${id} slide footprint offset is outside scene bounds` };
      const cell = getTranslatedCell(anchor, offset);
      const index = getTravelIndex(board, travel, cell);
      if (index === undefined)
        return {
          ok: false,
          error: `Prop ${id} footprint cell (${cell.x}, ${cell.y}) starts outside prop travel`,
        };
      const owner = occupied.get(index);
      if (owner === id)
        return { ok: false, error: `Prop ${id} slide footprint offsets must be unique` };
      if (owner !== undefined)
        return {
          ok: false,
          error: `Prop ${id} overlaps prop ${owner} at (${cell.x}, ${cell.y})`,
        };
      occupied.set(index, id);
    }
  }
  return { ok: true, travel, occupied };
}

function getTranslatedCell(anchor: SlideCell, offset: SlideCell): SlideCell {
  return { x: anchor.x + offset.x, y: anchor.y + offset.y };
}

function getTravelIndex(
  board: SlideBoard,
  travel: ReadonlySet<number>,
  { x, y }: SlideCell,
): number | undefined {
  if (x < 0 || x >= board.width || y < 0 || y >= board.height) return undefined;
  const index = y * board.width + x;
  return travel.has(index) ? index : undefined;
}

export function getSlidePath(
  board: SlideBoard,
  positions: SlidePositions,
  instanceId: string,
  direction: SlideDirection,
): SlidePathResult {
  const prop = board.slidableProps.get(instanceId);
  if (!prop) return { ok: false, error: `Unknown sliding prop ${instanceId}` };
  const vector = board.area.directions[direction];
  if (!vector || !isSlideVector(vector))
    return { ok: false, error: `Prop slide direction ${direction} needs a nonzero unit vector` };
  const start = positions.get(instanceId);
  if (!start) return { ok: false, error: `Prop ${instanceId} needs a placement anchor` };
  const layout = getSlideLayout(board, positions);
  if (!layout.ok) return layout;

  const path: SlideCell[] = [];
  let finalAnchor: SlideCell = { ...start };
  // Diagonals are one step: test the translated footprint, not corner clearance.
  while (true) {
    const next = getTranslatedCell(finalAnchor, vector);
    for (const offset of prop.footprint) {
      const cell = getTranslatedCell(next, offset);
      const index = getTravelIndex(board, layout.travel, cell);
      if (index === undefined)
        return { ok: true, path, finalAnchor, obstruction: { cell, reason: 'outside-travel' } };
      const owner = layout.occupied.get(index);
      if (owner !== undefined && owner !== instanceId)
        return {
          ok: true,
          path,
          finalAnchor,
          obstruction: { cell, reason: 'prop', instanceId: owner },
        };
    }
    path.push(next);
    finalAnchor = next;
  }
}
