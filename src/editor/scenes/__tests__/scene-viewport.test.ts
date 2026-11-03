import { describe, expect, it } from 'vitest';
import { fitSceneView, getSceneCellAt, zoomSceneView } from '../scene-viewport.js';

describe('scene viewport', () => {
  it('fits and centers the scene within the available space', () => {
    const view = fitSceneView(928, 576, 120 * 12, 40 * 20);
    expect(view.zoom).toBe(0.6);
    expect(view.x).toBe(32);
    expect(view.y).toBe(48);
  });

  it('keeps the pointed-at cell fixed when zooming and maps pointer coordinates after panning', () => {
    const original = { zoom: 1, x: 40, y: 20 };
    const zoomed = zoomSceneView(original, 2, 160, 120);
    expect(zoomed).toEqual({ zoom: 2, x: -80, y: -80 });
    expect(getSceneCellAt(original, 160, 120, 12, 20)).toEqual({ x: 10, y: 5 });
    expect(getSceneCellAt(zoomed, 160, 120, 12, 20)).toEqual({ x: 10, y: 5 });
  });
});
