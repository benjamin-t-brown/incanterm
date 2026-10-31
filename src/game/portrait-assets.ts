import fs from 'node:fs/promises';
import path from 'node:path';
import { defaultPalette, paletteRgb, type PaletteDocument } from '../editor/palette.js';
import { animationFrameFlips, flattenSprite, parseAnimation, parsePalette } from '../editor/schema.js';
import { parseStoredSprite } from '../editor/art/sprite-storage.js';
import type { Cell } from './cell-buffer.js';
import { parseHexColor } from './color.js';

export type PortraitFrame = Readonly<{
  width: number;
  height: number;
  cells: readonly Cell[] | null;
  durationMs: number;
}>;

export type PortraitAsset = Readonly<{
  width: number;
  height: number;
  frames: readonly PortraitFrame[];
  loop: boolean;
}>;

export type PortraitAssets = ReadonlyMap<string, PortraitAsset>;

async function assetFiles(root: string, directory: string): Promise<string[]> {
  try {
    return (await fs.readdir(path.join(root, directory))).filter((file) => file.endsWith('.json'));
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT')
      return [];
    throw error;
  }
}

async function readAsset(file: string): Promise<unknown> {
  const text = await fs.readFile(file, 'utf8');
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    if (error instanceof SyntaxError) return undefined;
    throw error;
  }
}

export async function loadPortraitAssets(root: string): Promise<PortraitAssets> {
  let palette: PaletteDocument = defaultPalette();
  try {
    const parsed = parsePalette(await readAsset(path.join(root, 'palette.json')));
    if (parsed.ok) palette = parsed.value;
  } catch (error) {
    if (
      !(typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT')
    )
      throw error;
  }

  const assets = new Map<string, PortraitAsset>();
  const sprites = new Map<string, PortraitFrame>();
  for (const file of await assetFiles(root, 'sprites')) {
    const parsed = parseStoredSprite(await readAsset(path.join(root, 'sprites', file)));
    if (!parsed.ok) continue;
    const sprite = parsed.value;
    if (file !== `${sprite.id}.json`) continue;
    for (let index = 0; index < sprite.sprites.length; index++) {
      const cells = flattenSprite(sprite, index).map((cell) => ({
        ch: cell.ch,
        fg: parseHexColor(paletteRgb(palette, cell.fg) ?? '#aaaaaa'),
        bg: parseHexColor(paletteRgb(palette, cell.bg) ?? '#000000'),
      }));
      const frame = { width: sprite.width, height: sprite.height, cells, durationMs: 0 };
      sprites.set(`${sprite.id}_${index}`, frame);
      assets.set(`${sprite.id}_${index}`, {
        width: sprite.width,
        height: sprite.height,
        frames: [frame],
        loop: false,
      });
    }
  }

  for (const file of await assetFiles(root, 'animations')) {
    const parsed = parseAnimation(await readAsset(path.join(root, 'animations', file)));
    if (!parsed.ok) continue;
    const animation = parsed.value;
    if (file !== `${animation.id}.json`) continue;
    const frames = animation.frames.map((entry): PortraitFrame => {
      if ('invisible' in entry)
        return { width: 0, height: 0, cells: null, durationMs: entry.durationMs };
      const sprite = sprites.get(`${entry.sprite}_${entry.index}`);
      const flips = animationFrameFlips(animation, entry);
      const cells = sprite?.cells;
      return {
        width: sprite?.width ?? 0,
        height: sprite?.height ?? 0,
        cells: cells && sprite && (flips.flipH || flips.flipV)
          ? Array.from({ length: cells.length }, (_, at) => {
              const x = at % sprite.width;
              const y = Math.floor(at / sprite.width);
              return cells[(flips.flipV ? sprite.height - 1 - y : y) * sprite.width +
                (flips.flipH ? sprite.width - 1 - x : x)];
            })
          : cells ?? null,
        durationMs: entry.durationMs,
      };
    });
    if (!frames.some((frame) => frame.cells)) continue;
    assets.set(animation.id, {
      width: Math.max(0, ...frames.map((frame) => frame.width)),
      height: Math.max(0, ...frames.map((frame) => frame.height)),
      frames,
      loop: animation.loop,
    });
  }
  return assets;
}

export function portraitFrameAt(asset: PortraitAsset, elapsedMs: number): PortraitFrame {
  const total = asset.frames.reduce((duration, frame) => duration + frame.durationMs, 0);
  let offset = asset.loop && total > 0 ? elapsedMs % total : elapsedMs;
  for (const frame of asset.frames) {
    if (offset < frame.durationMs) return frame;
    offset -= frame.durationMs;
  }
  return asset.frames[asset.frames.length - 1];
}

export function portraitNextFrameDelay(
  asset: PortraitAsset,
  elapsedMs: number,
): number | undefined {
  if (asset.frames.length < 2) return undefined;
  const total = asset.frames.reduce((duration, frame) => duration + frame.durationMs, 0);
  if (total < 1) return undefined;
  let offset = asset.loop ? elapsedMs % total : elapsedMs;
  for (let index = 0; index < asset.frames.length; index++) {
    const duration = asset.frames[index].durationMs;
    if (offset < duration)
      return index === asset.frames.length - 1 && !asset.loop ? undefined : duration - offset;
    offset -= duration;
  }
  return undefined;
}
