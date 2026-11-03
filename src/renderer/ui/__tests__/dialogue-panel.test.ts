import { describe, expect, it } from 'vitest';
import { CellBuffer, type Cell } from '../../../game/cell-buffer.js';
import type { PortraitAsset, PortraitFrame } from '../../../game/portrait-assets.js';
import { Scene } from '../../../game/scene.js';
import { getPlainText } from '../../../game/terminal.js';
import { LayoutStandardScene, STANDARD_BACKGROUND } from '../layout-standard-scene.js';

const cell: Cell = { ch: 'P', fg: { r: 255, g: 0, b: 0 }, bg: { r: 0, g: 0, b: 0 } };
const frame: PortraitFrame = {
  width: 32,
  height: 16,
  cells: Array.from({ length: 32 * 16 }, () => cell),
  durationMs: 100,
};
const portrait: PortraitAsset = { width: 32, height: 16, frames: [frame], loop: false };

function getLines(layout: LayoutStandardScene, cols: number, rows: number): string[] {
  const buffer = new CellBuffer(cols, rows, STANDARD_BACKGROUND);
  layout.render(buffer);
  return getPlainText(buffer).split('\n');
}

describe('dialogue overlay', () => {
  it('fills the UI with a double border and puts a rounded portrait frame beside the text', () => {
    const scene = new Scene('room', 1, 1, 'regular-z', STANDARD_BACKGROUND, []);
    const layout = new LayoutStandardScene(scene);
    layout.message.text = 'Guide: The crate is waiting for you.';
    layout.dialoguePanel.setPortrait(portrait, frame);
    const standard = getLines(layout, 120, 40);
    expect(standard[22]).toContain('╭');
    expect(standard[24]).toContain('P');
    expect(standard[25]).toContain('╔');
    expect(standard[39]).toContain('╰');
    expect(standard.slice(23, 39).every((line) => line.includes('P'.repeat(32)))).toBe(true);
    expect(standard.slice(26).join('\n')).toContain('P');
    expect(standard.slice(26).join('\n')).toContain('Guide: The crate is waiting for you.');
    expect(standard.slice(25).join('\n')).not.toContain('Inventory');

    const small = getLines(layout, 40, 16);
    expect(small[5]).toContain('╔');
    expect(small.slice(5).join('\n')).toContain('P');
    expect(small[15]).toContain('╚');
    expect(getLines(layout, 120, 40).slice(26).join('\n')).toContain('Guide: The crate');
  });

  it('keeps dialogue readable without a matching portrait and returns to tabs afterward', () => {
    const layout = new LayoutStandardScene(
      new Scene('room', 1, 1, 'regular-z', STANDARD_BACKGROUND, []),
    );
    layout.message.text = 'Guide: Hello';
    layout.dialoguePanel.setPortrait(undefined);
    expect(getLines(layout, 40, 16).join('\n')).toContain('Guide: Hello');
    expect((getLines(layout, 40, 16).join('\n').match(/╔/g) ?? [])).toHaveLength(1);
    layout.message.text = '';
    expect(getLines(layout, 40, 16).join('\n')).toContain('Inventory');
  });

  it('draws a tall portrait in full over the scene instead of cropping it to the UI', () => {
    const layout = new LayoutStandardScene(
      new Scene('room', 120, 40, 'regular-z', STANDARD_BACKGROUND, []),
    );
    const tallFrame: PortraitFrame = {
      width: 32,
      height: 24,
      durationMs: 100,
      cells: Array.from({ length: 32 * 24 }, () => cell),
    };
    layout.message.text = 'Eva: Hello';
    layout.dialoguePanel.setPortrait({ width: 32, height: 24, frames: [tallFrame], loop: false }, tallFrame);
    const lines = getLines(layout, 120, 40);
    expect(lines[14]).toContain('╭');
    expect(lines.slice(15, 39).every((line) => line.includes('P'.repeat(32)))).toBe(true);
    expect(lines[39]).toContain('╰');
    expect(lines.slice(25).join('\n')).toContain('Eva: Hello');
    expect(layout.getScenePoint(3, 18)).toBeUndefined();
    expect(layout.getScenePoint(50, 18)).toEqual({ x: 50, y: 18 });
  });

  it.each(['left', 'right'] as const)('places a %s portrait outside the narrower dialogue border', (side) => {
    const layout = new LayoutStandardScene(
      new Scene('room', 120, 40, 'regular-z', STANDARD_BACKGROUND, []),
    );
    layout.message.text = 'Eva: Hello';
    layout.dialoguePanel.setPortrait(portrait, frame, side);
    for (const cols of [120, 80]) {
      const lines = getLines(layout, cols, 40);
      const left = Math.max(0, -layout.x);
      const visibleWidth = Math.min(120, cols - layout.x) - left;
      const frameWidth = portrait.width + 2;
      const frameX = layout.x + (side === 'left' ? left : left + visibleWidth - frameWidth);
      const borderX = layout.x + layout.dialoguePanel.x;
      expect(layout.dialoguePanel.width).toBe(visibleWidth - frameWidth - 1);
      expect(borderX).toBe(side === 'left' ? frameX + frameWidth + 1 : layout.x + left);
      expect(lines[22][frameX]).toBe('╭');
      expect(lines[25][borderX]).toBe('╔');
      expect(lines[28].includes('Eva: Hello')).toBe(true);
      expect(layout.getScenePoint(frameX + 2, 23)).toBeUndefined();
    }
  });

  it('leaves the dialogue between both portraits and keeps nameplates on opposite corners', () => {
    const layout = new LayoutStandardScene(
      new Scene('room', 120, 40, 'regular-z', STANDARD_BACKGROUND, []),
    );
    layout.dialoguePanel.setSpeakers('Johnathan', 'Eva', 'Eva');
    layout.message.text = 'Hello';
    layout.dialoguePanel.setPortrait(portrait, frame);
    layout.dialoguePanel.setRightPortrait(portrait, frame);
    const lines = getLines(layout, 120, 40);
    expect(layout.dialoguePanel.x).toBe(35);
    expect(layout.dialoguePanel.width).toBe(50);
    expect(lines[22][0]).toBe('╭');
    expect(lines[22][86]).toBe('╭');
    expect(lines[25][35]).toBe('╔');
    expect(lines[25][84]).toBe('╗');
    expect(lines[26]).toContain('Johnathan');
    expect(lines[26]).toContain('Eva');
    expect(lines[29]).toContain('Hello');
  });

  it('opens an empty conversation and places the portrait left of the dialogue', () => {
    const layout = new LayoutStandardScene(
      new Scene('room', 1, 1, 'regular-z', STANDARD_BACKGROUND, []),
    );
    layout.conversationOpen = true;
    expect(getLines(layout, 80, 40).join('\n')).not.toContain('Inventory');
    layout.message.text = 'Eva: Hello';
    layout.dialoguePanel.setPortrait(portrait, frame);
    const lines = getLines(layout, 80, 40).slice(26).join('\n');
    expect(lines.indexOf('P')).toBeLessThan(lines.indexOf('Eva: Hello'));
    layout.conversationOpen = false;
    layout.message.text = '';
    layout.dialoguePanel.setPortrait(undefined);
    expect(getLines(layout, 80, 40).join('\n')).toContain('Inventory');
  });

  it('shows the grey advance hint two lines after dialogue, left-aligned with its text', () => {
    const layout = new LayoutStandardScene(
      new Scene('room', 1, 1, 'regular-z', STANDARD_BACKGROUND, []),
    );
    layout.conversationOpen = true;
    layout.message.text = 'Eva: Hello';
    expect(getLines(layout, 120, 40).join('\n')).not.toContain('[Space/Enter]');

    layout.dialoguePanel.advanceHint.visible = true;
    for (const [cols, rows] of [[120, 40], [80, 40], [40, 16]]) {
      const lines = getLines(layout, cols, rows);
      const panelLeft = layout.x + layout.ui.x + layout.dialoguePanel.x;
      const expected = panelLeft + 1 + layout.message.x;
      const hintRow = layout.y + layout.ui.y + layout.dialoguePanel.y + 1 + layout.dialoguePanel.advanceHint.y;
      expect(lines[hintRow].indexOf('[Space/Enter]')).toBe(expected);
      expect(lines[hintRow - 2].indexOf('Eva: Hello')).toBe(expected);
      expect(lines[hintRow - 1]).not.toContain('[Space/Enter]');
      const buffer = new CellBuffer(cols, rows, STANDARD_BACKGROUND);
      layout.render(buffer);
      expect(buffer.get(expected, hintRow).fg)
        .toEqual({ r: 128, g: 128, b: 128 });
      expect(lines.join('\n').match(/\[Space\/Enter\]/g)).toHaveLength(1);
    }

    layout.message.text = 'Eva: A longer sentence that wraps onto another line in a narrow terminal.';
    const wrapped = getLines(layout, 40, 16);
    const hintRow = wrapped.findIndex((line) => line.includes('[Space/Enter]'));
    expect(hintRow).toBeGreaterThan(wrapped.findIndex((line) => line.includes('Eva: A longer')) + 2);
    expect(wrapped[hintRow].indexOf('[Space/Enter]')).toBe(wrapped.find((line) => line.includes('Eva: A longer'))?.indexOf('Eva: A longer'));

    layout.message.text = '';
    layout.dialoguePanel.advanceHint.visible = false;
    expect(getLines(layout, 120, 40).join('\n')).not.toContain('[Space/Enter]');
  });

  it('frames the bright blue speaker label in the top-left and starts the message below it', () => {
    const layout = new LayoutStandardScene(
      new Scene('room', 1, 1, 'regular-z', STANDARD_BACKGROUND, []),
    );
    layout.dialoguePanel.setSpeaker('Johnathan');
    layout.message.text = 'A long message that continues over several lines in a narrow panel.';
    const buffer = new CellBuffer(40, 16, STANDARD_BACKGROUND);
    layout.render(buffer);
    const lines = getPlainText(buffer).split('\n');
    const row = lines.findIndex((line) => line.includes('Johnathan'));
    const x = lines[row].indexOf('Johnathan');
    expect(lines[row][x - 1]).toBe(' ');
    expect(lines[row][x + 'Johnathan'.length]).toBe(' ');
    expect(lines[row - 1][x - 2]).toBe('╔');
    expect(lines[row + 1][x - 2]).toBe('╚');
    expect(buffer.get(x - 2, row - 1).fg).toEqual({ r: 64, g: 160, b: 255 });
    expect(lines[row + 3]).toContain('A long message');
    expect(lines.join('\n')).not.toContain('Johnathan: A long message');
    expect(buffer.get(x, row).fg).toEqual({ r: 64, g: 160, b: 255 });
    expect(buffer.get(x + 'Johnathan'.length - 1, row).fg).toEqual({ r: 64, g: 160, b: 255 });
    expect(buffer.get(lines[row + 3].indexOf('A long message'), row + 3).fg)
      .toEqual({ r: 205, g: 211, b: 209 });
    layout.dialoguePanel.setSpeaker(undefined);
    expect(getLines(layout, 40, 16).join('\n')).not.toContain('Johnathan');
  });
});
