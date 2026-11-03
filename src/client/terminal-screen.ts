import { CellBuffer, type Cell } from '../game/cell-buffer.js';

const EMPTY: Cell = { ch: ' ', fg: { r: 255, g: 255, b: 255 }, bg: { r: 0, g: 0, b: 0 } };

// Decodes the cursor, clear and true-color sequences emitted by our server.
// WebSocket messages contain complete updates, even when they are cell deltas.
export class TerminalScreen {
  buffer = new CellBuffer(80, 24, EMPTY);
  private x = 0;
  private y = 0;
  private ink = { ...EMPTY };

  apply(data: string, cols: number, rows: number): Set<number> {
    const dirty = new Set<number>();
    if (cols !== this.buffer.width || rows !== this.buffer.height) {
      this.buffer = new CellBuffer(cols, rows, EMPTY);
      this.x = this.y = 0;
      for (let y = 0; y < rows; y++) dirty.add(y);
    }
    const writeText = (text: string): void => {
      for (const ch of text) {
        if (ch === '\r') {
          this.x = 0;
          continue;
        }
        if (ch === '\n') {
          this.y++;
          continue;
        }
        if (this.x >= 0 && this.x < cols && this.y >= 0 && this.y < rows) {
          this.buffer.set(this.x, this.y, { ...this.ink, ch });
          dirty.add(this.y);
        }
        this.x++;
      }
    };
    const csi = new RegExp(`${String.fromCharCode(27)}\\[([0-9;?]*)([A-Za-z])`, 'g');
    let offset = 0;
    for (const match of data.matchAll(csi)) {
      writeText(data.slice(offset, match.index));
      const codes = match[1].split(';').map(Number);
      if (match[2] === 'H') {
        this.y = (codes[0] || 1) - 1;
        this.x = (codes[1] || 1) - 1;
      } else if (match[2] === 'J' && codes[0] === 2) {
        this.buffer = new CellBuffer(cols, rows, { ...this.ink, ch: ' ' });
        for (let y = 0; y < rows; y++) dirty.add(y);
      } else if (match[2] === 'm') {
        for (let i = 0; i < codes.length; i++) {
          if ((codes[i] === 38 || codes[i] === 48) && codes[i + 1] === 2) {
            const color = { r: codes[i + 2], g: codes[i + 3], b: codes[i + 4] };
            this.ink = { ...this.ink, [codes[i] === 38 ? 'fg' : 'bg']: color };
            i += 4;
          } else if (codes[i] === 0) this.ink = { ...EMPTY };
        }
      }
      offset = match.index + match[0].length;
    }
    writeText(data.slice(offset));
    return dirty;
  }
}
