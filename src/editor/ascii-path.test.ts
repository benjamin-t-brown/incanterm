import { describe, expect, it } from 'vitest';
import {
  applyPath,
  boxOutline,
  constrainLineEnd,
  constrainSquareEnd,
  dialogOutline,
  ellipseOutline,
  extendDrawPath,
  glyphFor,
  maskFor,
  orthogonalLine,
  strokeCells,
  styleHasGlyph,
  type GridPoint,
  type PathStyle,
} from './ascii-path.js';

function key(x: number, y: number): string {
  return `${x},${y}`;
}

function fromRows(rows: string[]): Map<string, string> {
  const cells = new Map<string, string>();
  for (let y = 0; y < rows.length; y++) {
    for (let x = 0; x < rows[y].length; x++) {
      const ch = rows[y][x];
      if (ch !== ' ') cells.set(key(x, y), ch);
    }
  }
  return cells;
}

function render(
  width: number,
  height: number,
  cells: GridPoint[],
  style: PathStyle,
  existing: Map<string, string> = new Map(),
): string {
  const writes = applyPath(cells, style, (x, y) => existing.get(key(x, y)) ?? null);
  const grid = Array.from({ length: height }, () => Array.from({ length: width }, () => ' '));
  for (const [id, ch] of existing) {
    const [x, y] = id.split(',').map(Number);
    if (y >= 0 && y < height && x >= 0 && x < width) grid[y][x] = ch;
  }
  for (const write of writes) {
    if (write.y >= 0 && write.y < height && write.x >= 0 && write.x < width) {
      grid[write.y][write.x] = write.ch;
    }
  }
  return grid.map((row) => row.join('')).join('\n');
}

