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

export function addInventoryItem(
  reference: string, script: Pick<CommandContext, 'getGlobal' | 'setGlobal' | 'location'>, game: GameScriptContext,
): void {
  const asset = getItemAsset(game.scene.itemAssets, reference);
  const itemId = asset.definition.id;
  const entries = getInventoryEntries(script.getGlobal('vars.inventory'), game.scene.itemAssets);
  if (!entries.some((entry) => entry.itemId === itemId)) entries.push({ itemId });
  script.setGlobal('vars.inventory', entries);
  const acquired = getInventory(script.getGlobal('vars.acquiredItems'), script.location);
  if (!acquired.includes(itemId)) script.setGlobal('vars.acquiredItems', [...acquired, itemId]);
  for (const entity of [...game.scene.entities])
    if (entity instanceof WorldItem && entity.asset.definition.id === itemId) game.scene.removeEntity(entity);
}
