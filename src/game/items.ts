import type { ItemDocument } from '../editor/items/item-schema.js';
import { AnimatedProp, type PropClip } from './animated-prop.js';
import type { RuntimeValue } from './rpgscript/command.js';
import type { Sprite } from './sprite.js';

export type ItemAsset = { definition: ItemDocument; sprite: Sprite; clip: PropClip };
export type InventoryEntry = { readonly itemId: string };
export type ItemTarget = { targetType: 'item' | 'prop' | 'character'; target: string };

export class WorldItem extends AnimatedProp {
  constructor(
    id: string,
    x: number,
    y: number,
    depthOffset: number,
    z: number,
    readonly asset: ItemAsset,
    instanceName?: string,
  ) {
    super(
      id,
      x,
      y,
      depthOffset,
      z,
      asset.sprite,
      new Map([['default', asset.clip]]),
      'default',
      instanceName,
    );
  }

  override clone(): WorldItem {
    return new WorldItem(
      this.id,
      this.x,
      this.y,
      this.depthOffset,
      this.z,
      this.asset,
      this.instanceName,
    );
  }
}

export function getItemAsset(assets: ReadonlyMap<string, ItemAsset>, reference: string): ItemAsset {
  const exact = assets.get(reference);
  if (exact) return exact;
  const matches = getItemReferenceMatches(assets, reference);
  if (matches.length !== 1)
    throw new Error(
      matches.length ? `Item reference ${reference} is ambiguous` : `Unknown item ${reference}`,
    );
  return matches[0];
}

function getItemReferenceMatches(
  assets: ReadonlyMap<string, ItemAsset>,
  reference: string,
): ItemAsset[] {
  const items = [...assets.values()];
  const labels = items.filter((asset) => asset.definition.label === reference);
  // Preserve old projects' aliases, but labels are the user-facing reference.
  return labels.length
    ? labels
    : items.filter((asset) => asset.definition.scriptName === reference);
}

/** Read old string saves, but always write canonical asset references on mutation. */
export function getInventoryEntries(
  value: RuntimeValue,
  assets: ReadonlyMap<string, ItemAsset>,
): InventoryEntry[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error('vars.inventory must be an item list');
  const ids = new Set<string>();
  for (const entry of value) {
    const reference =
      typeof entry === 'string'
        ? entry
        : entry && typeof entry === 'object' && !Array.isArray(entry)
          ? entry.itemId
          : undefined;
    if (typeof reference !== 'string') throw new Error('Invalid inventory item reference');
    ids.add(getItemAsset(assets, reference).definition.id);
  }
  return [...ids].map((itemId) => ({ itemId }));
}

export function hasInventoryItem(
  value: RuntimeValue,
  assets: ReadonlyMap<string, ItemAsset>,
  reference: string,
): boolean {
  // Unknown names in conditions are false, while malformed inventory is an error.
  const entries = getInventoryEntries(value, assets);
  const exact = assets.get(reference);
  const matches = exact ? [exact] : getItemReferenceMatches(assets, reference);
  const asset = matches.length === 1 ? matches[0] : undefined;
  return !!asset && entries.some((entry) => entry.itemId === asset.definition.id);
}

export function getItemCombinationScript(
  assets: ReadonlyMap<string, ItemAsset>,
  source: ItemDocument,
  target: ItemTarget,
): string | undefined {
  const match = source.combinations.find(
    (rule) => rule.targetType === target.targetType && rule.target === target.target,
  );
  if (match) return match.script;
  // Item recipes are symmetric. The actively selected item's rule takes precedence.
  if (target.targetType === 'item') {
    const reverse = assets
      .get(target.target)
      ?.definition.combinations.find(
        (rule) => rule.targetType === 'item' && rule.target === source.id,
      );
    if (reverse) return reverse.script;
  }
  return source.combineFailScript;
}
