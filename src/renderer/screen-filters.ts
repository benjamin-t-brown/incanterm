import type { CellBuffer, Cell } from '../game/cell-buffer.js';
import type { Rgb } from '../game/color.js';
import type { Rect } from './ui/element.js';
import { DEFAULT_GROWTH_SEQUENCES, DEFAULT_SHORT_GROWTH_SEQUENCES, getRandomGrowthSequence, GROWING_FG, isShortCharacter } from './glyph-growth.js';

/** Absolute screen coordinates; reads and writes cannot escape the assigned region. */
export class ScreenFilterContext {
  constructor(private readonly buffer: CellBuffer, readonly region: Readonly<Rect>) {}

  getCell(x: number, y: number): Cell {
    this.assertInsideRegion(x, y);
    return this.buffer.get(x, y);
  }

  setCell(x: number, y: number, cell: Cell): void {
    this.assertInsideRegion(x, y);
    this.buffer.set(x, y, cell);
  }

  private assertInsideRegion(x: number, y: number): void {
    const { region } = this;
    if (!Number.isInteger(x) || !Number.isInteger(y) || x < region.x || y < region.y ||
      x >= region.x + region.width || y >= region.y + region.height)
      throw new Error(`Cell ${x},${y} is outside the screen filter region`);
  }
}

/** An operation on a clipped, already-rendered region of a terminal frame. */
export type ScreenFilter = (ctx: ScreenFilterContext, elapsedMs: number) => void;
export type ScreenFilterRegion = Readonly<Rect> | ((buffer: CellBuffer) => Readonly<Rect> | undefined);

type FilterEntry = {
  filter: ScreenFilter;
  region: ScreenFilterRegion;
  startedAtMs: number;
};

export class ScreenFilterPipeline {
  private readonly entries: FilterEntry[] = [];

  /** Returns a disposer so an effect can be removed without affecting other filters. */
  addFilter(filter: ScreenFilter, region: ScreenFilterRegion, startedAtMs = Date.now()): () => void {
    const entry = { filter, region, startedAtMs };
    this.entries.push(entry);
    return () => {
      const index = this.entries.indexOf(entry);
      if (index >= 0) this.entries.splice(index, 1);
    };
  }

  clearFilters(): void {
    this.entries.length = 0;
  }

  /** Apply in insertion order; each filter sees the previous filter's output. */
  applyFilters(buffer: CellBuffer, nowMs = Date.now()): void {
    for (const entry of [...this.entries]) {
      const region = typeof entry.region === 'function' ? entry.region(buffer) : entry.region;
      if (!region) continue;
      if (![region.x, region.y, region.width, region.height].every(Number.isFinite))
        throw new Error('Screen filter region must have finite coordinates and dimensions');
      const left = Math.max(0, Math.floor(region.x));
      const top = Math.max(0, Math.floor(region.y));
      const right = Math.min(buffer.width, Math.ceil(region.x + region.width));
      const bottom = Math.min(buffer.height, Math.ceil(region.y + region.height));
      if (right <= left || bottom <= top) continue;
      entry.filter(new ScreenFilterContext(buffer, { x: left, y: top, width: right - left, height: bottom - top }),
        Math.max(0, nowMs - entry.startedAtMs));
    }
  }
}

/** Recolors visible characters without touching spaces or their backgrounds. */
export function createTextColorFilter(fg: Rgb): ScreenFilter {
  return (ctx) => {
    const { region } = ctx;
    for (let y = region.y; y < region.y + region.height; y++) {
      for (let x = region.x; x < region.x + region.width; x++) {
        const cell = ctx.getCell(x, y);
        if (cell.ch !== ' ') ctx.setCell(x, y, { ...cell, fg });
      }
    }
  };
}

function getGrayscaleColor({ r, g, b }: Rgb): Rgb {
  const gray = Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b);
  return { r: gray, g: gray, b: gray };
}

/** Desaturates foregrounds and backgrounds without changing their glyphs. */
export function applyGrayscaleFilter(ctx: ScreenFilterContext): void {
  const { region } = ctx;
  for (let y = region.y; y < region.y + region.height; y++) {
    for (let x = region.x; x < region.x + region.width; x++) {
      const { ch, fg, bg } = ctx.getCell(x, y);
      ctx.setCell(x, y, { ch, fg: getGrayscaleColor(fg), bg: getGrayscaleColor(bg) });
    }
  }
}

const BLACK = { r: 0, g: 0, b: 0 };
const WHITE = { r: 255, g: 255, b: 255 };
const BLACK_CELL = { ch: ' ', fg: BLACK, bg: BLACK };
const TALL_SHRINK_GLYPHS = '+:,.';
const SHORT_SHRINK_GLYPHS = '-,.';

