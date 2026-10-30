import { isSingleWidthGlyph } from './glyph.js';
import {
  PALETTE_IDS,
  defaultPalette,
  paletteRgb,
  type PaletteColor,
  type PaletteDocument,
} from './palette.js';
import { DEFAULT_SPRITE_FONT, isSpriteFontId, type SpriteFontId } from './terminal-cell.js';

export const ASSET_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const MAX_ID_LENGTH = 64;
export const MAX_SPRITE_WIDTH = 256;
export const MAX_SPRITE_HEIGHT = 128;
export const MAX_LAYERS = 32;
export const MAX_LAYER_NAME_LENGTH = 24;
export const MAX_FRAMES = 256;
export const DEFAULT_FRAME_DURATION_MS = 100;
export const DEFAULT_ANIMATION_DURATION_MS = 120;
export const MAX_FRAME_DURATION_MS = 600_000;

export type SpriteCell = {
  ch: string;
  fg: string;
  bg: string;
};

export type SpriteLayer = {
  id: string;
  name: string;
  visible: boolean;
  locked: boolean;
  cells: (SpriteCell | null)[];
};

export type SpriteFrame = {
  layers: SpriteLayer[];
};

export type SpriteDocument = {
  format: 'incanterm-sprite';
  version: 3;
  id: string;
  width: number;
  height: number;
  originX: number;
  originY: number;
  font: SpriteFontId;
  sprites: SpriteFrame[];
};

export type VisibleAnimationFrame = {
  sprite: string;
  index: number;
  durationMs: number;
};

export type InvisibleAnimationFrame = {
  invisible: true;
  durationMs: number;
};

export type AnimationFrame = VisibleAnimationFrame | InvisibleAnimationFrame;

export type AnimationDocument = {
  format: 'incanterm-animation';
  version: 1;
  id: string;
  loop: boolean;
  defaultDurationMs: number;
  frames: AnimationFrame[];
};

export type EdAsciiDocument = {
  format: 'ed-ascii';
  version: 1;
  width: number;
  height: number;
  cells: { ch: string; fg: number; bg: number }[];
};

export type SchemaResult<T> = { ok: true; value: T } | { ok: false; error: string };

export function isAssetId(value: string): boolean {
  return value.length >= 1 && value.length <= MAX_ID_LENGTH && ASSET_ID.test(value);
}

export function blankCell(): SpriteCell {
  return { ch: ' ', fg: 'white', bg: 'black' };
}

export function layerNameError(name: string): string | null {
  const trimmed = name.trim();
  if (trimmed.length < 1 || trimmed.length > MAX_LAYER_NAME_LENGTH) {
    return `Layer name must be 1 to ${MAX_LAYER_NAME_LENGTH} characters`;
  }
  for (let index = 0; index < trimmed.length; index++) {
    const code = trimmed.charCodeAt(index);
    if (code < 0x20 || code === 0x7f) return 'Layer name cannot include control characters';
  }
  return null;
}

export function emptySpriteFrame(width: number, height: number): SpriteFrame {
  return { layers: [emptyLayer('layer-1', 'Layer 1', width * height)] };
}

export function createSprite(id: string, width: number, height: number): SpriteDocument {
  return {
    format: 'incanterm-sprite',
    version: 3,
    id,
    width,
    height,
    originX: 0,
    originY: 0,
    font: DEFAULT_SPRITE_FONT,
    sprites: [emptySpriteFrame(width, height)],
  };
}

export function createAnimation(id: string): AnimationDocument {
  return {
    format: 'incanterm-animation',
    version: 1,
    id,
    loop: true,
    defaultDurationMs: DEFAULT_ANIMATION_DURATION_MS,
    frames: [],
  };
}

export function isInvisibleFrame(frame: AnimationFrame): frame is InvisibleAnimationFrame {
  return 'invisible' in frame && frame.invisible === true;
}

export function flattenSprite(sprite: SpriteDocument, frameIndex = 0): SpriteCell[] {
  const cells = Array.from({ length: sprite.width * sprite.height }, blankCell);
  const frame = sprite.sprites[frameIndex];
  if (!frame) return cells;
  for (const layer of frame.layers) {
    if (!layer.visible) continue;
    for (let index = 0; index < layer.cells.length; index++) {
      const cell = layer.cells[index];
      if (cell) cells[index] = { ch: cell.ch, fg: cell.fg, bg: cell.bg };
    }
  }
  return cells;
}

