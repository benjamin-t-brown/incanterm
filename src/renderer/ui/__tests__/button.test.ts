import { describe, expect, it } from 'vitest';
import { CellBuffer, type Cell } from '../../../game/cell-buffer.js';
import { getPlainText } from '../../../game/terminal.js';
import { Button } from '../button.js';
import { UIElement } from '../element.js';

const ink: Cell = {
  ch: '.',
  fg: { r: 255, g: 255, b: 255 },
  bg: { r: 0, g: 0, b: 0 },
};

describe('Button', () => {
  it('renders text inside a fixed-width border', () => {
    const button = new Button('start', 0, 0, 10, 'Start');
    expect(button.height).toBe(3);
    expect(button.border).toBe('single');
    expect(draw(button, 10, 3).split('\n')).toEqual(['┌────────┐', '│ Start  │', '└────────┘']);
  });

  it('clips a label that is longer than the inner width', () => {
    const button = new Button('next', 1, 1, 8, 'Continue');
    expect(draw(button, 10, 5).split('\n')).toEqual([
      '..........',
      '.┌──────┐.',
      '.│Contin│.',
      '.└──────┘.',
      '..........',
    ]);
  });

  it('honors border styles', () => {
    expect(draw(new Button('ok', 0, 0, 6, 'OK', { border: 'double' }), 6, 3)).toBe(
      '╔════╗\n║ OK ║\n╚════╝',
    );
  });

  it('updates the label after construction', () => {
    const button = new Button('action', 0, 0, 8, 'Save');
    button.text = 'Load';
    expect(draw(button, 8, 3).split('\n')).toEqual(['┌──────┐', '│ Load │', '└──────┘']);
  });

  it('rejects undersized buttons', () => {
    expect(() => new Button('tiny', 0, 0, 1, 'X')).toThrow(/at least 2/);
  });
});

function draw(root: UIElement, width: number, height: number): string {
  const buffer = new CellBuffer(width, height, ink);
  root.render(buffer);
  return getPlainText(buffer);
}
