import {
  getSpriteLabelError,
  isAssetId,
  MAX_FRAMES,
  type PropVisual,
  type SchemaResult,
} from '../schema.js';

export const ITEM_SPRITE_WIDTH = 4;
export const ITEM_SPRITE_HEIGHT = 3;
export const ITEM_SPRITE_SIZE = `${ITEM_SPRITE_WIDTH}×${ITEM_SPRITE_HEIGHT}`;

export function isItemSpriteSize({ width, height }: { width: number; height: number }): boolean {
  return width === ITEM_SPRITE_WIDTH && height === ITEM_SPRITE_HEIGHT;
}

export function getItemSpriteSizeError(sprite: {
  id: string;
  width: number;
  height: number;
}): string {
  return `Item sprites must be ${ITEM_SPRITE_SIZE} cells; sprite "${sprite.id}" is ${sprite.width}×${sprite.height}`;
}

export type ItemCombination = {
  targetType: 'item' | 'prop' | 'character';
  /** Stable target asset ID, not a scene instance name. */
  target: string;
  script: string;
};

export type ItemDocument = {
  format: 'incanterm-item';
  version: 1;
  id: string;
  label: string;
  /** Item aliases separated by commas or slashes. */
  scriptName?: string;
  visual: PropVisual;
  examineScript?: string;
  combineFailScript?: string;
  combinations: ItemCombination[];
};

export function createItem(id: string, visual: PropVisual, label = id): ItemDocument {
  return { format: 'incanterm-item', version: 1, id, label, visual, combinations: [] };
}

export function getItemScriptNames(scriptName: string | undefined): string[] {
  return scriptName?.split(/[,/]/).map((name) => name.trim()) ?? [];
}

export function parseItem(value: unknown): SchemaResult<ItemDocument> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return { ok: false, error: 'Item must be an object' };
  const record = value as Record<string, unknown>;
  const fail = (error: string): SchemaResult<never> => ({ ok: false, error });
  if (record.format !== 'incanterm-item' || record.version !== 1)
    return fail('Item must be incanterm-item version 1');
  if (typeof record.id !== 'string' || !isAssetId(record.id))
    return fail('Item needs a valid asset id');
  if (typeof record.label !== 'string' || getSpriteLabelError(record.label))
    return fail('Item label must be 1 to 80 characters without control characters');
  if (record.scriptName !== undefined) {
    if (typeof record.scriptName !== 'string') return fail('Item script names must be text');
    const seen = new Set<string>();
    for (const name of getItemScriptNames(record.scriptName)) {
      if (!name) return fail('Item script aliases cannot be empty');
      if (!/^[A-Za-z_][\w. -]*$/.test(name))
        return fail(
          `Invalid item script name "${name}". Start with a letter or underscore; use only letters, numbers, spaces, dots, hyphens or underscores.`,
        );
      const key = name.toLowerCase();
      if (seen.has(key)) return fail(`Item script name "${name}" is listed more than once`);
      seen.add(key);
    }
  }
  for (const key of ['examineScript', 'combineFailScript'] as const) {
    if (
      record[key] !== undefined &&
      (typeof record[key] !== 'string' || !/^[A-Za-z_][\w-]*$/.test(record[key]))
    )
      return fail(`Item ${key} must be an RPGScript identifier`);
  }
  const visual = record.visual as PropVisual | undefined;
  if (
    !visual ||
    typeof visual.id !== 'string' ||
    !isAssetId(visual.id) ||
    (visual.type !== 'sprite' && visual.type !== 'animation')
  )
    return fail('Item visual must reference a sprite or animation');
  if (
    visual.type === 'sprite' &&
    (!Number.isInteger(visual.index) || visual.index < 0 || visual.index >= MAX_FRAMES)
  )
    return fail('Item sprite index must be an existing frame index');
  if (!Array.isArray(record.combinations) || record.combinations.length > 256)
    return fail('Item combinations must contain at most 256 rules');
  const combinations: ItemCombination[] = [];
  const keys = new Set<string>();
  for (const raw of record.combinations) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw))
      return fail('Invalid item combination');
    const rule = raw as ItemCombination;
    if (
      !['item', 'prop', 'character'].includes(rule.targetType) ||
      typeof rule.target !== 'string' ||
      !isAssetId(rule.target) ||
      typeof rule.script !== 'string' ||
      !/^[A-Za-z_][\w-]*$/.test(rule.script)
    )
      return fail('Combination needs a target type, asset id, and RPGScript name');
    const key = `${rule.targetType}:${rule.target}`;
    if (keys.has(key)) return fail(`Duplicate combination target ${key}`);
    keys.add(key);
    combinations.push({ targetType: rule.targetType, target: rule.target, script: rule.script });
  }
  return {
    ok: true,
    value: {
      format: 'incanterm-item',
      version: 1,
      id: record.id,
      label: record.label.trim(),
      ...(typeof record.scriptName === 'string' ? { scriptName: record.scriptName } : {}),
      ...(typeof record.examineScript === 'string' ? { examineScript: record.examineScript } : {}),
      ...(typeof record.combineFailScript === 'string'
        ? { combineFailScript: record.combineFailScript }
        : {}),
      visual:
        visual.type === 'sprite'
          ? { type: 'sprite', id: visual.id, index: visual.index }
          : { type: 'animation', id: visual.id },
      combinations,
    },
  };
}
