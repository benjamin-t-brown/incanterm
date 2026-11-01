// Blocked cells are sparse, row-major indexes into the prop footprint.
export function resizeBlockedCells(
  cells: readonly number[],
  oldWidth: number,
  newWidth: number,
  newHeight: number,
): number[] {
  return cells
    .map((index) => ({ x: index % oldWidth, y: Math.floor(index / oldWidth) }))
    .filter(({ x, y }) => x < newWidth && y < newHeight)
    .map(({ x, y }) => y * newWidth + x)
    .sort((a, b) => a - b);
}

export type BlockPreviewGrid = { x: number; y: number; cellWidth: number; cellHeight: number };

export function blockPreviewGrid(
  canvas: { width: number; height: number },
  footprint: { width: number; height: number },
  sprite: { width: number; height: number; cellWidth: number; cellHeight: number } | null,
): BlockPreviewGrid {
  const width = Math.max(footprint.width, sprite?.width ?? 0);
  const height = Math.max(footprint.height, sprite?.height ?? 0);
  const scale = sprite
    ? Math.min(
        4,
        (canvas.width - 12) / (width * sprite.cellWidth),
        (canvas.height - 12) / (height * sprite.cellHeight),
      )
    : Math.min(30, (canvas.width - 12) / width, (canvas.height - 12) / height);
  const cellWidth = (sprite?.cellWidth ?? 1) * scale;
  const cellHeight = (sprite?.cellHeight ?? 1) * scale;
  return {
    x: Math.floor((canvas.width - width * cellWidth) / 2),
    y: Math.floor((canvas.height - height * cellHeight) / 2),
    cellWidth,
    cellHeight,
  };
}

export function blockPreviewPoint(
  point: { x: number; y: number },
  grid: BlockPreviewGrid,
  footprint: { width: number; height: number },
): { x: number; y: number } | null {
  const x = Math.floor((point.x - grid.x) / grid.cellWidth);
  const y = Math.floor((point.y - grid.y) / grid.cellHeight);
  return x >= 0 && x < footprint.width && y >= 0 && y < footprint.height ? { x, y } : null;
}

export function paintPropBlockedCells(
  cells: readonly number[],
  width: number,
  from: { x: number; y: number },
  to: { x: number; y: number },
  blocked: boolean,
): number[] {
  const next = new Set(cells);
  let { x, y } = from;
  const dx = Math.abs(to.x - x);
  const dy = Math.abs(to.y - y);
  const sx = x < to.x ? 1 : -1;
  const sy = y < to.y ? 1 : -1;
  let error = dx - dy;
  while (true) {
    const index = y * width + x;
    if (blocked) next.add(index);
    else next.delete(index);
    if (x === to.x && y === to.y) break;
    const twice = 2 * error;
    if (twice > -dy) {
      error -= dy;
      x += sx;
    }
    if (twice < dx) {
      error += dx;
      y += sy;
    }
  }
  return [...next].sort((a, b) => a - b);
}
