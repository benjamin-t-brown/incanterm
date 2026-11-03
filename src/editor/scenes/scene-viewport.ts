export const SCENE_ZOOM_STEPS = [0.35, 0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3, 4, 5, 6, 7, 8];
const MIN_ZOOM = SCENE_ZOOM_STEPS[0];
const MAX_ZOOM = 8;

export type SceneView = { zoom: number; x: number; y: number };

export function fitSceneView(
  viewWidth: number,
  viewHeight: number,
  mapWidth: number,
  mapHeight: number,
): SceneView {
  if (viewWidth <= 0 || viewHeight <= 0 || mapWidth <= 0 || mapHeight <= 0)
    return { zoom: 1, x: 0, y: 0 };
  const zoom = Math.max(
    MIN_ZOOM,
    Math.min(MAX_ZOOM, (viewWidth - 64) / mapWidth, (viewHeight - 64) / mapHeight),
  );
  return {
    zoom,
    x: Math.round((viewWidth - mapWidth * zoom) / 2),
    y: Math.round((viewHeight - mapHeight * zoom) / 2),
  };
}

export function zoomSceneView(
  view: SceneView,
  zoom: number,
  anchorX: number,
  anchorY: number,
): SceneView {
  const next = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom));
  return {
    zoom: next,
    x: anchorX - ((anchorX - view.x) * next) / view.zoom,
    y: anchorY - ((anchorY - view.y) * next) / view.zoom,
  };
}

export function getSceneCellAt(
  view: SceneView,
  px: number,
  py: number,
  cellWidth: number,
  cellHeight: number,
): { x: number; y: number } {
  return {
    x: Math.floor((px - view.x) / (cellWidth * view.zoom)),
    y: Math.floor((py - view.y) / (cellHeight * view.zoom)),
  };
}
