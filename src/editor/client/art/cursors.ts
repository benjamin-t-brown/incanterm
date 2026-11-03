import {
  CURSOR_HOT,
  CURSOR_UNIT,
  getCursorIcon,
  getCursorLayout,
  type ArtCursorKind,
} from '../../art/art-cursor.js';

const cache = new Map<string, string>();
const HALO = '#0c1f1e';
const INK = '#f7fff9';

function getCursorScale(): number {
  const dpr = window.devicePixelRatio || 1;
  return Math.min(2, Math.max(1, dpr));
}

function paintCursor(
  context: CanvasRenderingContext2D,
  kind: ArtCursorKind,
  pressed: boolean,
): void {
  const layout = getCursorLayout(pressed);
  const { d, struck } = getCursorIcon(kind);
  const arms: Array<[number, number, number, number]> = [
    [CURSOR_HOT.x - layout.reach, CURSOR_HOT.y, CURSOR_HOT.x - layout.gap, CURSOR_HOT.y],
    [CURSOR_HOT.x + layout.gap, CURSOR_HOT.y, CURSOR_HOT.x + layout.reach, CURSOR_HOT.y],
    [CURSOR_HOT.x, CURSOR_HOT.y - layout.reach, CURSOR_HOT.x, CURSOR_HOT.y - layout.gap],
    [CURSOR_HOT.x, CURSOR_HOT.y + layout.gap, CURSOR_HOT.x, CURSOR_HOT.y + layout.reach],
  ];
  context.save();
  context.lineCap = 'square';
  for (const width of [4, 1.75]) {
    context.strokeStyle = width === 4 ? HALO : INK;
    context.lineWidth = width;
    for (const [x1, y1, x2, y2] of arms) {
      context.beginPath();
      context.moveTo(x1, y1);
      context.lineTo(x2, y2);
      context.stroke();
    }
  }
  context.restore();

  const path = new Path2D(d);
  context.save();
  context.translate(layout.iconX, layout.iconY);
  context.scale(layout.icon / 512, layout.icon / 512);
  context.lineJoin = 'round';
  context.lineCap = 'round';
  context.strokeStyle = HALO;
  context.lineWidth = 56;
  context.stroke(path);
  context.fillStyle = INK;
  context.fill(path);
  context.restore();

  if (!struck) return;
  context.save();
  context.lineCap = 'round';
  context.beginPath();
  context.moveTo(layout.iconX + 1, layout.iconY + layout.icon - 1);
  context.lineTo(layout.iconX + layout.icon - 1, layout.iconY + 1);
  context.strokeStyle = HALO;
  context.lineWidth = 4;
  context.stroke();
  context.strokeStyle = '#ff4b4b';
  context.lineWidth = 2;
  context.stroke();
  context.restore();
}

function getCursorUrl(kind: ArtCursorKind, pressed: boolean, scale: number): string {
  const key = `${kind}:${pressed ? 'down' : 'up'}:${scale.toFixed(2)}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const canvas = document.createElement('canvas');
  const size = Math.round(CURSOR_UNIT * scale);
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  if (!context) return '';
  context.scale(scale, scale);
  paintCursor(context, kind, pressed);
  const url = canvas.toDataURL('image/png');
  cache.set(key, url);
  return url;
}

export function getArtCursorCss(kind: ArtCursorKind | 'blocked', pressed: boolean): string {
  if (kind === 'blocked') return 'not-allowed';
  const scale = getCursorScale();
  const url = getCursorUrl(kind, pressed, scale);
  if (url.length === 0) return 'crosshair';
  const x = Math.round(CURSOR_HOT.x * scale);
  const y = Math.round(CURSOR_HOT.y * scale);
  return `url("${url}") ${x} ${y}, crosshair`;
}
