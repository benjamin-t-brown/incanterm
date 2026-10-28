import type { Rgb } from './color.js';
import { CellBuffer } from './cell-buffer.js';

export function plainText(buffer: CellBuffer): string {
  const rows: string[] = [];
  for (let y = 0; y < buffer.height; y++) {
    let row = '';
    for (let x = 0; x < buffer.width; x++) row += buffer.get(x, y).ch;
    rows.push(row);
  }
  return rows.join('\n');
}

export function encodeTerminal(buffer: CellBuffer, options?: { clear?: boolean }): string {
  const clear = options?.clear ?? true;
  let out = clear ? '\x1b[?7l\x1b[2J\x1b[H' : '';
  let fg: Rgb | undefined;
  let bg: Rgb | undefined;
  for (let y = 0; y < buffer.height; y++) {
    if (y > 0) out += '\r\n';
    for (let x = 0; x < buffer.width; x++) {
      const cell = buffer.get(x, y);
      if (!sameRgb(fg, cell.fg) || !sameRgb(bg, cell.bg)) {
        out += `\x1b[38;2;${cell.fg.r};${cell.fg.g};${cell.fg.b};48;2;${cell.bg.r};${cell.bg.g};${cell.bg.b}m`;
        fg = cell.fg;
        bg = cell.bg;
      }
      out += cell.ch;
    }
  }
  out += clear ? '\x1b[?7h' : '\x1b[0m\r\n';
  return out;
}

function sameRgb(current: Rgb | undefined, next: Rgb): boolean {
  return (
    current !== undefined && current.r === next.r && current.g === next.g && current.b === next.b
  );
}
