import type { Rgb } from './color.js';
import type { CellBuffer } from './cell-buffer.js';

export function getPlainText(buffer: CellBuffer): string {
  const rows: string[] = [];
  for (let y = 0; y < buffer.height; y++) {
    let row = '';
    for (let x = 0; x < buffer.width; x++) row += buffer.get(x, y).ch;
    rows.push(row);
  }
  return rows.join('\n');
}

export function encodeTerminal(
  buffer: CellBuffer,
  options?: { clear?: boolean; fullScreen?: boolean },
): string {
  const clear = options?.clear ?? true;
  const fullScreen = options?.fullScreen ?? clear;
  // Synchronized output hides partial frames on terminals that support it.
  // Normal animation frames overwrite in place instead of blanking the screen.
  let out = fullScreen ? '\x1b[?2026h\x1b[?7l' : '';
  if (clear) out += '\x1b[2J';
  if (fullScreen) out += '\x1b[H';
  let fg: Rgb | undefined;
  let bg: Rgb | undefined;
  for (let y = 0; y < buffer.height; y++) {
    if (y > 0) out += '\r\n';
    for (let x = 0; x < buffer.width; x++) {
      const cell = buffer.get(x, y);
      if (!isSameRgb(fg, cell.fg) || !isSameRgb(bg, cell.bg)) {
        out += `\x1b[38;2;${cell.fg.r};${cell.fg.g};${cell.fg.b};48;2;${cell.bg.r};${cell.bg.g};${cell.bg.b}m`;
        fg = cell.fg;
        bg = cell.bg;
      }
      out += cell.ch;
    }
  }
  out += fullScreen ? '\x1b[?7h\x1b[?2026l' : '\x1b[0m\r\n';
  return out;
}

function isSameRgb(current: Rgb | undefined, next: Rgb): boolean {
  return (
    current !== undefined && current.r === next.r && current.g === next.g && current.b === next.b
  );
}

// Each update is relative to the last frame accepted by the transport, not the last tick.
export function encodeTerminalDiff(buffer: CellBuffer, previous?: CellBuffer): string {
  if (!previous || previous.width !== buffer.width || previous.height !== buffer.height)
    return encodeTerminal(buffer);
  let out = '';
  let fg: Rgb | undefined;
  let bg: Rgb | undefined;
  for (let y = 0; y < buffer.height; y++) {
    let inRun = false;
    for (let x = 0; x < buffer.width; x++) {
      const cell = buffer.get(x, y),
        before = previous.get(x, y);
      if (cell.ch === before.ch && isSameRgb(before.fg, cell.fg) && isSameRgb(before.bg, cell.bg)) {
        inRun = false;
        continue;
      }
      if (!inRun) out += `\x1b[${y + 1};${x + 1}H`;
      inRun = true;
      if (!isSameRgb(fg, cell.fg) || !isSameRgb(bg, cell.bg)) {
        out += `\x1b[38;2;${cell.fg.r};${cell.fg.g};${cell.fg.b};48;2;${cell.bg.r};${cell.bg.g};${cell.bg.b}m`;
        fg = cell.fg;
        bg = cell.bg;
      }
      out += cell.ch;
    }
  }
  return out ? `\x1b[?2026h\x1b[?7l${out}\x1b[?7h\x1b[?2026l` : '';
}
