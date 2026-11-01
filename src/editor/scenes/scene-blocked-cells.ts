import type { PropDocument, SceneEntity } from '../schema.js';

// Paint a continuous stroke into the scene's sparse row-major blocked-cell list.
export function paintSceneBlockedCells(
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

export function propBlockedSceneCells(
  entry: Extract<SceneEntity, { type: 'Prop' }>,
  prop: PropDocument,
  origin: { originX: number; originY: number },
  scene: { width: number; height: number },
): Array<{ x: number; y: number }> {
  return prop.blockedCells
    .map((index) => ({
      x: entry.x - origin.originX + (index % prop.width),
      y: entry.y - origin.originY + Math.floor(index / prop.width),
    }))
    .filter(({ x, y }) => x >= 0 && y >= 0 && x < scene.width && y < scene.height);
}