export function parsePalette(value: unknown): SchemaResult<PaletteDocument> {
  const record = asObject(value);
  if (!record) return fail('Palette must be an object');
  if (record.format !== 'incanterm-palette' || record.version !== 1) {
    return fail('Palette must be incanterm-palette version 1');
  }
  if (!Array.isArray(record.colors) || record.colors.length !== PALETTE_IDS.length) {
    return fail(`Palette must contain exactly ${PALETTE_IDS.length} colors`);
  }
  const colors: PaletteColor[] = [];
  for (let index = 0; index < PALETTE_IDS.length; index++) {
    const expected = PALETTE_IDS[index];
    const color = asObject(record.colors[index]);
    if (!color || color.id !== expected) {
      return fail(`Palette color ${index + 1} must keep id ${expected}`);
    }
    if (typeof color.rgb !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(color.rgb)) {
      return fail(`Palette color ${expected} needs an #rrggbb value`);
    }
    colors.push({ id: expected, rgb: color.rgb.toLowerCase() });
  }
  return { ok: true, value: { format: 'incanterm-palette', version: 1, colors } };
}

export function parseSprite(value: unknown): SchemaResult<SpriteDocument> {
  const record = asObject(value);
  if (!record) return fail('Sprite must be an object');
  if (
    record.format !== 'incanterm-sprite' ||
    (record.version !== 1 && record.version !== 2 && record.version !== 3)
  ) {
    return fail('Sprite must be incanterm-sprite version 1, 2, or 3');
  }
  const id = readId(record.id, 'Sprite id');
  if (!id.ok) return id;
  const width = readInt(record.width, 'Sprite width', 1, MAX_SPRITE_WIDTH);
  if (!width.ok) return width;
  const height = readInt(record.height, 'Sprite height', 1, MAX_SPRITE_HEIGHT);
  if (!height.ok) return height;
  const originX = readInt(record.originX, 'Sprite originX', 0, width.value - 1);
  if (!originX.ok) return originX;
  const originY = readInt(record.originY, 'Sprite originY', 0, height.value - 1);
  if (!originY.ok) return originY;
  const font = readFont(record.font);
  if (!font.ok) return font;
  const count = width.value * height.value;
  const sprites =
    record.version === 3 ? readSprites(record.sprites, count) : readLegacySprites(record, count);
  if (!sprites.ok) return sprites;
  return {
    ok: true,
    value: {
      format: 'incanterm-sprite',
      version: 3,
      id: id.value,
      width: width.value,
      height: height.value,
      originX: originX.value,
      originY: originY.value,
      font: font.value,
      sprites: sprites.value,
    },
  };
}

export function parseAnimation(value: unknown): SchemaResult<AnimationDocument> {
  const record = asObject(value);
  if (!record) return fail('Animation must be an object');
  if (record.format !== 'incanterm-animation' || record.version !== 1) {
    return fail('Animation must be incanterm-animation version 1');
  }
  const id = readId(record.id, 'Animation id');
  if (!id.ok) return id;
  if (typeof record.loop !== 'boolean') return fail('Animation loop must be true or false');
  const defaultDurationMs =
    record.defaultDurationMs === undefined
      ? { ok: true as const, value: DEFAULT_ANIMATION_DURATION_MS }
      : readInt(record.defaultDurationMs, 'Animation defaultDurationMs', 1, MAX_FRAME_DURATION_MS);
  if (!defaultDurationMs.ok) return defaultDurationMs;
  if (!Array.isArray(record.frames) || record.frames.length > MAX_FRAMES) {
    return fail(`Animation must contain at most ${MAX_FRAMES} frames`);
  }
  const frames: AnimationFrame[] = [];
  for (let index = 0; index < record.frames.length; index++) {
    const frame = asObject(record.frames[index]);
    if (!frame) return fail(`Animation frame ${index} must be an object`);
    const durationMs = readInt(
      frame.durationMs,
      `Animation frame ${index} durationMs`,
      1,
      MAX_FRAME_DURATION_MS,
    );
    if (!durationMs.ok) return durationMs;
    if (frame.invisible === true) {
      frames.push({ invisible: true, durationMs: durationMs.value });
      continue;
    }
    const sprite = readId(frame.sprite, `Animation frame ${index} sprite`);
    if (!sprite.ok) return sprite;
    const spriteIndex = readInt(frame.index, `Animation frame ${index} index`, 0, MAX_FRAMES - 1);
    if (!spriteIndex.ok) return spriteIndex;
    frames.push({
      sprite: sprite.value,
      index: spriteIndex.value,
      durationMs: durationMs.value,
    });
  }
  return {
    ok: true,
    value: {
      format: 'incanterm-animation',
      version: 1,
      id: id.value,
      loop: record.loop,
      defaultDurationMs: defaultDurationMs.value,
      frames,
    },
  };
}

