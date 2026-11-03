export type DepthMode = 'bottom-up' | 'regular-z';

export function getSceneDepth(
  mode: DepthMode,
  y: number,
  z: number,
  depthOffset = 0,
  groundOffsetY = 0,
): number {
  return mode === 'bottom-up' ? y + groundOffsetY + depthOffset : z + depthOffset;
}

export type DrawRank = { background: boolean; depth: number; order: number };

export function compareSceneDrawRank(a: DrawRank, b: DrawRank): number {
  return Number(b.background) - Number(a.background) || a.depth - b.depth || a.order - b.order;
}
