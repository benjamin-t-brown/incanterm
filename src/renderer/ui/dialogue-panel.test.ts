import { describe, expect, it } from 'vitest';
import { CellBuffer, type Cell } from '../../game/cell-buffer.js';
import type { PortraitAsset, PortraitFrame } from '../../game/portrait-assets.js';
import { Scene } from '../../game/scene.js';
import { plainText } from '../../game/terminal.js';
import { LayoutStandardScene, STANDARD_BACKGROUND } from './layout-standard-scene.js';

const cell: Cell = { ch: 'P', fg: { r: 255, g: 0, b: 0 }, bg: { r: 0, g: 0, b: 0 } };
const frame: PortraitFrame = {
  width: 32,
  height: 16,
  cells: Array.from({ length: 32 * 16 }, () => cell),
  durationMs: 100,
};
const portrait: PortraitAsset = { width: 32, height: 16, frames: [frame], loop: false };

function lines(layout: LayoutStandardScene, cols: number, rows: number): string[] {
  const buffer = new CellBuffer(cols, rows, STANDARD_BACKGROUND);
  layout.render(buffer);
  return plainText(buffer).split('\n');
}

describe('dialogue overlay', () => {
  it('fills the UI with a double border and puts a single-bordered portrait beside the text', () => {
    const scene = new Scene('room', 1, 1, 'regular-z', STANDARD_BACKGROUND, []);
    const layout = new LayoutStandardScene(scene);
    layout.message.text = 'Guide: The crate is waiting for you.';
    layout.dialoguePanel.setPortrait(portrait, frame);
    const standard = lines(layout, 120, 40);
    expect(standard[24]).toBe('='.repeat(120));
    expect(standard[25]).toBe(`╔${'═'.repeat(118)}╗`);
    expect(standard[27]).toContain('┌');
    expect(standard.slice(26).join('\n')).toContain('P');
    expect(standard.slice(26).join('\n')).toContain('Guide: The crate is waiting for you.');
    expect(standard.slice(25).join('\n')).not.toContain('Inventory');

    const small = lines(layout, 40, 16);
    expect(small[5]).toBe(`╔${'═'.repeat(38)}╗`);
    expect(small.slice(5).join('\n')).toContain('P');
    expect(small.slice(5).join('\n')).toContain('Guide:');
    expect(small.slice(5).join('\n')).toContain('you.');
    expect(lines(layout, 120, 40).slice(26).join('\n')).toContain('Guide: The crate');
  });

  it('keeps dialogue readable without a matching portrait and returns to tabs afterward', () => {
    const layout = new LayoutStandardScene(
      new Scene('room', 1, 1, 'regular-z', STANDARD_BACKGROUND, []),
    );
    layout.message.text = 'Guide: Hello';
    layout.dialoguePanel.setPortrait(undefined);
    expect(lines(layout, 40, 16).join('\n')).toContain('Guide: Hello');
    expect(lines(layout, 40, 16).join('\n')).not.toContain('┌');
    layout.message.text = '';
    expect(lines(layout, 40, 16).join('\n')).toContain('Inventory');
  });
});