/** Two left-to-right passes: recolor and shrink on fade-out, grow and restore color on fade-in. */
export function createGlyphSweepFadeFilter(durationMs: number, reverse = false): ScreenFilter {
  if (!Number.isFinite(durationMs) || durationMs < 0)
    throw new Error('Glyph sweep fade requires a nonnegative durationMs');
  return (ctx, elapsedMs) => {
    const elapsedFraction = durationMs === 0 ? 1 : Math.min(1, elapsedMs / durationMs);
    const progress = reverse ? 1 - elapsedFraction : elapsedFraction;
    if (progress <= 0) return;
    const { x: left, y: top, width, height } = ctx.region;
    const monochromeSweep = progress * 2;
    const eraseSweep = monochromeSweep - 1;
    for (let offset = 0; offset < width; offset++) {
      const column = offset / Math.max(1, width - 1);
      if (column > monochromeSweep) break;
      // Reverse the spatial offset as well as time so fade-in still starts on the left.
      const x = left + (reverse ? width - 1 - offset : offset);
      // Stagger the start of each column while leaving time for the full glyph animation.
      const shrink = eraseSweep * 2 - column;
      for (let y = top; y < top + height; y++) {
        if (shrink >= 1) {
          ctx.setCell(x, y, BLACK_CELL);
          continue;
        }
        let { ch } = ctx.getCell(x, y);
        if (shrink > 0 && ch !== ' ') {
          const glyphs = isShortCharacter(ch) ? SHORT_SHRINK_GLYPHS : TALL_SHRINK_GLYPHS;
          ch = glyphs[Math.floor(shrink * glyphs.length)];
        }
        ctx.setCell(x, y, { ch, fg: WHITE, bg: BLACK });
      }
    }
  };
}

/** Cells in each row grow together; rows may start later without changing sequence choices across frames. */
export function createGlyphGrowthRevealFilter(options: {
  stepDurationMs: number;
  rowDelayMs?: number;
  growthSequences?: readonly string[];
  shortGrowthSequences?: readonly string[];
}): ScreenFilter {
  const { stepDurationMs, rowDelayMs = 0 } = options;
  const tall = options.growthSequences ?? DEFAULT_GROWTH_SEQUENCES;
  const short = options.shortGrowthSequences ?? DEFAULT_SHORT_GROWTH_SEQUENCES;
  const stages = tall[0]?.length;
  if (!Number.isFinite(stepDurationMs) || stepDurationMs <= 0 ||
    !Number.isFinite(rowDelayMs) || rowDelayMs < 0 || !stages || !short.length ||
    [...tall, ...short].some((sequence) => typeof sequence !== 'string' || sequence.length !== stages))
    throw new Error('Glyph growth requires a positive stepDurationMs, nonnegative rowDelayMs and equal-length sequences');
  const chosen = new Map<string, string>();
  return (ctx, elapsedMs) => {
    const { region } = ctx;
    for (let y = region.y; y < region.y + region.height; y++) {
      const age = elapsedMs - (y - region.y) * rowDelayMs;
      const stage = Math.floor(age / stepDurationMs);
      if (stage >= stages) continue;
      for (let x = region.x; x < region.x + region.width; x++) {
        const cell = ctx.getCell(x, y);
        if (cell.ch === ' ') continue;
        if (age < 0) {
          ctx.setCell(x, y, { ...cell, ch: ' ' });
          continue;
        }
        const key = `${x - region.x},${y - region.y}`;
        let sequence = chosen.get(key);
        if (!sequence) {
          sequence = getRandomGrowthSequence(cell.ch, tall, short);
          chosen.set(key, sequence);
        }
        ctx.setCell(x, y, { ...cell, ch: sequence[stage], fg: GROWING_FG });
      }
    }
  };
}

/** Replaces visible glyphs in a bottom-to-top wave, then clears them. */
export function createGlyphExitFilter(options: {
  stepDurationMs: number;
  rowDelayMs: number;
  glyphs: string;
}): ScreenFilter {
  const { stepDurationMs, rowDelayMs, glyphs } = options;
  if (!Number.isFinite(stepDurationMs) || stepDurationMs <= 0 ||
    !Number.isFinite(rowDelayMs) || rowDelayMs < 0 || !glyphs.length)
    throw new Error('Glyph exit requires a positive stepDurationMs, nonnegative rowDelayMs and glyphs');
  return (ctx, elapsedMs) => {
    const { region } = ctx;
    for (let y = region.y; y < region.y + region.height; y++) {
      const age = elapsedMs - (region.y + region.height - 1 - y) * rowDelayMs;
      if (age < 0) continue;
      const stage = Math.floor(age / stepDurationMs);
      for (let x = region.x; x < region.x + region.width; x++) {
        const cell = ctx.getCell(x, y);
        if (cell.ch !== ' ') ctx.setCell(x, y, {
          ...cell, ch: glyphs[stage] ?? ' ', fg: GROWING_FG,
        });
      }
    }
  };
}

/** Pixelates terminal cells in blocks that shrink to the original image over time. */
export function createPixelateRevealFilter(options: { durationMs: number; blockSize: number }): ScreenFilter {
  const { durationMs, blockSize } = options;
  if (!Number.isFinite(durationMs) || durationMs <= 0 || !Number.isInteger(blockSize) || blockSize < 1)
    throw new Error('Pixelate reveal requires a positive durationMs and integer blockSize');
  return (ctx, elapsedMs) => {
    const size = Math.max(1, Math.ceil(blockSize * (1 - Math.min(elapsedMs / durationMs, 1))));
    if (size === 1) return;
    const { region } = ctx;
    const right = region.x + region.width;
    const bottom = region.y + region.height;
    for (let y = region.y; y < bottom; y += size) {
      for (let x = region.x; x < right; x += size) {
        const sample = ctx.getCell(x, y);
        for (let py = y; py < Math.min(y + size, bottom); py++) {
          for (let px = x; px < Math.min(x + size, right); px++) ctx.setCell(px, py, sample);
        }
      }
    }
  };
}
