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
