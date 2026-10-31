import {
  MAX_FRAMES,
  MAX_LAYERS,
  MAX_SPRITE_HEIGHT,
  MAX_SPRITE_WIDTH,
  parseSprite,
  type SchemaResult,
  type SpriteCell,
  type SpriteDocument,
} from '../schema.js';

type StoredCells = { indices: number[] } | { runs: [number, number][] };

// The API and editor keep full cell objects. Only the JSON on disk uses indexes.
export function encodeStoredSprite(sprite: SpriteDocument): string {
  const cellPalette: [string, string, string][] = [];
  const paletteIndex = new Map<string, number>();
  const sprites = sprite.sprites.map((frame) => ({
    layers: frame.layers.map((layer) => {
      const indices = layer.cells.map((cell) => {
        if (cell === null) return 0;
        const entry: [string, string, string] = [cell.ch, cell.fg, cell.bg];
        const key = JSON.stringify(entry);
        let index = paletteIndex.get(key);
        if (index === undefined) {
          index = cellPalette.push(entry);
          paletteIndex.set(key, index);
        }
        return index;
      });
      const runs: [number, number][] = [];
      for (const index of indices) {
        const last = runs[runs.length - 1];
        if (last && last[1] === index) last[0]++;
        else runs.push([1, index]);
      }
      const cells: StoredCells =
        JSON.stringify(runs).length < JSON.stringify(indices).length ? { runs } : { indices };
      return {
        id: layer.id,
        name: layer.name,
        visible: layer.visible,
        locked: layer.locked,
        cells,
      };
    }),
  }));
  return `${JSON.stringify({
    format: sprite.format,
    version: sprite.version,
    id: sprite.id,
    ...(sprite.label !== sprite.id ? { label: sprite.label } : {}),
    width: sprite.width,
    height: sprite.height,
    originX: sprite.originX,
    originY: sprite.originY,
    font: sprite.font,
    cellPalette,
    sprites,
  })}\n`;
}

export function parseStoredSprite(value: unknown): SchemaResult<SpriteDocument> {
  const record = asObject(value);
  if (!record || !('cellPalette' in record)) return parseSprite(value);
  const count = readCellCount(record);
  if (count === null) return fail('Stored sprite dimensions are invalid');
  if (
    !Array.isArray(record.cellPalette) ||
    record.cellPalette.length > count * MAX_LAYERS * MAX_FRAMES
  ) {
    return fail('Stored sprite cell palette is invalid');
  }
  const cellPalette = record.cellPalette;
  if (
    !Array.isArray(record.sprites) ||
    record.sprites.length < 1 ||
    record.sprites.length > MAX_FRAMES
  ) {
    return fail('Stored sprite frames are invalid');
  }
  const sprites = [];
  for (const frameValue of record.sprites) {
    const frame = asObject(frameValue);
    if (
      !frame ||
      !Array.isArray(frame.layers) ||
      frame.layers.length < 1 ||
      frame.layers.length > MAX_LAYERS
    ) {
      return fail('Stored sprite layers are invalid');
    }
    const layers = [];
    for (const layerValue of frame.layers) {
      const layer = asObject(layerValue);
      if (!layer) return fail('Stored sprite layer is invalid');
      const decoded = decodeCells(layer.cells, cellPalette, count);
      if (!decoded.ok) return decoded;
      layers.push({ ...layer, cells: decoded.value });
    }
    sprites.push({ ...frame, layers });
  }
  return parseSprite({ ...record, sprites });
}

function decodeCells(
  value: unknown,
  palette: unknown[],
  count: number,
): SchemaResult<(SpriteCell | null)[]> {
  const encoded = asObject(value);
  if (!encoded) return fail('Stored sprite cells are invalid');
  const indices: number[] = [];
  if ('indices' in encoded) {
    if (!Array.isArray(encoded.indices) || encoded.indices.length !== count) {
      return fail(`Stored sprite layer must contain ${count} cell indexes`);
    }
    indices.push(...encoded.indices);
  } else if ('runs' in encoded) {
    if (!Array.isArray(encoded.runs) || encoded.runs.length > count) {
      return fail('Stored sprite cell runs are invalid');
    }
    for (const run of encoded.runs) {
      if (
        !Array.isArray(run) ||
        run.length !== 2 ||
        !Number.isInteger(run[0]) ||
        run[0] < 1 ||
        indices.length + run[0] > count
      ) {
        return fail('Stored sprite cell run length is invalid');
      }
      for (let index = 0; index < run[0]; index++) indices.push(run[1]);
    }
    if (indices.length !== count) return fail(`Stored sprite layer must contain ${count} cells`);
  } else return fail('Stored sprite cells need indices or runs');

  const cells: (SpriteCell | null)[] = [];
  for (const index of indices) {
    if (!Number.isInteger(index) || index < 0 || index > palette.length) {
      return fail('Stored sprite cell palette index is invalid');
    }
    if (index === 0) {
      cells.push(null);
      continue;
    }
    const entry = palette[index - 1];
    if (!Array.isArray(entry) || entry.length !== 3) {
      return fail('Stored sprite cell palette entry is invalid');
    }
    cells.push({ ch: entry[0], fg: entry[1], bg: entry[2] });
  }
  return { ok: true, value: cells };
}

function readCellCount(record: Record<string, unknown>): number | null {
  if (
    !Number.isInteger(record.width) ||
    !Number.isInteger(record.height) ||
    (record.width as number) < 1 ||
    (record.width as number) > MAX_SPRITE_WIDTH ||
    (record.height as number) < 1 ||
    (record.height as number) > MAX_SPRITE_HEIGHT
  )
    return null;
  return (record.width as number) * (record.height as number);
}

function asObject(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function fail(error: string): SchemaResult<never> {
  return { ok: false, error };
}
