import { describe, expect, it, vi } from 'vitest';
import { CellBuffer, type Cell } from '../../game/cell-buffer.js';
import type { PortraitAsset, PortraitFrame } from '../../game/portrait-assets.js';
import { Scene } from '../../game/scene.js';
import { createGlyphExitFilter, createGlyphGrowthRevealFilter, createPixelateRevealFilter, createTextColorFilter, ScreenFilterPipeline } from '../screen-filters.js';
import { LayoutStandardScene, STANDARD_BACKGROUND } from '../ui/layout-standard-scene.js';

const ink: Cell = { ch: '.', fg: { r: 1, g: 2, b: 3 }, bg: { r: 4, g: 5, b: 6 } };

function getBuffer(): CellBuffer {
  const buffer = new CellBuffer(5, 3, ink);
  for (let y = 0; y < buffer.height; y++) {
    for (let x = 0; x < buffer.width; x++) buffer.set(x, y, { ...ink, ch: String(x + y * 5) });
  }
  return buffer;
}

describe('post-render screen filters', () => {
  it('clears portrait glyphs bottom-to-top without changing spaces or the frame', () => {
    const filters = new ScreenFilterPipeline();
    filters.addFilter(createGlyphExitFilter({ stepDurationMs: 20, rowDelayMs: 10, glyphs: '+:,.' }),
      { x: 1, y: 0, width: 1, height: 2 }, 100);
    function getFrameAt(now: number): CellBuffer {
      const buffer = new CellBuffer(3, 2, { ...ink, ch: 'X' });
      buffer.set(1, 1, { ...ink, ch: ' ' });
      filters.applyFilters(buffer, now);
      return buffer;
    }
    expect(getFrameAt(100).get(1, 0).ch).toBe('X');
    expect(getFrameAt(110).get(1, 0).ch).toBe('+');
    expect(getFrameAt(130).get(1, 0).ch).toBe(':');
    expect(getFrameAt(190).get(1, 0).ch).toBe(' ');
    expect(getFrameAt(190).get(1, 1)).toEqual({ ...ink, ch: ' ' });
    expect(getFrameAt(190).get(0, 0).ch).toBe('X');
  });
  it('applies ordered filters to clipped regions, and removes them independently', () => {
    const filters = new ScreenFilterPipeline();
    const buffer = getBuffer();
    const region = { x: -1, y: 1, width: 3, height: 1 };
    const removeFirst = filters.addFilter((ctx, elapsedMs) => {
      expect(ctx.region).toEqual({ x: 0, y: 1, width: 2, height: 1 });
      expect(elapsedMs).toBe(20);
      expect(() => ctx.setCell(2, 1, ink)).toThrow('outside the screen filter region');
      ctx.setCell(ctx.region.x, ctx.region.y, { ...ink, ch: 'A' });
    }, () => region, 100);
    filters.addFilter((ctx) => {
      expect(ctx.getCell(ctx.region.x, ctx.region.y).ch).toBe('A');
      ctx.setCell(ctx.region.x, ctx.region.y, { ...ink, ch: 'B' });
    }, { x: 0, y: 1, width: 1, height: 1 }, 100);
    filters.applyFilters(buffer, 120);
    expect(buffer.get(0, 1).ch).toBe('B');
    expect(buffer.get(1, 1).ch).toBe('6');
    removeFirst();
    filters.clearFilters();
    filters.applyFilters(buffer, 130);
    expect(buffer.get(4, 0).ch).toBe('4');
  });

  it('resolves a moving region each frame and skips invisible regions', () => {
    const filters = new ScreenFilterPipeline();
    const buffer = getBuffer();
    let region: { x: number; y: number; width: number; height: number } | undefined =
      { x: 1, y: 0, width: 1, height: 1 };
    filters.addFilter((ctx) => ctx.setCell(ctx.region.x, ctx.region.y, { ...ink, ch: 'X' }), () => region);
    filters.applyFilters(buffer);
    region = { x: 4, y: 2, width: 1, height: 1 };
    filters.applyFilters(buffer);
    region = undefined;
    filters.applyFilters(buffer);
    expect(buffer.get(1, 0).ch).toBe('X');
    expect(buffer.get(4, 2).ch).toBe('X');
    expect(buffer.get(0, 0).ch).toBe('0');
  });

  it('pixelates only inside the region, then reveals the original cells', () => {
    const filters = new ScreenFilterPipeline();
    filters.addFilter(createPixelateRevealFilter({ durationMs: 100, blockSize: 3 }),
      { x: 1, y: 0, width: 9, height: 2 }, 100);
    const coarse = getBuffer();
    filters.applyFilters(coarse, 100);
    expect(coarse.get(0, 0).ch).toBe('0');
    expect(coarse.get(1, 0).ch).toBe('1');
    expect(coarse.get(2, 0)).toEqual(coarse.get(1, 0));
    expect(coarse.get(3, 1)).toEqual(coarse.get(1, 0));
    expect(coarse.get(4, 0).ch).toBe('4');
    expect(coarse.get(4, 1)).toEqual(coarse.get(4, 0));
    expect(coarse.get(0, 2).ch).toBe('10');
    const revealed = getBuffer();
    filters.applyFilters(revealed, 200);
    expect(revealed.get(2, 0).ch).toBe('2');
    expect(revealed.get(3, 1).ch).toBe('8');
  });

  it('recolors only non-space glyphs while keeping background and other cells intact', () => {
    const buffer = new CellBuffer(3, 1, ink);
    buffer.set(0, 0, { ...ink, ch: 'A' });
    buffer.set(1, 0, { ...ink, ch: ' ' });
    buffer.set(2, 0, { ...ink, ch: 'B' });
    const filters = new ScreenFilterPipeline();
    filters.addFilter(createTextColorFilter({ r: 128, g: 128, b: 128 }), { x: 0, y: 0, width: 2, height: 1 });
    filters.applyFilters(buffer);
    expect(buffer.get(0, 0)).toEqual({ ...ink, ch: 'A', fg: { r: 128, g: 128, b: 128 } });
    expect(buffer.get(1, 0)).toEqual({ ...ink, ch: ' ' });
    expect(buffer.get(2, 0)).toEqual({ ...ink, ch: 'B' });
  });

  it('grows every non-space cell at once, keeping its chosen sequence across frames', () => {
    const random = vi.spyOn(Math, 'random').mockReturnValue(0);
    try {
      const filters = new ScreenFilterPipeline();
      filters.addFilter(createGlyphGrowthRevealFilter({
        stepDurationMs: 10, growthSequences: ['T123'], shortGrowthSequences: ['s123'],
      }), { x: 0, y: 0, width: 3, height: 1 }, 100);
      const first = new CellBuffer(3, 1, ink);
      first.set(0, 0, { ...ink, ch: 'A' });
      first.set(1, 0, { ...ink, ch: 'a' });
      first.set(2, 0, { ...ink, ch: ' ' });
      filters.applyFilters(first, 100);
      expect(first.get(0, 0)).toEqual({ ...ink, ch: 'T', fg: { r: 128, g: 128, b: 128 } });
      expect(first.get(1, 0).ch).toBe('s');
      expect(first.get(2, 0)).toEqual({ ...ink, ch: ' ' });
      const next = new CellBuffer(3, 1, ink);
      next.set(0, 0, { ...ink, ch: 'B' }); // A new portrait frame doesn't restart the reveal.
      next.set(1, 0, { ...ink, ch: 'e' });
      next.set(2, 0, { ...ink, ch: ' ' });
      filters.applyFilters(next, 110);
      expect(next.get(0, 0).ch).toBe('1');
      expect(next.get(1, 0).ch).toBe('1');
      expect(random).toHaveBeenCalledTimes(2);
      const finished = new CellBuffer(3, 1, ink);
      finished.set(0, 0, { ...ink, ch: 'B' });
      filters.applyFilters(finished, 140);
      expect(finished.get(0, 0)).toEqual({ ...ink, ch: 'B' });
    } finally {
      random.mockRestore();
    }
  });

  it('starts each lower row later while revealing all glyphs in a row together', () => {
    const filters = new ScreenFilterPipeline();
    filters.addFilter(createGlyphGrowthRevealFilter({
      stepDurationMs: 20, rowDelayMs: 10, growthSequences: ['1234'], shortGrowthSequences: ['1234'],
    }), { x: 0, y: 0, width: 2, height: 3 }, 100);
    function getFrameAt(now: number): CellBuffer {
      const buffer = new CellBuffer(2, 3, { ...ink, ch: 'X' });
      filters.applyFilters(buffer, now);
      return buffer;
    }
    const first = getFrameAt(100);
    expect([first.get(0, 0).ch, first.get(1, 0).ch]).toEqual(['1', '1']);
    expect(first.get(0, 1).ch).toBe(' ');
    expect(first.get(0, 2).ch).toBe(' ');
    const cascading = getFrameAt(120);
    expect(cascading.get(0, 0).ch).toBe('2');
    expect(cascading.get(0, 1).ch).toBe('1');
    expect(cascading.get(0, 2).ch).toBe('1');
    const last = getFrameAt(200);
    expect(last.get(0, 0).ch).toBe('X');
    expect(last.get(0, 2).ch).toBe('X');
  });

  it('resolves the portrait image region after layout, excluding its frame', () => {
    const layout = new LayoutStandardScene(new Scene('room', 1, 1, 'regular-z', STANDARD_BACKGROUND, []));
    const frame: PortraitFrame = { width: 2, height: 2, cells: Array.from({ length: 4 }, () => ink), durationMs: 100 };
    const portrait: PortraitAsset = { width: 2, height: 2, frames: [frame], loop: false };
    layout.message.text = 'Hello';
    layout.dialoguePanel.setPortrait(portrait, frame);
    layout.render(new CellBuffer(120, 40, STANDARD_BACKGROUND));
    expect(layout.getPortraitScreenRect()).toEqual({ x: 1, y: 37, width: 2, height: 2 });
    layout.dialoguePanel.setPortrait(undefined);
    layout.render(new CellBuffer(120, 40, STANDARD_BACKGROUND));
    expect(layout.getPortraitScreenRect()).toBeUndefined();
  });

  it('maps scene-local areas to the post-render screen when the viewport moves', () => {
    const layout = new LayoutStandardScene(new Scene('room', 5, 3, 'regular-z', STANDARD_BACKGROUND, []));
    const area = { x: 2, y: 1, width: 2, height: 1 };
    layout.render(new CellBuffer(120, 40, STANDARD_BACKGROUND));
    expect(layout.getSceneScreenRect(area)).toEqual({ x: 59, y: 19, width: 2, height: 1 });
    layout.render(new CellBuffer(80, 24, STANDARD_BACKGROUND));
    expect(layout.getSceneScreenRect(area)).toEqual({ x: 39, y: 3, width: 2, height: 1 });
  });
});
