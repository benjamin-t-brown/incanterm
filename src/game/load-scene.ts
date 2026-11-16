import fs from 'node:fs/promises';
import path from 'node:path';
import { parseHexColor, type Rgb } from './color.js';
import {
  flattenSprite,
  getCharacterAnimation,
  getCharacterScriptNames,
  getCharacterVariantNames,
  getCharacterVisual,
  getAnimationFrameFlips,
  getPropAnimation,
  isCharacterStateName,
  isInvisibleFrame,
  parseCharacter,
  parseAnimation,
  parsePalette,
  parseProp,
  PROP_DEFAULT_STATE,
  type PropDocument,
} from '../editor/schema.js';
import { parseStoredSprite } from '../editor/art/sprite-storage.js';
import { getPaletteRgb, getDefaultPalette, type PaletteDocument } from '../editor/palette.js';
import type { Cell } from './cell-buffer.js';
import {
  Background,
  Prop,
  Scene,
  type DepthMode,
  type ActionTrigger,
  type StepTrigger,
} from './scene.js';
import { Character, type CharacterClip } from './character.js';
import { Sprite } from './sprite.js';
import { AnimatedProp, type PropClip } from './animated-prop.js';
import { parseItem } from '../editor/items/item-schema.js';
import { WorldItem, type ItemAsset } from './items.js';

