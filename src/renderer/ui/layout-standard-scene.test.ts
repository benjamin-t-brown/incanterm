import { describe, expect, it } from 'vitest';
import { CellBuffer } from '../../game/cell-buffer.js';
import { loadScene, defaultAssetsRoot, TEST_SCENE_ID } from '../../game/load-scene.js';
import { plainText } from '../../game/terminal.js';
import {
  LayoutStandardScene,
  STANDARD_BACKGROUND,
  STANDARD_HEIGHT,
  STANDARD_UI_HEIGHT,
  STANDARD_WIDTH,
  STANDARD_WORLD_HEIGHT,
} from './layout-standard-scene.js';
import { renderStandardUiPreview } from './standard-ui.js';

describe('LayoutStandardScene', () => {
  async function frame(cols: number, rows: number): Promise<string[]> {
    const scene = await loadScene(defaultAssetsRoot(), TEST_SCENE_ID);
    const layout = new LayoutStandardScene(scene);
    layout.message.text = 'Guide: The crate is waiting for you.';
    const buffer = new CellBuffer(cols, rows, STANDARD_BACKGROUND);
    layout.render(buffer);
    return plainText(buffer).split('\n');
  }

  it('splits a 120x40 canvas into a 24-row world and 16-row UI', async () => {
    expect(STANDARD_WORLD_HEIGHT).toBe(24);
    expect(STANDARD_UI_HEIGHT).toBe(16);
    const lines = await frame(STANDARD_WIDTH, STANDARD_HEIGHT);
    expect(lines).toHaveLength(40);
    expect(lines[23]).not.toContain('=');
    expect(lines[24]).toBe('='.repeat(120));
    expect(lines[25]).toBe(`╔${'═'.repeat(118)}╗`);
    expect(lines.slice(25).join('\n')).not.toContain('Inventory');
    expect(lines.slice(25).join('\n')).toContain('Guide: The crate is waiting for you.');
    expect(lines.slice(0, 24).join('\n')).toContain('| # |');
  });

  it('renders the same default UI for an editor-only preview', async () => {
    const scene = await loadScene(defaultAssetsRoot(), TEST_SCENE_ID);
    const layout = new LayoutStandardScene(scene);
    const buffer = new CellBuffer(120, 40, STANDARD_BACKGROUND);
    layout.render(buffer);
    expect(plainText(renderStandardUiPreview(120)).split('\n')).toEqual(
      plainText(buffer).split('\n').slice(24),
    );
  });

  it('centers the full canvas on a larger terminal', async () => {
    const lines = await frame(140, 50);
    expect(lines[0]).toBe(' '.repeat(140));
    expect(lines[29]).toBe(`${' '.repeat(10)}${'='.repeat(120)}${' '.repeat(10)}`);
    expect(lines.slice(30).join('\n')).toContain('Guide: The crate is waiting for you.');
  });

  it('keeps the UI and center of the world visible on smaller terminals', async () => {
    const medium = await frame(80, 24);
    expect(medium[8]).toBe('='.repeat(80));
    expect(medium.slice(0, 8).join('\n')).toContain('| # |');
    expect(medium.slice(9).join('\n')).toContain('Guide: The crate is waiting for you.');

    const small = await frame(40, 16);
    expect(small[4]).toBe('='.repeat(40));
    expect(small[5]).toBe(`╔${'═'.repeat(38)}╗`);
    expect(small.slice(0, 4).join('\n')).toContain('#');
    expect(small.slice(5).join('\n')).toContain('Guide: The crate is waiting for');
    expect(small.slice(5).join('\n')).toContain('you.');
  });

  it('reports when the terminal is below the minimum supported size', async () => {
    const lines = await frame(30, 12);
    expect(lines.join('\n')).toContain('Terminal needs at least');
  });

  it('reflows the same component when shrinking, growing, and recovering from an undersized view', async () => {
    const scene = await loadScene(defaultAssetsRoot(), TEST_SCENE_ID);
    const layout = new LayoutStandardScene(scene);
    layout.message.text = 'Guide: The crate is waiting for you.';
    const render = (cols: number, rows: number): string[] => {
      const buffer = new CellBuffer(cols, rows, STANDARD_BACKGROUND);
      layout.render(buffer);
      return plainText(buffer).split('\n');
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
