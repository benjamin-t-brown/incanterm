import { expect, it, vi } from 'vitest';
import { fillTerminalCellWithoutSeams } from '../terminal-renderer.js';

it('covers adjoining fractional cells on the device-pixel grid', () => {
  const fillRect = vi.fn();
  const context = {
    getTransform: () => ({ a: 2, d: 2 }),
    fillRect,
  } as unknown as CanvasRenderingContext2D;
  const cell = { width: 10.3, height: 20.3, ascent: 16, font: '16px monospace', scale: 1 };

  fillTerminalCellWithoutSeams(context, cell, 0.2, 0.2);
  fillTerminalCellWithoutSeams(context, cell, 10.5, 0.2);

  expect(fillRect).toHaveBeenNthCalledWith(1, 0, 0, 10.5, 20.5);
  expect(fillRect).toHaveBeenNthCalledWith(2, 10.5, 0, 10.5, 20.5);
});
