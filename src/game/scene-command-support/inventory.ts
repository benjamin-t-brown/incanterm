import { getInventoryEntries, getItemAsset, WorldItem } from '../items.js';
import type { CommandContext } from '../rpgscript/command.js';
import type { ScriptValue } from '../rpgscript/parser.js';
import type { GameScriptContext } from './context.js';

export function getInventory(value: ReturnType<CommandContext['getStorage']>, location: string): readonly string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string'))
    throw new Error(`${location}: vars.inventory must contain item names`);
  return value;
}

export function getItemName(value: ScriptValue, context: CommandContext, command: string): string {
  const item = context.value(value);
  if (typeof item !== 'string' || !item.trim())
    throw new Error(`${context.location}: ${command} requires an item name`);
  return item;
}

// Script-only terminal runners have no project assets.
export function addNamedInventoryItem(
  item: string, script: CommandContext, position: 'first' | 'last' = 'last',
): boolean {
  const inventory = getInventory(script.getGlobal('vars.inventory'), script.location);
  if (inventory.includes(item)) return false;
  script.setGlobal('vars.inventory', position === 'first' ? [item, ...inventory] : [...inventory, item]);
  return true;
}

export function addInventoryItem(
  reference: string, script: Pick<CommandContext, 'getGlobal' | 'setGlobal' | 'location'>, game: GameScriptContext,
  position: 'first' | 'last' = 'last',
): string | undefined {
  const asset = getItemAsset(game.scene.itemAssets, reference);
  const { id: itemId, label } = asset.definition;
  const entries = getInventoryEntries(script.getGlobal('vars.inventory'), game.scene.itemAssets);
  const isNew = !entries.some((entry) => entry.itemId === itemId);
  if (isNew) {
    if (position === 'first') entries.unshift({ itemId });
    else entries.push({ itemId });
  }
  script.setGlobal('vars.inventory', entries);
  const acquired = getInventory(script.getGlobal('vars.acquiredItems'), script.location);
  if (!acquired.includes(itemId)) script.setGlobal('vars.acquiredItems', [...acquired, itemId]);
  for (const entity of [...game.scene.entities])
    if (entity instanceof WorldItem && entity.asset.definition.id === itemId) game.scene.removeEntity(entity);
  return isNew ? label : undefined;
}