export function importEdAscii(id: string, value: unknown): SchemaResult<SpriteDocument> {
  if (!isAssetId(id)) return fail('Import id must be a short lowercase id');
  const record = asObject(value);
  if (!record) return fail('ed-ascii document must be an object');
  if (record.format !== 'ed-ascii' || record.version !== 1) {
    return fail('Document must be ed-ascii version 1');
  }
  const width = readInt(record.width, 'ed-ascii width', 1, MAX_SPRITE_WIDTH);
  if (!width.ok) return width;
  const height = readInt(record.height, 'ed-ascii height', 1, MAX_SPRITE_HEIGHT);
  if (!height.ok) return height;
  if (!Array.isArray(record.cells) || record.cells.length !== width.value * height.value) {
    return fail(`ed-ascii cells must contain ${width.value * height.value} entries`);
  }
  const cells: SpriteCell[] = [];
  for (let index = 0; index < record.cells.length; index++) {
    const cell = asObject(record.cells[index]);
    if (!cell) return fail(`ed-ascii cell ${index} must be an object`);
    if (typeof cell.ch !== 'string' || !isSingleWidthGlyph(cell.ch)) {
      return fail(`ed-ascii cell ${index} character must be one single-width glyph`);
    }
    const fg = readIndex(cell.fg, `ed-ascii cell ${index} fg`);
    if (!fg.ok) return fg;
    const bg = readIndex(cell.bg, `ed-ascii cell ${index} bg`);
    if (!bg.ok) return bg;
    cells.push({ ch: cell.ch, fg: PALETTE_IDS[fg.value], bg: PALETTE_IDS[bg.value] });
  }
  return {
    ok: true,
    value: {
      format: 'incanterm-sprite',
      version: 3,
      id,
      width: width.value,
      height: height.value,
      originX: 0,
      originY: 0,
      font: DEFAULT_SPRITE_FONT,
      sprites: [{ layers: [emptyLayer('layer-1', 'Layer 1', cells.length, cells)] }],
    },
  };
}

export function exportAscii(sprite: SpriteDocument, frameIndex = 0): string {
  const cells = flattenSprite(sprite, frameIndex);
  let output = '';
  for (let y = 0; y < sprite.height; y++) {
    for (let x = 0; x < sprite.width; x++) output += cells[y * sprite.width + x].ch;
    output += '\r\n';
  }
  return output;
}

export function exportTruecolor(
  sprite: SpriteDocument,
  palette: PaletteDocument,
): SchemaResult<string> {
  const cells = flattenSprite(sprite);
  let output = '';
  let previousFg = '';
  let previousBg = '';
  for (let y = 0; y < sprite.height; y++) {
    for (let x = 0; x < sprite.width; x++) {
      const cell = cells[y * sprite.width + x];
      if (cell.fg !== previousFg || cell.bg !== previousBg) {
        const fg = readRgb(palette, cell.fg, 'foreground');
        if (!fg.ok) return fg;
        const bg = readRgb(palette, cell.bg, 'background');
        if (!bg.ok) return bg;
        output += `\u001b[38;2;${fg.value};48;2;${bg.value}m`;
        previousFg = cell.fg;
        previousBg = cell.bg;
      }
      output += cell.ch;
    }
    output += '\u001b[0m\r\n';
    previousFg = '';
    previousBg = '';
  }
  return { ok: true, value: output };
}

export function canonicalPalette(): PaletteDocument {
  return defaultPalette();
}

function emptyLayer(
  id: string,
  name: string,
  count: number,
  cells?: (SpriteCell | null)[],
): SpriteLayer {
  return {
    id,
    name,
    visible: true,
    locked: false,
    cells: cells ?? Array.from({ length: count }, () => null),
  };
}

function readLegacySprites(
  record: Record<string, unknown>,
  count: number,
): SchemaResult<SpriteFrame[]> {
  const layers =
    record.version === 1
      ? readVersion1Layer(record.cells, count)
      : readLayers(record.layers, count);
  if (!layers.ok) return layers;
  return { ok: true, value: [{ layers: layers.value }] };
}

function readSprites(value: unknown, count: number): SchemaResult<SpriteFrame[]> {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_FRAMES) {
    return fail(`Sprite must contain 1 to ${MAX_FRAMES} frames`);
  }
  const sprites: SpriteFrame[] = [];
  for (let index = 0; index < value.length; index++) {
    const frame = asObject(value[index]);
    if (!frame) return fail(`Sprite frame ${index + 1} must be an object`);
    const layers = readLayers(frame.layers, count);
    if (!layers.ok) return fail(`Sprite frame ${index + 1}: ${layers.error}`);
    sprites.push({ layers: layers.value });
  }
  return { ok: true, value: sprites };
}