describe('ascii path glyphs', () => {
  it('uses a horizontal stub for a lone cell and straights for dead ends', () => {
    expect(glyphFor('double', 0)).toBe('═');
    expect(glyphFor('double', 1)).toBe('║');
    expect(glyphFor('double', 2)).toBe('═');
    expect(glyphFor('single', 10)).toBe('─');
    expect(glyphFor('single', 5)).toBe('│');
    expect(glyphFor('rounded', 3)).toBe('╰');
    expect(glyphFor('rounded', 6)).toBe('╭');
    expect(glyphFor('heavy', 15)).toBe('╋');
    expect(maskFor('╬')).toBe(15);
    expect(maskFor('█')).toBeNull();
    expect(styleHasGlyph('double', '═')).toBe(true);
    expect(styleHasGlyph('single', '╭')).toBe(false);
  });

  it('draws a two-cell horizontal and vertical double line', () => {
    expect(
      render(
        2,
        1,
        strokeCells({ mode: 'line', start: { x: 0, y: 0 }, end: { x: 1, y: 0 } }),
        'double',
      ),
    ).toBe('══');
    expect(
      render(
        1,
        2,
        strokeCells({ mode: 'line', start: { x: 0, y: 0 }, end: { x: 0, y: 1 } }),
        'double',
      ),
    ).toBe('║\n║');
  });

  it('points a dialog bubble corner at the original click', () => {
    expect(
      render(
        4,
        4,
        strokeCells({ mode: 'dialog', start: { x: 0, y: 0 }, end: { x: 3, y: 3 } }),
        'double',
      ),
    ).toBe(' ╔═╗\n╔╝ ║\n║  ║\n╚══╝');
    expect(
      render(
        4,
        4,
        strokeCells({ mode: 'dialog', start: { x: 3, y: 0 }, end: { x: 0, y: 3 } }),
        'double',
      ),
    ).toBe('╔═╗ \n║ ╚╗\n║  ║\n╚══╝');
    expect(
      render(
        4,
        4,
        strokeCells({ mode: 'dialog', start: { x: 0, y: 3 }, end: { x: 3, y: 0 } }),
        'double',
      ),
    ).toBe('╔══╗\n║  ║\n╚╗ ║\n ╚═╝');
    expect(
      render(
        4,
        4,
        strokeCells({ mode: 'dialog', start: { x: 3, y: 3 }, end: { x: 0, y: 0 } }),
        'double',
      ),
    ).toBe('╔══╗\n║  ║\n║ ╔╝\n╚═╝ ');
  });

  it('deepens the dialog pointer on a larger box', () => {
    expect(
      render(
        8,
        8,
        strokeCells({ mode: 'dialog', start: { x: 0, y: 0 }, end: { x: 7, y: 7 } }),
        'double',
      ),
    ).toBe('  ╔════╗\n ╔╝    ║\n╔╝     ║\n║      ║\n║      ║\n║      ║\n║      ║\n╚══════╝');
  });

  it('falls back to a box when a dialog bubble is too small', () => {
    expect(dialogOutline({ x: 0, y: 0 }, { x: 2, y: 2 })).toEqual(
      boxOutline({ x: 0, y: 0 }, { x: 2, y: 2 }),
    );
  });

  it('draws a 3×3 double box', () => {
    expect(
      render(
        3,
        3,
        strokeCells({ mode: 'box', start: { x: 0, y: 0 }, end: { x: 2, y: 2 } }),
        'double',
      ),
    ).toBe('╔═╗\n║ ║\n╚═╝');
  });

  it('does not T-junction the middle of a 3×2 or 2×3 box', () => {
    expect(
      render(
        3,
        2,
        strokeCells({ mode: 'box', start: { x: 0, y: 0 }, end: { x: 2, y: 1 } }),
        'double',
      ),
    ).toBe('╔═╗\n╚═╝');
    expect(
      render(
        4,
        2,
        strokeCells({ mode: 'box', start: { x: 0, y: 0 }, end: { x: 3, y: 1 } }),
        'double',
      ),
    ).toBe('╔══╗\n╚══╝');
    expect(
      render(
        2,
        3,
        strokeCells({ mode: 'box', start: { x: 0, y: 0 }, end: { x: 1, y: 2 } }),
        'double',
      ),
    ).toBe('╔╗\n║║\n╚╝');
    expect(
      render(
        2,
        2,
        strokeCells({ mode: 'box', start: { x: 0, y: 0 }, end: { x: 1, y: 1 } }),
        'single',
      ),
    ).toBe('┌┐\n└┘');
  });

  it('uses rounded corners', () => {
    expect(
      render(
        3,
        3,
        strokeCells({ mode: 'box', start: { x: 0, y: 0 }, end: { x: 2, y: 2 } }),
        'rounded',
      ),
    ).toBe('╭─╮\n│ │\n╰─╯');
  });

  it('crosses two double lines with a plus', () => {
    const horizontal = strokeCells({ mode: 'line', start: { x: 0, y: 1 }, end: { x: 2, y: 1 } });
    const existing = fromRows(render(3, 3, horizontal, 'double').split('\n'));
    const vertical = strokeCells({ mode: 'line', start: { x: 1, y: 0 }, end: { x: 1, y: 2 } });
    expect(render(3, 3, vertical, 'double', existing)).toBe(' ║ \n═╬═\n ║ ');
  });

  it('T-junctions into an existing line without overwriting the whole stroke', () => {
    const existing = fromRows(['═══']);
    const stem = strokeCells({ mode: 'line', start: { x: 1, y: 1 }, end: { x: 1, y: 1 } });
    expect(render(3, 2, stem, 'double', existing)).toBe('═╦═\n ║ ');
  });

  it('Shift-constrains a box to a square', () => {
    const end = constrainSquareEnd({ x: 0, y: 0 }, { x: 4, y: 2 });
    expect(end).toEqual({ x: 4, y: 4 });
    expect(boxOutline({ x: 0, y: 0 }, end)).toHaveLength(16);
  });

  it('Shift-snaps a line to orthogonal or 45°', () => {
    expect(constrainLineEnd({ x: 0, y: 0 }, { x: 5, y: 1 })).toEqual({ x: 5, y: 0 });
    expect(constrainLineEnd({ x: 0, y: 0 }, { x: 1, y: 5 })).toEqual({ x: 0, y: 5 });
    expect(constrainLineEnd({ x: 0, y: 0 }, { x: 4, y: 3 })).toEqual({ x: 4, y: 4 });
  });

  it('uses an accumulated draw path as-is', () => {
    const path = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
    ];
    expect(
      strokeCells({
        mode: 'draw',
        start: { x: 0, y: 0 },
        end: { x: 4, y: 4 },
        path,
      }),
    ).toEqual(path);
  });

  it('keeps freehand jumps 4-connected', () => {
    const path = extendDrawPath([{ x: 0, y: 0 }], { x: 2, y: 1 });
    for (let index = 1; index < path.length; index++) {
      const prev = path[index - 1];
      const point = path[index];
      expect(Math.abs(point.x - prev.x) + Math.abs(point.y - prev.y)).toBe(1);
    }
  });

  it('draws a closed 4-connected ellipse', () => {
    const cells = ellipseOutline({ x: 0, y: 0 }, { x: 6, y: 6 });
    const set = new Set(cells.map((cell) => key(cell.x, cell.y)));
    expect(set.size).toBeGreaterThan(8);
    for (const cell of cells) {
      const neighbors = [
        key(cell.x, cell.y - 1),
        key(cell.x + 1, cell.y),
        key(cell.x, cell.y + 1),
        key(cell.x - 1, cell.y),
      ].filter((id) => set.has(id)).length;
      expect(neighbors).toBeGreaterThanOrEqual(2);
    }
    expect(render(7, 7, cells, 'single').includes(' ')).toBe(true);
  });

  it('Shift-forces a circle bounding box', () => {
    const cells = strokeCells({
      mode: 'circle',
      start: { x: 0, y: 0 },
      end: { x: 5, y: 2 },
      shift: true,
    });
    const xs = cells.map((cell) => cell.x);
    const ys = cells.map((cell) => cell.y);
    expect(Math.max(...xs) - Math.min(...xs)).toBe(Math.max(...ys) - Math.min(...ys));
  });

  it('fills an orthogonal line without diagonal steps', () => {
    const line = orthogonalLine(0, 0, 3, 2);
    for (let index = 1; index < line.length; index++) {
      const prev = line[index - 1];
      const point = line[index];
      expect(Math.abs(point.x - prev.x) + Math.abs(point.y - prev.y)).toBe(1);
    }
    expect(line[0]).toEqual({ x: 0, y: 0 });
    expect(line[line.length - 1]).toEqual({ x: 3, y: 2 });
  });
});
