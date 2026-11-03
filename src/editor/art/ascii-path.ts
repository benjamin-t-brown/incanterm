export const PATH_MODES = ['draw', 'line', 'box', 'circle', 'dialog'] as const;
export const PATH_STYLES = ['single', 'double', 'heavy', 'rounded'] as const;

export type PathMode = (typeof PATH_MODES)[number];
export type PathStyle = (typeof PATH_STYLES)[number];
export type GridPoint = { x: number; y: number; links?: number };
export type PathWrite = { x: number; y: number; ch: string; stroke: boolean };

const N = 1;
const E = 2;
const S = 4;
const W = 8;
const NESW = [
  { dir: N, x: 0, y: -1, toward: S },
  { dir: E, x: 1, y: 0, toward: W },
  { dir: S, x: 0, y: 1, toward: N },
  { dir: W, x: -1, y: 0, toward: E },
] as const;

const STYLE_GLYPHS: Record<PathStyle, string[]> = {
  single: ['─', '│', '─', '└', '│', '│', '┌', '├', '─', '┘', '─', '┴', '┐', '┤', '┬', '┼'],
  double: ['═', '║', '═', '╚', '║', '║', '╔', '╠', '═', '╝', '═', '╩', '╗', '╣', '╦', '╬'],
  heavy: ['━', '┃', '━', '┗', '┃', '┃', '┏', '┣', '━', '┛', '━', '┻', '┓', '┫', '┳', '╋'],
  rounded: ['─', '│', '─', '╰', '│', '│', '╭', '├', '─', '╯', '─', '┴', '╮', '┤', '┬', '┼'],
};

const MASK_BY_GLYPH = new Map<string, number>();
const STYLES_BY_GLYPH = new Map<string, Set<PathStyle>>();
for (const style of PATH_STYLES) {
  const glyphs = STYLE_GLYPHS[style];
  for (let mask = 0; mask < glyphs.length; mask++) {
    const ch = glyphs[mask];
    MASK_BY_GLYPH.set(ch, mask);
    let styles = STYLES_BY_GLYPH.get(ch);
    if (!styles) {
      styles = new Set();
      STYLES_BY_GLYPH.set(ch, styles);
    }
    styles.add(style);
  }
}

export function isPathMode(value: string): value is PathMode {
  return (PATH_MODES as readonly string[]).includes(value);
}

export function isPathStyle(value: string): value is PathStyle {
  return (PATH_STYLES as readonly string[]).includes(value);
}

export function getGlyphFor(style: PathStyle, mask: number): string {
  return STYLE_GLYPHS[style][mask & 15];
}

export function maskFor(ch: string): number | null {
  const mask = MASK_BY_GLYPH.get(ch);
  return mask === undefined ? null : mask;
}

export function styleHasGlyph(style: PathStyle, ch: string): boolean {
  return STYLES_BY_GLYPH.get(ch)?.has(style) === true;
}

export function createOrthogonalLine(x0: number, y0: number, x1: number, y1: number): GridPoint[] {
  const points: GridPoint[] = [{ x: x0, y: y0 }];
  let x = x0;
  let y = y0;
  const dx = Math.abs(x1 - x0);
  const dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let error = dx - dy;
  while (x !== x1 || y !== y1) {
    const twice = 2 * error;
    const stepX = twice > -dy;
    const stepY = twice < dx;
    if (stepX) {
      error -= dy;
      x += sx;
    }
    if (stepY) {
      error += dx;
      y += sy;
    }
    if (stepX && stepY) points.push({ x, y: y - sy });
    points.push({ x, y });
  }
  return points;
}

export function extendDrawPath(path: GridPoint[], next: GridPoint): GridPoint[] {
  if (path.length === 0) return [{ x: next.x, y: next.y }];
  const last = path[path.length - 1];
  if (last.x === next.x && last.y === next.y) return path;
  return path.concat(createOrthogonalLine(last.x, last.y, next.x, next.y).slice(1));
}

export function constrainLineEnd(start: GridPoint, end: GridPoint): GridPoint {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (ax === 0 && ay === 0) return { x: end.x, y: end.y };
  if (ay * 2 < ax) return { x: end.x, y: start.y };
  if (ax * 2 < ay) return { x: start.x, y: end.y };
  const length = Math.max(ax, ay);
  const sx = dx < 0 ? -1 : 1;
  const sy = dy < 0 ? -1 : 1;
  return { x: start.x + length * sx, y: start.y + length * sy };
}

export function constrainSquareEnd(start: GridPoint, end: GridPoint): GridPoint {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const side = Math.max(Math.abs(dx), Math.abs(dy));
  if (side === 0) return { x: start.x, y: start.y };
  return {
    x: start.x + side * (dx < 0 ? -1 : 1),
    y: start.y + side * (dy < 0 ? -1 : 1),
  };
}