function readVersion1Layer(value: unknown, count: number): SchemaResult<SpriteLayer[]> {
  if (!Array.isArray(value) || value.length !== count) {
    return fail(`Sprite cells must contain ${count} entries`);
  }
  const cells: SpriteCell[] = [];
  for (let index = 0; index < value.length; index++) {
    const cell = readCell(value[index], `Sprite cell ${index}`);
    if (!cell.ok) return cell;
    cells.push(cell.value);
  }
  return { ok: true, value: [emptyLayer('layer-1', 'Layer 1', count, cells)] };
}

function readLayers(value: unknown, count: number): SchemaResult<SpriteLayer[]> {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_LAYERS) {
    return fail(`Sprite must contain 1 to ${MAX_LAYERS} layers`);
  }
  const layers: SpriteLayer[] = [];
  const ids = new Set<string>();
  for (let index = 0; index < value.length; index++) {
    const layer = asObject(value[index]);
    if (!layer) return fail(`Sprite layer ${index + 1} must be an object`);
    const id = readId(layer.id, `Sprite layer ${index + 1} id`);
    if (!id.ok) return id;
    if (ids.has(id.value)) return fail(`Sprite layer id ${id.value} is repeated`);
    ids.add(id.value);
    if (typeof layer.name !== 'string') return fail(`Sprite layer ${index + 1} name must be text`);
    const nameError = layerNameError(layer.name);
    if (nameError) return fail(`Sprite layer ${index + 1}: ${nameError}`);
    if (typeof layer.visible !== 'boolean') {
      return fail(`Sprite layer ${index + 1} visible must be true or false`);
    }
    const locked = layer.locked === undefined ? false : layer.locked;
    if (typeof locked !== 'boolean') {
      return fail(`Sprite layer ${index + 1} locked must be true or false`);
    }
    if (!Array.isArray(layer.cells) || layer.cells.length !== count) {
      return fail(`Sprite layer ${index + 1} must contain ${count} cells`);
    }
    const cells: (SpriteCell | null)[] = [];
    for (let cellIndex = 0; cellIndex < layer.cells.length; cellIndex++) {
      const entry = layer.cells[cellIndex];
      if (entry === null) {
        cells.push(null);
        continue;
      }
      const cell = readCell(entry, `Sprite layer ${index + 1} cell ${cellIndex}`);
      if (!cell.ok) return cell;
      cells.push(cell.value);
    }
    layers.push({
      id: id.value,
      name: layer.name.trim(),
      visible: layer.visible,
      locked,
      cells,
    });
  }
  return { ok: true, value: layers };
}

function readCell(value: unknown, label: string): SchemaResult<SpriteCell> {
  const cell = asObject(value);
  if (!cell) return fail(`${label} must be an object`);
  if (typeof cell.ch !== 'string' || !isSingleWidthGlyph(cell.ch)) {
    return fail(`${label} character must be one single-width glyph`);
  }
  if (typeof cell.fg !== 'string' || !PALETTE_IDS.includes(cell.fg)) {
    return fail(`${label} foreground must be a palette id`);
  }
  if (typeof cell.bg !== 'string' || !PALETTE_IDS.includes(cell.bg)) {
    return fail(`${label} background must be a palette id`);
  }
  return { ok: true, value: { ch: cell.ch, fg: cell.fg, bg: cell.bg } };
}

function readRgb(palette: PaletteDocument, id: string, label: string): SchemaResult<string> {
  const hex = paletteRgb(palette, id);
  if (!hex) return fail(`Missing palette color for ${label}`);
  const channels = [hex.slice(1, 3), hex.slice(3, 5), hex.slice(5, 7)].map((part) =>
    Number.parseInt(part, 16),
  );
  return { ok: true, value: channels.join(';') };
}

function readId(value: unknown, label: string): SchemaResult<string> {
  if (typeof value !== 'string' || !isAssetId(value)) {
    return fail(`${label} must be a short lowercase id`);
  }
  return { ok: true, value };
}

function readInt(value: unknown, label: string, min: number, max: number): SchemaResult<number> {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    return fail(`${label} must be an integer from ${min} to ${max}`);
  }
  return { ok: true, value };
}

function readIndex(value: unknown, label: string): SchemaResult<number> {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 15) {
    return fail(`${label} must be an ANSI color index from 0 to 15`);
  }
  return { ok: true, value };
}

function readFont(value: unknown): SchemaResult<SpriteFontId> {
  if (value === undefined) return { ok: true, value: DEFAULT_SPRITE_FONT };
  if (typeof value !== 'string' || !isSpriteFontId(value)) {
    return fail('Sprite font must be a known terminal typeface');
  }
  return { ok: true, value };
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function fail(error: string): SchemaResult<never> {
  return { ok: false, error };
}
