import { describe, expect, it } from 'vitest';
import { CellBuffer } from '../../../game/cell-buffer.js';
import { Prop, Scene } from '../../../game/scene.js';
import { Sprite } from '../../../game/sprite.js';
import { createSceneFixture } from '../../../game/__tests__/scene-fixture.js';
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
  it('centers a 60-column choice panel above the conversation', () => {
    const layout = new LayoutStandardScene(new Scene('room', 1, 1, 'regular-z', STANDARD_BACKGROUND, []));
    layout.conversationOpen = true;
    layout.message.text = 'Existing conversation';
    layout.choicePanel.setChoices({ question: 'Choose now?', options: ['Yes', 'No'] });
    const buffer = new CellBuffer(100, 40, STANDARD_BACKGROUND);
    layout.render(buffer);

    const rows = getPlainText(buffer).split('\n');
    const top = rows.findIndex((row) => row.slice(20, 80) === `┌${'─'.repeat(58)}┐`);
    expect(top).toBeGreaterThanOrEqual(0);
    expect(rows[top + 1].indexOf('Choose now?')).toBe(22);
    const buttonRow = rows.findIndex((row) => row.includes('1. Yes'));
    expect(layout.getChoiceAt(rows[buttonRow].indexOf('1. Yes'), buttonRow)).toBe(0);
    expect(rows.findIndex((row) => row.includes('Existing conversation'))).toBeGreaterThan(top + 8);
  });

  it('renders a log-only window over all UI and restores the previous view', () => {
    const layout = new LayoutStandardScene(new Scene('room', 3, 3, 'regular-z', STANDARD_BACKGROUND, []));
    layout.tabs.select('inventory');
    layout.conversationOpen = true;
    layout.message.text = 'Hidden dialogue';
    layout.centerToast.visible = true;
    layout.centerToast.setMessage('Hidden toast', 120, 40);
    layout.appendLog('Normal entry');
    layout.appendLog('Error entry', true);
    const original = new CellBuffer(120, 40, STANDARD_BACKGROUND);
    layout.render(original);
    layout.toggleLogWindow();
    const buffer = new CellBuffer(120, 40, STANDARD_BACKGROUND);
    layout.render(buffer);
    const text = getPlainText(buffer);
    expect(text).toContain('Normal entry');
    expect(text).toContain('Error entry');
    expect(text).not.toContain('Hidden');
    expect(text).not.toContain('Inventory');
    expect(layout.getScenePoint(10, 10)).toBeUndefined();
    expect(layout.getTabAt(10, 25)).toBeUndefined();
    expect(layout.getLogSelectionRect()).toEqual({ x: 2, y: 2, width: 116, height: 36 });
    const errorRow = text.split('\n').findIndex((line) => line.includes('Error entry'));
    expect(buffer.get(3, errorRow).fg).toEqual(ERROR_LOG_FG);
    layout.toggleLogWindow();
    const restored = new CellBuffer(120, 40, STANDARD_BACKGROUND);
    layout.render(restored);
    expect(getPlainText(restored)).toBe(getPlainText(original));
    expect(layout.tabs.selectedId).toBe('inventory');
  });

  it('shows an empty log window even when the terminal is below the scene minimum size', () => {
    const layout = new LayoutStandardScene(new Scene('room', 1, 1, 'regular-z', STANDARD_BACKGROUND, []));
    layout.toggleLogWindow();
    const buffer = new CellBuffer(30, 12, STANDARD_BACKGROUND);
    layout.render(buffer);
    expect(getPlainText(buffer)).toContain('No log entries yet.');
    expect(layout.getLogSelectionRect()).toEqual({ x: 2, y: 2, width: 26, height: 8 });
  });

  it('uses black dialogue backgrounds only while no dialogue text is displayed', () => {
    const layout = new LayoutStandardScene(new Scene('room', 1, 1, 'regular-z', STANDARD_BACKGROUND, []));
    layout.conversationOpen = true;
    const getBackground = (): { r: number; g: number; b: number } => {
      const buffer = new CellBuffer(120, 40, STANDARD_BACKGROUND);
      layout.render(buffer);
      return buffer.get(10, 27).bg;
    };
    expect(getBackground()).toEqual({ r: 0, g: 0, b: 0 });
    layout.message.showText('Hello');
    expect(getBackground()).toEqual({ r: 16, g: 25, b: 20 });
    layout.message.clearText();
    expect(getBackground()).toEqual({ r: 0, g: 0, b: 0 });
  });
  it('exposes only the visible Log content as a selectable region', () => {
    const scene = new Scene('room', 3, 3, 'regular-z', STANDARD_BACKGROUND, []);
    const layout = new LayoutStandardScene(scene);
    layout.render(new CellBuffer(80, 24, STANDARD_BACKGROUND));
    expect(layout.getLogSelectionRect()).toEqual({ x: 1, y: 13, width: 78, height: 10 });
    layout.tabs.select('inventory');
    layout.render(new CellBuffer(80, 24, STANDARD_BACKGROUND));
    expect(layout.getLogSelectionRect()).toBeUndefined();
    layout.tabs.select('log');
    layout.message.text = 'Hello';
    layout.render(new CellBuffer(80, 24, STANDARD_BACKGROUND));
    expect(layout.getLogSelectionRect()).toBeUndefined();
  });

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

  function createFrame(cols: number, rows: number): string[] {
    const scene = createSceneFixture();
    const layout = new LayoutStandardScene(scene);
    layout.message.text = 'Guide: The crate is waiting for you.';
    const buffer = new CellBuffer(cols, rows, STANDARD_BACKGROUND);
    layout.render(buffer);
    return getPlainText(buffer).split('\n');
  }

  it('overlays the bottom 16 rows of the 120x40 scene viewport', () => {
    expect(STANDARD_WORLD_HEIGHT).toBe(40);
    expect(STANDARD_UI_HEIGHT).toBe(16);
    const lines = createFrame(STANDARD_WIDTH, STANDARD_HEIGHT);
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

  it('renders the same default UI for an editor-only preview', () => {
    const scene = createSceneFixture();
    const layout = new LayoutStandardScene(scene);
    const buffer = new CellBuffer(120, 40, STANDARD_BACKGROUND);
    layout.render(buffer);
    expect(getPlainText(renderStandardUiPreview(120)).split('\n')).toEqual(
      getPlainText(buffer).split('\n').slice(24),
    );
  });

  it('centers the full canvas on a larger terminal', () => {
    const lines = createFrame(140, 50);
    expect(lines[0]).toBe(' '.repeat(140));
    expect(lines[29]).toBe(`${' '.repeat(10)}${'='.repeat(120)}${' '.repeat(10)}`);
    expect(lines.slice(30).join('\n')).toContain('Guide: The crate is waiting for you.');
  });

  it('keeps the UI and center of the world visible on smaller terminals', () => {
    const medium = createFrame(80, 24);
    expect(medium[8]).toBe('='.repeat(80));
    expect(medium.slice(0, 8).join('\n')).toContain('| # |');
    expect(medium.slice(9).join('\n')).toContain('Guide: The crate is waiting for you.');

    const small = createFrame(40, 16);
    expect(small[4]).toBe('='.repeat(40));
    expect(small[5]).toBe(`╔${'═'.repeat(38)}╗`);
    expect(small.slice(0, 4).join('\n')).toContain('#');
    expect(small.slice(5).join('\n')).toContain('Guide: The crate is waiting for');
    expect(small.slice(5).join('\n')).toContain('you.');
  });

  it('reports when the terminal is below the minimum supported size', () => {
    const lines = createFrame(30, 12);
    expect(lines.join('\n')).toContain('Terminal needs at least');
  });

  it('reflows the same component when shrinking, growing, and recovering from an undersized view', () => {
    const scene = createSceneFixture();
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