export function createBoxOutline(start: GridPoint, end: GridPoint): GridPoint[] {
  const left = Math.min(start.x, end.x);
  const right = Math.max(start.x, end.x);
  const top = Math.min(start.y, end.y);
  const bottom = Math.max(start.y, end.y);
  const cells: GridPoint[] = [];
  const add = (x: number, y: number) => {
    cells.push({ x, y, links: getBoxLinks(x, y, left, right, top, bottom) });
  };
  if (top === bottom) {
    for (let x = left; x <= right; x++) add(x, top);
    return cells;
  }
  if (left === right) {
    for (let y = top; y <= bottom; y++) add(left, y);
    return cells;
  }
  for (let x = left; x <= right; x++) {
    add(x, top);
    add(x, bottom);
  }
  for (let y = top + 1; y < bottom; y++) {
    add(left, y);
    add(right, y);
  }
  return cells;
}

export function createDialogOutline(start: GridPoint, end: GridPoint): GridPoint[] {
  const left = Math.min(start.x, end.x);
  const right = Math.max(start.x, end.x);
  const top = Math.min(start.y, end.y);
  const bottom = Math.max(start.y, end.y);
  const width = right - left + 1;
  const height = bottom - top + 1;
  const origin = { x: start.x, y: start.y };
  const inx = start.x === end.x ? 1 : Math.sign(end.x - start.x);
  const iny = start.y === end.y ? 1 : Math.sign(end.y - start.y);
  const depth = Math.min(2, Math.max(0, Math.floor(Math.min(width, height) / 4)));
  if (depth < 1 || width < 4 || height < 4) return createBoxOutline(start, end);

  const remove = new Set<string>();
  for (let index = 0; index < depth; index++) {
    remove.add(`${origin.x + index * inx},${origin.y}`);
    remove.add(`${origin.x},${origin.y + index * iny}`);
  }
  const cells = createBoxOutline(start, end).filter((cell) => !remove.has(`${cell.x},${cell.y}`));
  return getUniquePoints(
    cells.concat(createChamferCells(origin, inx, iny, depth)).map(({ x, y }) => ({ x, y })),
  );
}

export function createEllipseOutline(start: GridPoint, end: GridPoint): GridPoint[] {
  const x0 = Math.min(start.x, end.x);
  const x1 = Math.max(start.x, end.x);
  const y0 = Math.min(start.y, end.y);
  const y1 = Math.max(start.y, end.y);
  const width = x1 - x0 + 1;
  const height = y1 - y0 + 1;
  if (width <= 2 || height <= 2) return createBoxOutline(start, end);

  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const rx = (x1 - x0) / 2;
  const ry = (y1 - y0) / 2;
  const cells = new Map<string, GridPoint>();
  const add = (x: number, y: number) => {
    const px = Math.max(x0, Math.min(x1, x));
    const py = Math.max(y0, Math.min(y1, y));
    cells.set(`${px},${py}`, { x: px, y: py });
  };

  const rows: { y: number; left: number; right: number }[] = [];
  for (let y = y0; y <= y1; y++) {
    const t = 1 - ((y - cy) / ry) ** 2;
    if (t < 0) continue;
    const dx = rx * Math.sqrt(t);
    const left = Math.max(x0, Math.min(x1, Math.round(cx - dx)));
    const right = Math.max(x0, Math.min(x1, Math.round(cx + dx)));
    add(left, y);
    add(right, y);
    rows.push({ y, left, right });
  }
  if (rows.length === 0) return createBoxOutline(start, end);

  const yMid = Math.floor((y0 + y1) / 2);
  const first = rows[0];
  for (let x = first.left; x <= first.right; x++) add(x, first.y);
  for (let index = 1; index < rows.length; index++) {
    const prev = rows[index - 1];
    const row = rows[index];
    if (row.y > yMid) break;
    for (const point of createOrthogonalLine(prev.left, prev.y, row.left, row.y)) add(point.x, point.y);
    for (const point of createOrthogonalLine(prev.right, prev.y, row.right, row.y)) add(point.x, point.y);
  }
  for (const { x, y } of [...cells.values()]) {
    add(x, y0 + y1 - y);
    add(x0 + x1 - x, y);
    add(x0 + x1 - x, y0 + y1 - y);
  }
  fourConnectOutward(cells, cx, cy);
  return [...cells.values()];
}

export function strokeCells(input: {
  mode: PathMode;
  start: GridPoint;
  end: GridPoint;
  path?: GridPoint[];
  shift?: boolean;
}): GridPoint[] {
  const shift = input.shift === true;
  if (input.mode === 'draw') {
    if (input.path && input.path.length > 0) return getUniquePoints(input.path);
    return getUniquePoints(extendDrawPath([{ x: input.start.x, y: input.start.y }], input.end));
  }
  if (input.mode === 'line') {
    const end = shift ? constrainLineEnd(input.start, input.end) : input.end;
    return getUniquePoints(createOrthogonalLine(input.start.x, input.start.y, end.x, end.y));
  }
  if (input.mode === 'box') {
    const end = shift ? constrainSquareEnd(input.start, input.end) : input.end;
    return getUniquePoints(createBoxOutline(input.start, end));
  }
  if (input.mode === 'dialog') {
    const end = shift ? constrainSquareEnd(input.start, input.end) : input.end;
    return getUniquePoints(createDialogOutline(input.start, end));
  }
  const end = shift ? constrainSquareEnd(input.start, input.end) : input.end;
  return getUniquePoints(createEllipseOutline(input.start, end));
}

