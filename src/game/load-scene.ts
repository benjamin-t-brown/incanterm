import fs from 'node:fs/promises';
import path from 'node:path';
import { parseHexColor, type Rgb } from './color.js';
import type { Cell } from './cell-buffer.js';
import { Prop, Scene, type DepthMode } from './scene.js';
import { Sprite } from './sprite.js';

export const TEST_SCENE_ID = 'test-room';

export function defaultAssetsRoot(): string {
  return path.join(process.cwd(), 'assets');
}

export async function loadScene(assetsRoot: string, sceneId: string): Promise<Scene> {
  const scenePath = assetPath(assetsRoot, 'scenes', sceneId);
  const record = readObject(await readJson(scenePath), scenePath);
  expectFormat(record, scenePath, 'incanterm-scene');
  const id = readId(record.id, `${scenePath} id`);
  if (id !== sceneId) throw new Error(`${scenePath} id is ${id}, expected ${sceneId}`);
  const width = readInt(record.width, `${scenePath} width`, 1, 256);
  const height = readInt(record.height, `${scenePath} height`, 1, 128);
  const depthMode = readDepthMode(record.depthMode, `${scenePath} depthMode`);
  const clear = readCell(record.clear, `${scenePath} clear`);
  if (!Array.isArray(record.entities)) throw new Error(`${scenePath} entities must be an array`);

  const sprites = new Map<string, Sprite>();
  const seen = new Set<string>();
  const entities: Prop[] = [];
  for (let index = 0; index < record.entities.length; index++) {
    entities.push(
      await readProp(
        assetsRoot,
        scenePath,
        record.entities[index],
        index,
        width,
        height,
        sprites,
        seen,
      ),
    );
  }
  return new Scene(id, width, height, depthMode, clear, entities);
}

function assetPath(root: string, folder: 'scenes' | 'sprites', id: string): string {
  if (!/^[a-z0-9-]+$/.test(id)) {
    throw new Error(`Asset id ${id} must use lowercase letters, numbers, and hyphens`);
  }
  return path.join(root, folder, `${id}.json`);
}

async function readProp(
  assetsRoot: string,
  scenePath: string,
  value: unknown,
  index: number,
  width: number,
  height: number,
  sprites: Map<string, Sprite>,
  seen: Set<string>,
): Promise<Prop> {
  const label = `${scenePath} entity ${index}`;
  const record = readObject(value, label);
  const id = readId(record.id, `${label} id`);
  if (seen.has(id)) throw new Error(`${label} duplicates id ${id}`);
  seen.add(id);
  if (record.type !== 'Prop') throw new Error(`${label} type must be Prop`);
  const sprite = await loadSprite(assetsRoot, readId(record.sprite, `${label} sprite`), sprites);
  return new Prop(
    id,
    readInt(record.x, `${label} x`, 0, width - 1),
    readInt(record.y, `${label} y`, 0, height - 1),
    readInt(record.depthOffset ?? 0, `${label} depthOffset`, -1000, 1000),
    readInt(record.z ?? 0, `${label} z`, -1000, 1000),
    sprite,
  );
}

async function loadSprite(
  assetsRoot: string,
  spriteId: string,
  cache: Map<string, Sprite>,
): Promise<Sprite> {
  const cached = cache.get(spriteId);
  if (cached) return cached;
  const file = assetPath(assetsRoot, 'sprites', spriteId);
  const record = readObject(await readJson(file), file);
  expectFormat(record, file, 'incanterm-sprite');
  const id = readId(record.id, `${file} id`);
  if (id !== spriteId) throw new Error(`${file} id is ${id}, expected ${spriteId}`);
  const width = readInt(record.width, `${file} width`, 1, 256);
  const height = readInt(record.height, `${file} height`, 1, 128);
  const cells = readSpriteCells(record, width * height, file);
  const sprite = new Sprite(
    id,
    width,
    height,
    readInt(record.originX, `${file} originX`, 0, width - 1),
    readInt(record.originY, `${file} originY`, 0, height - 1),
    cells,
  );
  cache.set(spriteId, sprite);
  return sprite;
}

