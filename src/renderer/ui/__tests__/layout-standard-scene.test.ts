import { describe, expect, it } from 'vitest';
import { CellBuffer } from '../../../game/cell-buffer.js';
import { Prop, Scene } from '../../../game/scene.js';
import { Sprite } from '../../../game/sprite.js';
import { loadScene, getDefaultAssetsRoot, TEST_SCENE_ID } from '../../../game/load-scene.js';
import { getPlainText } from '../../../game/terminal.js';
import {
  LayoutStandardScene,
  ERROR_LOG_FG,
  STANDARD_BACKGROUND,
  STANDARD_HEIGHT,
  STANDARD_UI_HEIGHT,
  STANDARD_WIDTH,
  STANDARD_WORLD_HEIGHT,
} from '../layout-standard-scene.js';
import { renderStandardUiPreview } from '../standard-ui.js';

describe('LayoutStandardScene', () => {
  it('colors error entries and all their wrapped lines red without recoloring normal entries', () => {
    const scene = new Scene('room', 3, 3, 'regular-z', STANDARD_BACKGROUND, []);
    const layout = new LayoutStandardScene(scene);
    layout.appendLog('Ordinary log');
    layout.appendLog(`[RPGSCRIPT ERROR] ${'missing marker '.repeat(20)}`, true);
    layout.render(new CellBuffer(80, 24, STANDARD_BACKGROUND));
    expect(layout.scriptLog.lineColors?.[0]).toEqual(layout.scriptLog.fg);
    expect(layout.scriptLog.lineColors?.slice(1).length).toBeGreaterThan(1);
    expect(layout.scriptLog.lineColors?.slice(1).every((color) => color === ERROR_LOG_FG)).toBe(true);
  });

  async function createFrame(cols: number, rows: number): Promise<string[]> {
    const scene = await loadScene(getDefaultAssetsRoot(), TEST_SCENE_ID);
    const layout = new LayoutStandardScene(scene);
    layout.message.text = 'Guide: The crate is waiting for you.';
    const buffer = new CellBuffer(cols, rows, STANDARD_BACKGROUND);
    layout.render(buffer);
    return getPlainText(buffer).split('\n');
  }

  it('overlays the bottom 16 rows of the 120x40 scene viewport', async () => {
    expect(STANDARD_WORLD_HEIGHT).toBe(40);
    expect(STANDARD_UI_HEIGHT).toBe(16);
    const lines = await createFrame(STANDARD_WIDTH, STANDARD_HEIGHT);
    expect(lines).toHaveLength(40);
    expect(lines[23]).not.toContain('=');
    expect(lines[24]).toBe('='.repeat(120));
    expect(lines[25]).toBe(`╔${'═'.repeat(118)}╗`);
    expect(lines.slice(25).join('\n')).not.toContain('Inventory');
    expect(lines.slice(25).join('\n')).toContain('Guide: The crate is waiting for you.');
    expect(lines.slice(0, 24).join('\n')).toContain('| # |');
  });

  it('keeps scene coordinates stable beneath the overlay and blocks click-through', () => {
    const sprite = new Sprite('marker', 1, 1, 0, 0, [{ ...STANDARD_BACKGROUND, ch: 'X' }]);
    const scene = new Scene('room', 120, 40, 'regular-z', STANDARD_BACKGROUND, [
      new Prop('upper', 10, 10, 0, 0, sprite),
      new Prop('covered', 10, 30, 0, 0, sprite),
    ]);
    const layout = new LayoutStandardScene(scene);
    const buffer = new CellBuffer(120, 40, STANDARD_BACKGROUND);
    layout.render(buffer);
    expect(buffer.get(10, 10).ch).toBe('X');
    expect(buffer.get(10, 30).ch).not.toBe('X');
    expect(layout.getScenePoint(10, 10)).toEqual({ x: 10, y: 10 });
    expect(layout.getScenePoint(10, 30)).toBeUndefined();
    layout.ui.visible = false;
    layout.render(buffer);
    expect(buffer.get(10, 10).ch).toBe('X');
    expect(buffer.get(10, 30).ch).toBe('X');
    expect(layout.getScenePoint(10, 30)).toEqual({ x: 10, y: 30 });

    layout.ui.visible = true;
    layout.render(new CellBuffer(80, 24, STANDARD_BACKGROUND));
    expect(layout.getScenePoint(10, 4)).toEqual({ x: 30, y: 20 });
    expect(layout.getScenePoint(10, 8)).toBeUndefined();
    expect(layout.getScenePoint(-1, 4)).toBeUndefined();
  });

  it('renders the same default UI for an editor-only preview', async () => {
    const scene = await loadScene(getDefaultAssetsRoot(), TEST_SCENE_ID);
    const layout = new LayoutStandardScene(scene);
    const buffer = new CellBuffer(120, 40, STANDARD_BACKGROUND);
    layout.render(buffer);
    expect(getPlainText(renderStandardUiPreview(120)).split('\n')).toEqual(
      getPlainText(buffer).split('\n').slice(24),
    );
  });

  it('centers the full canvas on a larger terminal', async () => {
    const lines = await createFrame(140, 50);
    expect(lines[0]).toBe(' '.repeat(140));
    expect(lines[29]).toBe(`${' '.repeat(10)}${'='.repeat(120)}${' '.repeat(10)}`);
    expect(lines.slice(30).join('\n')).toContain('Guide: The crate is waiting for you.');
  });

  it('keeps the UI and center of the world visible on smaller terminals', async () => {
    const medium = await createFrame(80, 24);
    expect(medium[8]).toBe('='.repeat(80));
    expect(medium.slice(0, 8).join('\n')).toContain('| # |');
    expect(medium.slice(9).join('\n')).toContain('Guide: The crate is waiting for you.');

    const small = await createFrame(40, 16);
    expect(small[4]).toBe('='.repeat(40));
    expect(small[5]).toBe(`╔${'═'.repeat(38)}╗`);
    expect(small.slice(0, 4).join('\n')).toContain('#');
    expect(small.slice(5).join('\n')).toContain('Guide: The crate is waiting for');
    expect(small.slice(5).join('\n')).toContain('you.');
  });

  it('reports when the terminal is below the minimum supported size', async () => {
    const lines = await createFrame(30, 12);
    expect(lines.join('\n')).toContain('Terminal needs at least');
  });

  it('reflows the same component when shrinking, growing, and recovering from an undersized view', async () => {
    const scene = await loadScene(getDefaultAssetsRoot(), TEST_SCENE_ID);
    const layout = new LayoutStandardScene(scene);
    layout.message.text = 'Guide: The crate is waiting for you.';
    const render = (cols: number, rows: number): string[] => {
      const buffer = new CellBuffer(cols, rows, STANDARD_BACKGROUND);
      layout.render(buffer);
      return getPlainText(buffer).split('\n');
    };

    expect(render(120, 40)[24]).toBe('='.repeat(120));
    const small = render(40, 16);
    expect(small[4]).toBe('='.repeat(40));
    expect(small.slice(5).join('\n')).toContain('Guide: The crate is waiting for');
    expect(render(30, 12).join('\n')).toContain('Terminal needs at least');
    const restored = render(120, 40);
    expect(restored[24]).toBe('='.repeat(120));
    expect(restored.slice(25).join('\n')).toContain('Guide: The crate is waiting for you.');
  });
});