export function applyPath(
  cells: GridPoint[],
  style: PathStyle,
  readCell: (x: number, y: number) => string | null,
): PathWrite[] {
  const stroke = new Map<string, GridPoint>();
  for (const cell of cells) stroke.set(`${cell.x},${cell.y}`, cell);
  const writes = new Map<string, PathWrite>();
  for (const cell of stroke.values()) {
    writes.set(`${cell.x},${cell.y}`, {
      x: cell.x,
      y: cell.y,
      ch: getGlyphFor(style, maskAt(cell.x, cell.y, style, stroke, readCell)),
      stroke: true,
    });
  }
  for (const cell of stroke.values()) {
    for (const step of NESW) {
      const nx = cell.x + step.x;
      const ny = cell.y + step.y;
      const id = `${nx},${ny}`;
      if (stroke.has(id)) continue;
      const existing = readCell(nx, ny);
      if (!existing || !styleHasGlyph(style, existing)) continue;
      const mask = (maskFor(existing) ?? 0) | step.toward;
      writes.set(id, { x: nx, y: ny, ch: getGlyphFor(style, mask), stroke: false });
    }
  }
  return [...writes.values()];
}

function maskAt(
  x: number,
  y: number,
  style: PathStyle,
  stroke: Map<string, GridPoint>,
  readCell: (x: number, y: number) => string | null,
): number {
  const self = stroke.get(`${x},${y}`);
  let mask = 0;
  for (const step of NESW) {
    const nx = x + step.x;
    const ny = y + step.y;
    if (stroke.has(`${nx},${ny}`)) {
      if (self?.links !== undefined && (self.links & step.dir) === 0) continue;
      mask |= step.dir;
      continue;
    }
    const existing = readCell(nx, ny);
    if (existing && styleHasGlyph(style, existing)) mask |= step.dir;
  }
  return mask;
}

function getBoxLinks(
  x: number,
  y: number,
  left: number,
  right: number,
  top: number,
  bottom: number,
): number {
  const onLeft = x === left;
  const onRight = x === right;
  const onTop = y === top;
  const onBottom = y === bottom;
  let mask = 0;
  if ((onTop || onBottom) && x < right) mask |= E;
  if ((onTop || onBottom) && x > left) mask |= W;
  if ((onLeft || onRight) && y < bottom) mask |= S;
  if ((onLeft || onRight) && y > top) mask |= N;
  return mask;
}

function createChamferCells(origin: GridPoint, inx: number, iny: number, depth: number): GridPoint[] {
  const diagonal: GridPoint[] = [];
  for (let index = 0; index <= depth; index++) {
    diagonal.push({
      x: origin.x + (depth - index) * inx,
      y: origin.y + index * iny,
    });
  }
  const cells: GridPoint[] = [];
  for (let index = 0; index < diagonal.length; index++) {
    if (index > 0) {
      const prev = diagonal[index - 1];
      const next = diagonal[index];
      const horiz = { x: next.x, y: prev.y };
      const vert = { x: prev.x, y: next.y };
      const dh = (horiz.x - origin.x) ** 2 + (horiz.y - origin.y) ** 2;
      const dv = (vert.x - origin.x) ** 2 + (vert.y - origin.y) ** 2;
      const bridge = dh >= dv ? horiz : vert;
      if (
        (bridge.x !== prev.x || bridge.y !== prev.y) &&
        (bridge.x !== next.x || bridge.y !== next.y)
      ) {
        cells.push(bridge);
      }
    }
    cells.push(diagonal[index]);
  }
  return cells;
}

function getUniquePoints(points: GridPoint[]): GridPoint[] {
  const seen = new Set<string>();
  const unique: GridPoint[] = [];
  for (const point of points) {
    const id = `${point.x},${point.y}`;
    if (seen.has(id)) continue;
    seen.add(id);
    unique.push(point);
  }
  return unique;
}

function fourConnectOutward(cells: Map<string, GridPoint>, cx: number, cy: number): void {
  const diagonals = [
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1],
  ];
  let added = true;
  while (added) {
    added = false;
    for (const { x, y } of [...cells.values()]) {
      for (const [dx, dy] of diagonals) {
        const nx = x + dx;
        const ny = y + dy;
        if (!cells.has(`${nx},${ny}`)) continue;
        if (cells.has(`${x + dx},${y}`) || cells.has(`${x},${y + dy}`)) continue;
        const a = { x: x + dx, y };
        const b = { x, y: y + dy };
        const da = (a.x - cx) ** 2 + (a.y - cy) ** 2;
        const db = (b.x - cx) ** 2 + (b.y - cy) ** 2;
        const pick = da >= db ? a : b;
        const id = `${pick.x},${pick.y}`;
        if (cells.has(id)) continue;
        cells.set(id, pick);
        added = true;
      }
    }
  }
}
