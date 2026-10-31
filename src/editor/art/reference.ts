import { isAssetId, type SchemaResult } from '../schema.js';

export const REFERENCE_EXTS = ['png', 'jpg', 'webp', 'gif'] as const;
export type ReferenceExt = (typeof REFERENCE_EXTS)[number];
export type ReferenceHandle = 'nw' | 'ne' | 'sw' | 'se';

export const DEFAULT_REFERENCE_OPACITY = 0.55;
export const MIN_REFERENCE_SIZE = 0.25;
export const MAX_REFERENCE_IMAGE_BYTES = 4_000_000;

const MAX_REFERENCE_SPAN = 4096;

export type SpriteReference = {
  format: 'incanterm-sprite-reference';
  version: 1;
  id: string;
  ext: ReferenceExt;
  x: number;
  y: number;
  width: number;
  height: number;
  opacity: number;
  visible: boolean;
};

export type ReferenceRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export function isReferenceExt(value: string): value is ReferenceExt {
  return (REFERENCE_EXTS as readonly string[]).includes(value);
}

export function createReference(
  id: string,
  ext: ReferenceExt,
  rect: ReferenceRect,
  opacity = DEFAULT_REFERENCE_OPACITY,
): SpriteReference {
  return {
    format: 'incanterm-sprite-reference',
    version: 1,
    id,
    ext,
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
    opacity,
    visible: true,
  };
}

export function parseReference(value: unknown): SchemaResult<SpriteReference> {
  const record = asObject(value);
  if (!record) return fail('Reference must be an object');
  if (record.format !== 'incanterm-sprite-reference' || record.version !== 1) {
    return fail('Reference must be incanterm-sprite-reference version 1');
  }
  if (typeof record.id !== 'string' || !isAssetId(record.id)) {
    return fail('Reference id must be a short lowercase id');
  }
  if (typeof record.ext !== 'string' || !isReferenceExt(record.ext)) {
    return fail('Reference ext must be png, jpg, webp, or gif');
  }
  const x = readNumber(record.x, 'Reference x', -MAX_REFERENCE_SPAN, MAX_REFERENCE_SPAN);
  if (!x.ok) return x;
  const y = readNumber(record.y, 'Reference y', -MAX_REFERENCE_SPAN, MAX_REFERENCE_SPAN);
  if (!y.ok) return y;
  const width = readNumber(record.width, 'Reference width', MIN_REFERENCE_SIZE, MAX_REFERENCE_SPAN);
  if (!width.ok) return width;
  const height = readNumber(
    record.height,
    'Reference height',
    MIN_REFERENCE_SIZE,
    MAX_REFERENCE_SPAN,
  );
  if (!height.ok) return height;
  const opacity = readNumber(record.opacity, 'Reference opacity', 0, 1);
  if (!opacity.ok) return opacity;
  const visible = record.visible === undefined ? true : record.visible;
  if (typeof visible !== 'boolean') return fail('Reference visible must be true or false');
  return {
    ok: true,
    value: {
      format: 'incanterm-sprite-reference',
      version: 1,
      id: record.id,
      ext: record.ext,
      x: x.value,
      y: y.value,
      width: width.value,
      height: height.value,
      opacity: opacity.value,
      visible,
    },
  };
}

export function detectReferenceImage(bytes: Uint8Array, mime = ''): ReferenceExt | null {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return 'png';
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'jpg';
  }
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 12) === 'WEBP') {
    return 'webp';
  }
  if (bytes.length >= 6) {
    const header = ascii(bytes, 0, 6);
    if (header === 'GIF87a' || header === 'GIF89a') return 'gif';
  }
  return mimeToExt(mime);
}

export function referenceMime(ext: ReferenceExt): string {
  if (ext === 'png') return 'image/png';
  if (ext === 'jpg') return 'image/jpeg';
  if (ext === 'webp') return 'image/webp';
  return 'image/gif';
}

export function mimeToExt(mime: string): ReferenceExt | null {
  const type = mime.split(';')[0]?.trim().toLowerCase() ?? '';
  if (type === 'image/png') return 'png';
  if (type === 'image/jpeg') return 'jpg';
  if (type === 'image/webp') return 'webp';
  if (type === 'image/gif') return 'gif';
  return null;
}

export function fitReferenceRect(
  spriteWidth: number,
  spriteHeight: number,
  imageWidth: number,
  imageHeight: number,
  cellWidth: number,
  cellHeight: number,
): ReferenceRect {
  if (spriteWidth <= 0 || spriteHeight <= 0 || cellWidth <= 0 || cellHeight <= 0) {
    return { x: 0, y: 0, width: 1, height: 1 };
  }
  if (imageWidth <= 0 || imageHeight <= 0) {
    return { x: 0, y: 0, width: spriteWidth, height: spriteHeight };
  }
  const aspect = imageWidth / imageHeight;
  const spritePxW = spriteWidth * cellWidth;
  const spritePxH = spriteHeight * cellHeight;
  const spriteAspect = spritePxW / spritePxH;
  const width = aspect > spriteAspect ? spriteWidth : (spritePxH * aspect) / cellWidth;
  const height = aspect > spriteAspect ? spritePxW / aspect / cellHeight : spriteHeight;
  return {
    x: (spriteWidth - width) / 2,
    y: (spriteHeight - height) / 2,
    width,
    height,
  };
}

export function resizeReferenceRect(
  start: ReferenceRect,
  handle: ReferenceHandle,
  cellX: number,
  cellY: number,
  lockAspect: boolean,
  minSize = MIN_REFERENCE_SIZE,
): ReferenceRect {
  let left = start.x;
  let top = start.y;
  let right = start.x + start.width;
  let bottom = start.y + start.height;
  if (handle === 'ne' || handle === 'se') right = cellX;
  if (handle === 'nw' || handle === 'sw') left = cellX;
  if (handle === 'sw' || handle === 'se') bottom = cellY;
  if (handle === 'nw' || handle === 'ne') top = cellY;

  let width = Math.max(minSize, right - left);
  let height = Math.max(minSize, bottom - top);
  if (right - left < minSize) {
    if (handle === 'ne' || handle === 'se') right = left + minSize;
    else left = right - minSize;
    width = minSize;
  }
  if (bottom - top < minSize) {
    if (handle === 'sw' || handle === 'se') bottom = top + minSize;
    else top = bottom - minSize;
    height = minSize;
  }

  if (lockAspect && start.height > 0) {
    const aspect = start.width / start.height;
    const fromWidth = Math.abs(width);
    const fromHeight = Math.abs(height);
    if (Math.abs(fromWidth - start.width) >= Math.abs(fromHeight - start.height)) {
      width = Math.max(minSize, fromWidth);
      height = width / aspect;
    } else {
      height = Math.max(minSize, fromHeight);
      width = height * aspect;
    }
    if (height < minSize) {
      height = minSize;
      width = height * aspect;
    }
    if (width < minSize) {
      width = minSize;
      height = width / aspect;
    }
    if (handle === 'nw' || handle === 'sw') left = right - width;
    if (handle === 'nw' || handle === 'ne') top = bottom - height;
  }

  return { x: left, y: top, width, height };
}

function readNumber(value: unknown, label: string, min: number, max: number): SchemaResult<number> {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    return fail(`${label} must be a number from ${min} to ${max}`);
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

function ascii(bytes: Uint8Array, start: number, end: number): string {
  return String.fromCharCode(...bytes.subarray(start, end));
}