function readSpriteCells(record: Record<string, unknown>, count: number, file: string): Cell[] {
  if (Array.isArray(record.cells)) {
    if (record.cells.length !== count) {
      throw new Error(`${file} has ${record.cells.length} cells, expected ${count}`);
    }
    return record.cells.map((cell, index) => readCell(cell, `${file} cell ${index}`));
  }

  if (!Array.isArray(record.cellPalette)) throw new Error(`${file} cellPalette must be an array`);
  const palette = record.cellPalette.map((entry, index) => {
    if (!Array.isArray(entry) || entry.length !== 3) {
      throw new Error(`${file} cellPalette entry ${index} must have a glyph and two colors`);
    }
    return readCell({ ch: entry[0], fg: entry[1], bg: entry[2] }, `${file} cellPalette ${index}`);
  });
  const encoded = readObject(record.cells, `${file} cells`);
  const indices: number[] = [];
  if (Array.isArray(encoded.indices)) {
    if (encoded.indices.length !== count) {
      throw new Error(`${file} has ${encoded.indices.length} cell indexes, expected ${count}`);
    }
    indices.push(...encoded.indices);
  } else if (Array.isArray(encoded.runs)) {
    if (encoded.runs.length > count) throw new Error(`${file} has too many cell runs`);
    for (const run of encoded.runs) {
      if (
        !Array.isArray(run) ||
        run.length !== 2 ||
        !Number.isInteger(run[0]) ||
        run[0] < 1 ||
        indices.length + run[0] > count
      ) {
        throw new Error(`${file} has an invalid cell run`);
      }
      for (let index = 0; index < run[0]; index++) indices.push(run[1]);
    }
    if (indices.length !== count)
      throw new Error(`${file} has ${indices.length} cells, expected ${count}`);
  } else {
    throw new Error(`${file} cells need indices or runs`);
  }
  return indices.map((index, cellIndex) => {
    if (!Number.isInteger(index) || index < 1 || index > palette.length) {
      throw new Error(`${file} cell ${cellIndex} has an invalid palette index`);
    }
    return palette[index - 1];
  });
}

async function readJson(file: string): Promise<unknown> {
  let text: string;
  try {
    text = await fs.readFile(file, 'utf8');
  } catch (error) {
    if (isNotFound(error)) throw new Error(`Missing asset ${file}`, { cause: error });
    throw error;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new Error(`Invalid JSON in ${file}`, { cause: error });
  }
}

function expectFormat(record: Record<string, unknown>, file: string, format: string): void {
  if (record.format !== format || record.version !== 1) {
    throw new Error(`${file} must be ${format} version 1`);
  }
}

function readObject(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function readId(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^[a-z0-9-]+$/.test(value) || value.length > 64) {
    throw new Error(`${label} must be a short id of lowercase letters, numbers, and hyphens`);
  }
  return value;
}

function readDepthMode(value: unknown, label: string): DepthMode {
  if (value === 'bottom-up' || value === 'regular-z') return value;
  throw new Error(`${label} must be bottom-up or regular-z`);
}

function readInt(value: unknown, label: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${label} must be an integer from ${min} to ${max}`);
  }
  return value;
}

function readCell(value: unknown, label: string): Cell {
  const record = readObject(value, label);
  return {
    ch: readGlyph(record.ch, `${label}.ch`),
    fg: readColor(record.fg, `${label}.fg`),
    bg: readColor(record.bg, `${label}.bg`),
  };
}

function readGlyph(value: unknown, label: string): string {
  if (
    typeof value !== 'string' ||
    value.length !== 1 ||
    value.charCodeAt(0) < 0x20 ||
    value.charCodeAt(0) === 0x7f
  ) {
    throw new Error(`${label} must be one single-width character`);
  }
  return value;
}

function readColor(value: unknown, label: string): Rgb {
  if (typeof value !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(value)) {
    throw new Error(`${label} must be a #rrggbb color`);
  }
  return parseHexColor(value);
}

function isNotFound(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}