export async function loadSceneByReference(assetsRoot: string, reference: string): Promise<Scene> {
  const scenesRoot = path.join(assetsRoot, 'scenes');
  if (/^[a-z0-9_-]+$/.test(reference)) {
    try {
      await fs.access(getAssetPath(assetsRoot, 'scenes', reference));
      return loadScene(assetsRoot, reference);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  const matches: string[] = [];
  for (const entry of await fs.readdir(scenesRoot, { withFileTypes: true })) {
    if (!entry.isFile() || !/^[a-z0-9_-]+\.json$/.test(entry.name)) continue;
    const id = entry.name.slice(0, -5);
    const text = await fs.readFile(path.join(scenesRoot, entry.name), 'utf8');
    let record: unknown;
    try { record = JSON.parse(text); } catch { continue; }
    if (record && typeof record === 'object' && !Array.isArray(record) &&
      'format' in record && record.format === 'incanterm-scene' &&
      'id' in record && record.id === id && 'label' in record && record.label === reference)
      matches.push(id);
  }
  if (!matches.length) throw new Error(`Scene ${reference} was not found by ID or label`);
  if (matches.length > 1) throw new Error(`Scene label ${reference} is ambiguous: ${matches.join(', ')}`);
  return loadScene(assetsRoot, matches[0]);
}

export async function loadScene(assetsRoot: string, sceneId: string): Promise<Scene> {
  const scenePath = getAssetPath(assetsRoot, 'scenes', sceneId);
  const record = readObject(await readJson(scenePath), scenePath);
  expectFormat(record, scenePath, 'incanterm-scene');
  const id = readId(record.id, `${scenePath} id`);
  if (id !== sceneId) throw new Error(`${scenePath} id is ${id}, expected ${sceneId}`);
  const width = readInt(record.width, `${scenePath} width`, 1, 256);
  const height = readInt(record.height, `${scenePath} height`, 1, 128);
  const depthMode = readDepthMode(record.depthMode, `${scenePath} depthMode`);
  const clear = readCell(record.clear, `${scenePath} clear`);
  if (!Array.isArray(record.entities)) throw new Error(`${scenePath} entities must be an array`);
  const triggers = readTriggers(record.triggers, scenePath);
  const blockedCells = new Set<number>();
  if (record.blockedCells !== undefined && !Array.isArray(record.blockedCells))
    throw new Error(`${scenePath} blockedCells must be an array`);
  for (const cell of (record.blockedCells ?? []) as unknown[])
    blockedCells.add(readInt(cell, `${scenePath} blocked cell`, 0, width * height - 1));
  const actionTriggers: ActionTrigger[] = [];
  const stepTriggers: StepTrigger[] = [];
  for (const value of (record.triggers ?? []) as unknown[]) {
    if (typeof value === 'string') continue;
    const trigger = readObject(value, `${scenePath} trigger`);
    const action =
      trigger.actionEnabled === true ||
      (trigger.actionEnabled !== false && trigger.event === 'action');
    const step = trigger.stepEnabled === true;
    if (!action && !step) continue;
    const x = readInt(trigger.x, 'trigger x', 0, width - 1);
    const y = readInt(trigger.y, 'trigger y', 0, height - 1);
    const region = {
      id: readId(trigger.id, 'trigger id'),
      trigger: String(trigger.trigger ?? trigger.id),
      x,
      y,
      width: readInt(trigger.width, 'trigger width', 1, width - x),
      height: readInt(trigger.height, 'trigger height', 1, height - y),
    };
    if (action) actionTriggers.push(region);
    if (step) stepTriggers.push(region);
  }

  const sprites = new Map<string, Sprite>();
  const itemAssets = await loadItemAssets(assetsRoot, sprites);
  const seen = new Set<string>();
  const entities: Prop[] = [];
  const markers: { id: string; name: string; x: number; y: number }[] = [];
  const markerNames = new Set<string>();
  let hasBackground = false;
  for (let index = 0; index < record.entities.length; index++) {
    const entry = readObject(record.entities[index], `${scenePath} entity ${index}`);
    if (entry.type === 'Marker') {
      const id = readId(entry.id, `${scenePath} marker ${index} id`);
      if (seen.has(id)) throw new Error(`${scenePath} duplicates id ${id}`);
      seen.add(id);
      if (typeof entry.name !== 'string' || !/^[A-Za-z_][\w-]*$/.test(entry.name) || entry.name.length > 80)
        throw new Error(`${scenePath} marker ${index} needs a valid name`);
      if (markerNames.has(entry.name)) throw new Error(`${scenePath} duplicates marker name ${entry.name}`);
      markerNames.add(entry.name);
      markers.push({ id, name: entry.name, x: readInt(entry.x, 'marker x', 0, width - 1), y: readInt(entry.y, 'marker y', 0, height - 1) });
      continue;
    }
    if (entry.type === 'Background') {
      if (hasBackground) throw new Error(`${scenePath} can contain only one background`);
      hasBackground = true;
    }
    if (entry.type === 'Item') {
      const itemId = readId(entry.item, `${scenePath} item asset`);
      const asset = itemAssets.get(itemId);
      if (!asset) throw new Error(`${scenePath}: Unknown item ${itemId}`);
      const id = readId(entry.id, `${scenePath} item id`);
      if (seen.has(id)) throw new Error(`${scenePath} duplicates id ${id}`);
      seen.add(id);
      entities.push(new WorldItem(id,
        readInt(entry.x, 'item x', 0, width - 1), readInt(entry.y, 'item y', 0, height - 1),
        readInt(entry.depthOffset ?? 0, 'item depthOffset', -1024, 1024),
        readInt(entry.z ?? 0, 'item z', -1000, 1000), asset,
        typeof entry.name === 'string' ? entry.name : undefined));
      continue;
    }
    entities.push(
      await readProp(
        assetsRoot,
        scenePath,
        record.entities[index],
        index,
        width,
        height,
        depthMode,
        sprites,
        seen,
        blockedCells,
      ),
    );
  }
  return new Scene(
    id,
    width,
    height,
    depthMode,
    clear,
    entities,
    triggers,
    blockedCells,
    actionTriggers,
    stepTriggers,
    markers,
    (reference) => loadCharacterByReference(assetsRoot, reference),
    itemAssets,
  );
}

async function loadItemAssets(assetsRoot: string, sprites: Map<string, Sprite>): Promise<ReadonlyMap<string, ItemAsset>> {
  const assets = new Map<string, ItemAsset>();
  let files: string[];
  try { files = await fs.readdir(path.join(assetsRoot, 'items')); }
  catch (error) { if (isNotFound(error)) return assets; throw error; }
  const names = new Set<string>();
  for (const file of files.sort()) {
    if (!/^[a-z0-9_-]+\.json$/.test(file)) continue;
    const parsed = parseItem(await readJson(path.join(assetsRoot, 'items', file)));
    if (!parsed.ok) throw new Error(`${file}: ${parsed.error}`);
    const definition = parsed.value;
    if (file !== `${definition.id}.json`) throw new Error(`${file}: Item id does not match its file`);
    if (definition.scriptName) {
      if (names.has(definition.scriptName)) throw new Error(`Duplicate item script name ${definition.scriptName}`);
      names.add(definition.scriptName);
    }
    const visual = definition.visual;
    const clip: PropClip = visual.type === 'sprite'
      ? { frames: [{ sprite: await loadSprite(assetsRoot, visual.id, sprites, visual.index), durationMs: 1000 }], loop: true }
      : await loadPropClip(assetsRoot, visual.id, sprites, `Item ${definition.id}`);
    const sprite = clip.frames.find((frame) => frame.sprite)?.sprite;
    if (!sprite) throw new Error(`Item ${definition.id} has no visible frame`);
    assets.set(definition.id, { definition, sprite, clip });
  }
  for (const asset of assets.values()) {
    const name = asset.definition.scriptName;
    if (name && assets.has(name) && name !== asset.definition.id)
      throw new Error(`Item script name ${name} conflicts with an asset id`);
  }
  return assets;
}

export async function loadCharacterByReference(assetsRoot: string, reference: string): Promise<Character> {
  const matches: string[] = [];
  for (const entry of await fs.readdir(path.join(assetsRoot, 'characters'), { withFileTypes: true })) {
    if (!entry.isFile() || !/^[a-z0-9_-]+\.json$/.test(entry.name)) continue;
    const id = entry.name.slice(0, -5);
    if (id === reference) {
      matches.splice(0, matches.length, id);
      break;
    }
    const parsed = parseCharacter(await readJson(path.join(assetsRoot, 'characters', entry.name)));
    if (parsed.ok && getCharacterScriptNames(parsed.value.scriptName).some((name) => name.toLowerCase() === reference.toLowerCase())) matches.push(id);
  }
  if (matches.length !== 1)
    throw new Error(matches.length ? `Character reference ${reference} is ambiguous` : `Character ${reference} was not found by ID or script name`);
  const character = await readProp(assetsRoot, 'spawn player', {
    id: matches[0], type: 'Character', character: matches[0], name: reference,
    state: 'idle', facing: 'down', x: 0, y: 0,
  }, 0, 256, 128, 'bottom-up', new Map(), new Set(), new Set());
  if (!(character instanceof Character)) throw new Error(`Cannot load character ${reference}`);
  return character;
}

function readTriggers(value: unknown, scenePath: string): readonly string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error(`${scenePath} triggers must be an array`);
  const names = new Set<string>();
  const seen = new Set<string>();
  for (const trigger of value) {
    const name =
      typeof trigger === 'string'
        ? trigger
        : (readObject(trigger, `${scenePath} trigger`).trigger ?? (trigger as { id?: unknown }).id);
    const event = typeof trigger === 'string' ? 'load' : (trigger as { event?: unknown }).event;
    if (
      typeof name !== 'string' ||
      !/^[\w-]+$/.test(name) ||
      (event !== 'load' && event !== 'action' && event !== 'timer')
    ) {
      throw new Error(`${scenePath} trigger names must be nonempty identifiers`);
    }
    const instanceId =
      typeof trigger === 'string' ? name : String((trigger as { id?: unknown }).id ?? name);
    if (seen.has(instanceId)) throw new Error(`${scenePath} duplicates trigger ${instanceId}`);
    seen.add(instanceId);
    if (event === 'load' || event === 'timer') names.add(name);
  }
  return [...names];
}

function getAssetPath(root: string, folder: 'scenes' | 'sprites', id: string): string {
  if (!/^[a-z0-9_-]+$/.test(id)) {
    throw new Error(`Asset id ${id} must use lowercase letters, numbers, hyphens, and underscores`);
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
  depthMode: DepthMode,
  sprites: Map<string, Sprite>,
  seen: Set<string>,
  blockedCells: Set<number>,
): Promise<Prop> {
  const label = `${scenePath} entity ${index}`;
  const record = readObject(value, label);
  const id = readId(record.id, `${label} id`);
  if (seen.has(id)) throw new Error(`${label} duplicates id ${id}`);
  seen.add(id);
  if (record.type === 'Background') {
    const spriteId = readId(record.sprite, `${label} sprite`);
    const index = readInt(record.index ?? 0, `${label} index`, 0, 255);
    const sprite = await loadSprite(assetsRoot, spriteId, sprites, index);
    return new Background(
      id,
      readInt(record.x, `${label} x`, 0, width - 1),
      readInt(record.y, `${label} y`, 0, height - 1),
      0,
      0,
      sprite,
    );
  }
  if (record.type === 'Character') {
    const characterId = readId(record.character, `${label} character`);
    const file = path.join(assetsRoot, 'characters', `${characterId}.json`);
    const parsed = parseCharacter(await readJson(file));
    if (!parsed.ok) throw new Error(`${file}: ${parsed.error}`);
    if (parsed.value.id !== characterId)
      throw new Error(`${file} id does not match ${characterId}`);
    const facing = record.facing;
    if (facing !== 'up' && facing !== 'down' && facing !== 'left' && facing !== 'right')
      throw new Error(`${label} facing must be up, down, left, or right`);
    const state = record.state;
    if (typeof state !== 'string' || !isCharacterStateName(state))
      throw new Error(`${label} state must be a valid state name`);
    const variant = record.variant ?? parsed.value.defaultVariant ?? 'default';
    if (typeof variant !== 'string' || !getCharacterVisual(parsed.value, variant))
      throw new Error(`${label} has no character variant ${String(variant)}`);
    if (!getCharacterAnimation(parsed.value, state, facing, variant))
      throw new Error(`${label} has no animation state ${state}`);
    const variants = new Map<string, { sprite: Sprite; clips: ReadonlyMap<string, CharacterClip> }>();
    for (const name of getCharacterVariantNames(parsed.value)) {
      const visual = getCharacterVisual(parsed.value, name);
      if (!visual) continue;
      const clips = new Map<string, CharacterClip>();
      for (const [key, clipId] of Object.entries({
        ...visual.animations,
        ...visual.customAnimations,
      })) {
        clips.set(key, await loadPropClip(assetsRoot, clipId, sprites, `${label} variant ${name}`));
      }
      const variantSprite = clips.get(`idle-${facing}`)?.frames.find((frame) => frame.sprite)?.sprite;
      if (!variantSprite) throw new Error(`${label} variant ${name} has no visible idle frame`);
      variants.set(name, { sprite: variantSprite, clips });
    }
    const appearance = variants.get(variant);
    if (!appearance) throw new Error(`${label} has no character variant ${variant}`);
    const key = state === 'idle' || state === 'walk' || state === 'talking' ? `${state}-${facing}` : state;
    const sprite = appearance.clips.get(key)?.frames.find((frame) => frame.sprite)?.sprite ?? appearance.sprite;
    return new Character(
      id,
      readInt(record.x, `${label} x`, 0, width - 1),
      readInt(record.y, `${label} y`, 0, height - 1),
      readInt(record.z ?? 0, `${label} z`, -1000, 1000),
      sprite,
      characterId,
      typeof record.name === 'string' ? record.name.trim() : undefined,
      state,
      facing,
      readInt(record.speed ?? parsed.value.speed ?? 150, `${label} speed`, 1, 60000),
      appearance.clips,
      typeof record.talkScript === 'string' ? record.talkScript : undefined,
      parsed.value.scriptName,
      variant,
      variants,
    );
  }
  if (record.type !== 'Prop')
    throw new Error(`${label} type must be Prop, Character or Background`);
  let sprite: Sprite;
  let clips: Map<string, PropClip> | undefined;
  let depthOffset = readInt(
    record.depthOffset === undefined ? 0 : record.depthOffset,
    `${label} depthOffset`,
    -1024,
    1024,
  );
  let foreground = false;
  let instanceName: string | undefined;
  let propId: string | undefined;
  let state = PROP_DEFAULT_STATE;
  if (typeof record.name === 'string' && record.name.trim()) instanceName = record.name.trim();
  if (typeof record.state === 'string') {
    if (!isCharacterStateName(record.state))
      throw new Error(`${label} state must be a valid state name`);
    state = record.state;
  }
  if (record.prop !== undefined) {
    propId = readId(record.prop, `${label} prop`);
    const file = path.join(assetsRoot, 'props', `${propId}.json`);
    const parsed = parseProp(await readJson(file));
    if (!parsed.ok) throw new Error(`${file}: ${parsed.error}`);
    const asset: PropDocument = parsed.value;
    if (asset.id !== propId) throw new Error(`${file} id does not match ${propId}`);
    clips = new Map();
    if (asset.visual.type === 'sprite') {
      sprite = await loadSprite(assetsRoot, asset.visual.id, sprites, asset.visual.index);
      clips.set(PROP_DEFAULT_STATE, {
        frames: [{ sprite, durationMs: 1000 }],
        loop: true,
      });
    } else {
      const defaultClip = await loadPropClip(assetsRoot, asset.visual.id, sprites, label);
      const first = defaultClip.frames.find((frame) => frame.sprite)?.sprite;
      if (!first) throw new Error(`${label} default animation has no visible frame`);
      sprite = first;
      clips.set(PROP_DEFAULT_STATE, defaultClip);
    }
    for (const [name, animationId] of Object.entries(asset.customAnimations)) {
      clips.set(name, await loadPropClip(assetsRoot, animationId, sprites, `${label} state ${name}`));
    }
    if (!clips.has(state)) {
      const animationId = getPropAnimation(asset, state);
      throw new Error(
        animationId === undefined
          ? `${label} has no animation state ${state}`
          : `${label} animation state ${state} is missing`,
      );
    }
    for (const cell of asset.blockedCells) {
      const x = Number(record.x) - sprite.originX + (cell % asset.width);
      const y = Number(record.y) - sprite.originY + Math.floor(cell / asset.width);
      if (x >= 0 && y >= 0 && x < width && y < height) blockedCells.add(y * width + x);
    }
    depthOffset =
      (record.depthOffset === undefined ? asset.depthOffset : depthOffset) +
      (depthMode === 'bottom-up' ? asset.groundOffsetY : 0);
    foreground = asset.foreground;
  } else sprite = await loadSprite(assetsRoot, readId(record.sprite, `${label} sprite`), sprites);
  const x = readInt(record.x, `${label} x`, 0, width - 1);
  const y = readInt(record.y, `${label} y`, 0, height - 1);
  const z = readInt(record.z ?? 0, `${label} z`, -1000, 1000);
  if (clips)
    return new AnimatedProp(
      id,
      x,
      y,
      depthOffset,
      z,
      sprite,
      clips,
      state,
      instanceName,
      propId,
      foreground,
    );
  return new Prop(id, x, y, depthOffset, z, sprite, foreground);
}

async function loadPropClip(
  assetsRoot: string,
  animationId: string,
  sprites: Map<string, Sprite>,
  label: string,
): Promise<PropClip> {
  const clipFile = path.join(assetsRoot, 'animations', `${animationId}.json`);
  const clip = parseAnimation(await readJson(clipFile));
  if (!clip.ok) throw new Error(`${clipFile}: ${clip.error}`);
  const frames: PropClip['frames'] = [];
  for (const frame of clip.value.frames) {
    if (isInvisibleFrame(frame)) frames.push({ durationMs: frame.durationMs });
    else {
      const source = await loadSprite(assetsRoot, frame.sprite, sprites, frame.index);
      const flips = getAnimationFrameFlips(clip.value, frame);
      frames.push({
        sprite: source.getFlipped(flips.flipH, flips.flipV),
        durationMs: frame.durationMs,
      });
    }
  }
  if (!frames.length) throw new Error(`${label}: animation ${animationId} has no frames`);
  return { frames, loop: clip.value.loop };
}

async function loadSprite(
  assetsRoot: string,
  spriteId: string,
  cache: Map<string, Sprite>,
  frameIndex = 0,
): Promise<Sprite> {
  const key = `${spriteId}:${frameIndex}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const file = getAssetPath(assetsRoot, 'sprites', spriteId);
  const record = readObject(await readJson(file), file);
  if (record.version === 3) {
    const parsed = parseStoredSprite(record);
    if (!parsed.ok) throw new Error(`${file}: ${parsed.error}`);
    if (parsed.value.id !== spriteId || !parsed.value.sprites[frameIndex])
      throw new Error(`${file} has no sprite ${spriteId} frame ${frameIndex}`);
    let palette: PaletteDocument = getDefaultPalette();
    try {
      const source = parsePalette(
        JSON.parse(await fs.readFile(path.join(assetsRoot, 'palette.json'), 'utf8')) as unknown,
      );
      if (!source.ok) throw new Error(`Invalid scene palette: ${source.error}`);
      palette = source.value;
    } catch (error) {
      if (!isNotFound(error)) throw error;
    }
    const cells = flattenSprite(parsed.value, frameIndex).map((cell) => ({
      ch: cell.ch,
      fg: parseHexColor(getPaletteRgb(palette, cell.fg) ?? '#ffffff'),
      bg: parseHexColor(getPaletteRgb(palette, cell.bg) ?? '#000000'),
    }));
    const sprite = new Sprite(
      spriteId,
      parsed.value.width,
      parsed.value.height,
      parsed.value.originX,
      parsed.value.originY,
      cells,
    );
    cache.set(key, sprite);
    return sprite;
  }
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
  cache.set(key, sprite);
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
  if (typeof value !== 'string' || !/^[a-z0-9_-]+$/.test(value) || value.length > 64) {
    throw new Error(
      `${label} must be a short id of lowercase letters, numbers, hyphens, and underscores`,
    );
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
