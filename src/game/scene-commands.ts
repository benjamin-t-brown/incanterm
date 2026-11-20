// Keep this catalog and each `const name =` declaration together: the RPGScript
// language extension reads this file to discover supported commands.
import type { Command, ScriptValue } from './rpgscript/parser.js';
import type { PlayerControl } from './player-control.js';
import type { Scene } from './scene.js';
import type { Character } from './character.js';
import { findCharacter, findPath, getWalkAnchor, type Point } from './character-movement.js';
import { findAnimatedProps, findProp } from './prop-lookup.js';
import { CHARACTER_DIRECTIONS, PROP_DEFAULT_STATE, isCharacterVariantName, type CharacterDirection } from '../editor/schema.js';
import { defineCommand, type CommandContext } from './rpgscript/command.js';
import { getInventoryEntries, getItemAsset, getItemCombinationScript, WorldItem, type ItemTarget } from './items.js';

export type GameScriptContext = {
  scene: Scene;
  playerControl: PlayerControl;
  bark?: (character: Character, text: string, ms: number) => () => boolean;
  clearBark?: (character: Character) => void;
  clearCharacterSubscript?: (ownerId: string) => void;
  resetConversationPortraits?: () => void;
  changeScene?: (sceneId: string, markerName: string | undefined, location: string) => Promise<void>;
};

export type Choice = Readonly<{ text: string; target: string }>;

function getScriptValue(value: Command['args'][number], location: string): ScriptValue {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')
    return value;
  if ('storageKey' in value || 'localName' in value || 'expression' in value || 'list' in value || 'indexed' in value) return Object.freeze({ ...value });
  throw new Error(`${location}: Expected a scalar script argument`);
}

function checkChoiceCount(count: number, location: string): void {
  if (count > 9) throw new Error(`${location}: At most 9 choices can be displayed`);
}

const callScript = defineCommand({
  parse: (args, location) => {
    if (args.length < 1 || typeof args[0] !== 'string' || !args[0]) return;
    return {
      type: 'call' as const,
      target: args[0],
      args: Object.freeze(args.slice(1).map((arg) => getScriptValue(arg, location))),
    };
  },
  execute: (step, context) => context.call(step.target, step.args.map(context.value)),
  targets: (step) => [{ name: step.target, argumentCount: step.args.length }],
});

const returnValue = defineCommand({
  parse: (args, location) => {
    if (args.length > 1) return;
    return { value: args.length ? getScriptValue(args[0], location) : undefined };
  },
  execute: (step, context) => context.returnValue(step.value === undefined ? undefined : context.value(step.value)),
});

const breakLoop = defineCommand({
  parse: (args) => {
    if (args.length !== 2 || typeof args[0] !== 'number' || typeof args[1] !== 'number') return;
    return { target: args[0], header: args[1] };
  },
  execute: (step, context) => context.breakLoop(step.target, step.header),
});

const continueLoop = defineCommand({
  parse: (args) => {
    if (args.length !== 1 || typeof args[0] !== 'number') return;
    return { header: args[0] };
  },
  execute: (step, context) => context.continueLoop(step.header),
});

const callScriptResult = defineCommand({
  parse: (args, location) => {
    if (args.length < 3 || typeof args[0] !== 'string' || typeof args[1] !== 'boolean' ||
      typeof args[2] !== 'string' || !/^[\w-]+$/.test(args[2])) return;
    return {
      destination: args[0], local: args[1], target: args[2],
      args: Object.freeze(args.slice(3).map((arg) => getScriptValue(arg, location))),
    };
  },
  execute: (step, context) => context.callWithResult(step.target, step.args.map(context.value), step.destination, step.local),
  targets: (step) => [{ name: step.target, argumentCount: step.args.length }],
});

const callChSubscript = defineCommand({
  parse: (args, location) => {
    if (args.length !== 2 || typeof args[1] !== 'string' || !/^[\w-]+$/.test(args[1])) return;
    return { character: getScriptValue(args[0], location), target: args[1] };
  },
  execute: (step, script, game: GameScriptContext) => {
    const name = getPlayerCharacterName(step.character, script, 'callChSubscript');
    const character = findCharacter(game.scene, name, game.playerControl.playerWalkCh);
    if (character.isBusy()) return;
    script.callSubscript(character.id, step.target);
  },
  targets: (step) => [{ name: step.target, argumentCount: 1 }],
});

const setBusy = defineCommand({
  parse: (args, location) => {
    if (args.length !== 2) return;
    return { character: getScriptValue(args[0], location), busy: getScriptValue(args[1], location) };
  },
  execute: (step, script, game: GameScriptContext) => {
    const name = getPlayerCharacterName(step.character, script, 'setBusy');
    const busy = getBusyState(step.busy, script);
    findCharacter(game.scene, name, game.playerControl.playerWalkCh).setBusy(busy);
  },
});

const playDialogue = defineCommand({
  parse: (args) => {
    const dialogue = args[0];
    if ((args.length === 2 || args.length === 3) && typeof dialogue === 'string' &&
      typeof args[1] === 'string' && (args.length === 2 || typeof args[2] === 'string'))
      return { type: 'dialogue' as const, actor: dialogue, text: args[1], emotion: args[2] as string | undefined };
    if (
      typeof dialogue === 'object' &&
      dialogue &&
      'actorName' in dialogue &&
      'text' in dialogue
    )
      return { type: 'dialogue' as const, actor: dialogue.actorName, text: dialogue.text, emotion: dialogue.portraitEmotion };
  },
  execute: (step, context, game?: GameScriptContext) => {
    const actor = context.interpolate(step.actor);
    let speaker: Character | undefined;
    context.showDialogue(actor, context.interpolate(step.text), step.emotion, () => {
      if (speaker?.state === 'talking') speaker.setAnimationState('idle');
    });
    if (!game?.scene) return;
    let character: Character;
    try {
      character = findCharacter(game.scene, actor, game.playerControl.playerWalkCh);
    } catch {
      // Off-scene or ambiguous speakers can still speak without animating an instance.
      return;
    }
    if (character.state !== 'idle' || !character.hasAnimationState('talking')) return;
    speaker = character;
    speaker.setAnimationState('talking');
  },
});

const showCenterToast = defineCommand({
  parse: (args, location) => args.length === 1
    ? { message: getScriptValue(args[0], location) } : undefined,
  execute: (step, context) => {
    const message = context.value(step.message);
    if (typeof message !== 'string')
      throw new Error(`${context.location}: showCenterToast requires a message`);
    context.showCenterToast(context.interpolate(message));
  },
});

const setStorage = defineCommand({
  parse: (args, location) => {
    if (args.length !== 2) return;
    let key = args[0];
    if (typeof key === 'object' && ('storageKey' in key || 'localName' in key))
      key = Object.freeze({ ...key });
    else if (typeof key !== 'string' || !key)
      throw new Error(`${location}: setStorage requires a non-empty string key`);
    const value = getScriptValue(args[1], location);
    return {
      type: 'setStorage' as const,
      key,
      value: value === 'true' ? true : value === 'false' ? false : value,
    };
  },
  execute: (step, context) => {
    const key = typeof step.key === 'object' ? context.value(step.key) : step.key;
    if (typeof key !== 'string' || !key)
      throw new Error(`${context.location}: setStorage requires a non-empty string key`);
    context.setGlobal(key, context.value(step.value));
  },
});

const rand100 = defineCommand({
  parse: (args) => args.length === 0 ? { type: 'rand100' as const } : undefined,
  execute: (_step, context) => context.setGlobal('vars.rand100', Math.floor(Math.random() * 100) + 1),
});

function getInventory(value: ReturnType<CommandContext['getStorage']>, location: string): readonly string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string'))
    throw new Error(`${location}: vars.inventory must contain item names`);
  return value;
}

function getItemName(value: ScriptValue, context: CommandContext, command: string): string {
  const item = context.value(value);
  if (typeof item !== 'string' || !item.trim())
    throw new Error(`${context.location}: ${command} requires an item name`);
  return item;
}

const acquireItem = defineCommand({
  parse: (args, location) => args.length === 1
    ? { item: getScriptValue(args[0], location) } : undefined,
  execute: (step, context, game?: GameScriptContext) => {
    const item = getItemName(step.item, context, 'acquireItem');
    if (game?.scene) {
      addInventoryItem(item, context, game);
      return;
    }
    // Script-only terminal runners have no project assets.
    const inventory = getInventory(context.getGlobal('vars.inventory'), context.location);
    if (!inventory.includes(item)) context.setGlobal('vars.inventory', [...inventory, item]);
  },
});

// Keep the existing acquireItem spelling as an alias for older scripts.
const addItem = defineCommand({
  parse: acquireItem.parse,
  execute: (step, context, game?: GameScriptContext) => {
    const item = getItemName(step.item, context, 'addItem');
    if (!game?.scene) throw new Error(`${context.location}: addItem requires item assets`);
    addInventoryItem(item, context, game);
  },
});

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

const removeItem = defineCommand({
  parse: (args, location) => args.length === 1
    ? { item: getScriptValue(args[0], location) } : undefined,
  execute: (step, context, game?: GameScriptContext) => {
    const item = getItemName(step.item, context, 'removeItem');
    if (game?.scene) {
      const id = getItemAsset(game.scene.itemAssets, item).definition.id;
      const entries = getInventoryEntries(context.getGlobal('vars.inventory'), game.scene.itemAssets);
      if (!entries.some((entry) => entry.itemId === id))
        context.writeLog(`[RPGSCRIPT] removeItem: item ${item} is not in vars.inventory (${context.location})`);
      context.setGlobal('vars.inventory', entries.filter((entry) => entry.itemId !== id));
      return;
    }
    const inventory = getInventory(context.getGlobal('vars.inventory'), context.location);
    if (!inventory.includes(item)) {
      context.writeLog(`[RPGSCRIPT] removeItem: item ${item} is not in vars.inventory (${context.location})`);
      return;
    }
    context.setGlobal('vars.inventory', inventory.filter((owned) => owned !== item));
  },
});

const examineItem = defineCommand({
  parse: acquireItem.parse,
  execute: (step, script, game: GameScriptContext) => {
    const asset = getItemAsset(game.scene.itemAssets, getItemName(step.item, script, 'examineItem'));
    const owned = getInventoryEntries(script.getGlobal('vars.inventory'), game.scene.itemAssets)
      .some((entry) => entry.itemId === asset.definition.id);
    const present = game.scene.entities.some((entity) =>
      entity instanceof WorldItem && entity.asset.definition.id === asset.definition.id);
    if (!owned && !present) throw new Error(`${script.location}: Item ${asset.definition.id} is not available`);
    if (asset.definition.examineScript) script.call(asset.definition.examineScript, []);
  },
});

const combineItem = defineCommand({
  parse: (args, location) => {
    if (args.length !== 3) return;
    return { item: getScriptValue(args[0], location), targetType: getScriptValue(args[1], location), target: getScriptValue(args[2], location) };
  },
  execute: (step, script, game: GameScriptContext) => {
    const asset = getItemAsset(game.scene.itemAssets, getItemName(step.item, script, 'combineItem'));
    const entries = getInventoryEntries(script.getGlobal('vars.inventory'), game.scene.itemAssets);
    if (!entries.some((entry) => entry.itemId === asset.definition.id))
      throw new Error(`${script.location}: combineItem requires an owned item`);
    const targetType = script.value(step.targetType);
    const reference = script.value(step.target);
    if (!['item', 'prop', 'character'].includes(String(targetType)) || typeof reference !== 'string')
      throw new Error(`${script.location}: combineItem requires item, prop, or character and a target`);
    let target: ItemTarget;
    if (targetType === 'item') {
      const id = getItemAsset(game.scene.itemAssets, reference).definition.id;
      const available = entries.some((entry) => entry.itemId === id) || game.scene.entities.some((entity) =>
        entity instanceof WorldItem && entity.asset.definition.id === id);
      if (!available) throw new Error(`${script.location}: Target item ${reference} is not available`);
      target = { targetType, target: id };
    } else if (targetType === 'character') {
      target = { targetType, target: findCharacter(game.scene, reference, game.playerControl.playerWalkCh).characterId };
    } else {
      const props = findAnimatedProps(game.scene, reference);
      const ids = new Set(props.map((prop) => prop.propId).filter((id): id is string => !!id));
      if (ids.size !== 1) throw new Error(`${script.location}: Prop target ${reference} is ambiguous or has no asset`);
      target = { targetType: 'prop', target: [...ids][0] };
    }
    const targetScript = getItemCombinationScript(game.scene.itemAssets, asset.definition, target);
    if (targetScript) script.call(targetScript, []);
  },
});

const setStorageIfUndefined = defineCommand({
  parse: (args, location) => {
    if (typeof args[0] === 'object' && 'localName' in args[0])
      throw new Error(`${location}: Set-if-undefined assignments cannot target local variables`);
    return setStorage.parse(args, location, []);
  },
  execute: (step, context) => {
    const key = typeof step.key === 'object' ? context.value(step.key) : step.key;
    if (typeof key !== 'string' || !key)
      throw new Error(`${context.location}: setStorageIfUndefined requires a non-empty string key`);
    if (context.getGlobal(key) === undefined) context.setGlobal(key, context.value(step.value));
  },
});

const log = defineCommand({
  parse: (args) => {
    if (args.length === 1 && typeof args[0] === 'string')
      return { type: 'log' as const, text: args[0] };
  },
  execute: (step, context) =>
    context.writeLog(`[RPGSCRIPT] ${context.interpolate(step.text)} (${context.location})`),
});

const setConv = defineCommand({
  parse: (args) => args.length === 0 ? { type: 'setConv' as const } : undefined,
  execute: (_step, context, game?: GameScriptContext) => {
    game?.resetConversationPortraits?.();
    context.setStorage('dialogue.active', true);
    context.setStorage('dialogue.leftActor', undefined);
    context.setStorage('dialogue.rightActor', undefined);
  },
});

const setConv2 = defineCommand({
  parse: (args) => args.length === 2 && typeof args[0] === 'string' && args[0].length > 0 &&
    typeof args[1] === 'string' && args[1].length > 0
    ? { type: 'setConv2' as const, left: args[0], right: args[1] }
    : undefined,
  execute: (step, context, game?: GameScriptContext) => {
    game?.resetConversationPortraits?.();
    context.setStorage('dialogue.active', true);
    context.setStorage('dialogue.leftActor', context.interpolate(step.left));
    context.setStorage('dialogue.rightActor', context.interpolate(step.right));
  },
});

const endConv = defineCommand({
  parse: (args) => args.length === 0 ? { type: 'endConv' as const } : undefined,
  execute: (_step, context, game?: GameScriptContext) => {
    context.setStorage('dialogue.active', false);
    context.setStorage('dialogue.leftActor', undefined);
    context.setStorage('dialogue.rightActor', undefined);
    game?.playerControl?.endConversation(true);
  },
});

const endConvNR = defineCommand({
  parse: (args) => args.length === 0 ? { type: 'endConvNR' as const } : undefined,
  execute: (_step, context, game?: GameScriptContext) => {
    context.setStorage('dialogue.active', false);
    context.setStorage('dialogue.leftActor', undefined);
    context.setStorage('dialogue.rightActor', undefined);
    game?.playerControl?.endConversation(false);
  },
});

const setPlayerWalkCh = defineCommand({
  parse: (args, location) => {
    if (args.length === 1 || args.length === 2)
      return {
        type: 'setPlayerWalkCh' as const,
        idOrInstanceName: getScriptValue(args[0], location),
        variant: args.length === 2 ? getScriptValue(args[1], location) : undefined,
      };
  },
  execute: (step, script, game: GameScriptContext) => {
    const name = getPlayerCharacterName(step.idOrInstanceName, script);
    const variant = step.variant === undefined ? undefined
      : getCharacterVariantName(step.variant, script, 'setPlayerWalkCh');
    const pending = game.playerControl.setPlayerWalkCh(name, variant);
    if (!pending) return;
    let complete = false;
    let failure: unknown;
    void pending.then(
      () => { complete = true; },
      (error: unknown) => { failure = error; complete = true; },
    );
    script.waitUntil(() => {
      if (!complete) return false;
      if (failure) throw failure;
      return true;
    });
  },
});

const setLocal = defineCommand({
  parse: (args, location, parameters) => {
    if (!parameters.includes(String(args[0])))
      throw new Error(`${location}: Unknown local [${String(args[0])}]`);
    if (args.length === 2 && typeof args[0] === 'string')
      return { type: 'setLocal' as const, name: args[0], value: getScriptValue(args[1], location) };
  },
  execute: (step, context) => context.setLocal(step.name, context.value(step.value)),
});

const setIndex = defineCommand({
  parse: (args, location) => {
    if (args.length !== 3 || typeof args[0] !== 'object' || !('storageKey' in args[0] || 'localName' in args[0])) return;
    return { target: args[0], index: getScriptValue(args[1], location), value: getScriptValue(args[2], location) };
  },
  execute: (step, context) => {
    const list = 'storageKey' in step.target ? context.getGlobal(step.target.storageKey) : context.getLocal(step.target.localName);
    const index = context.value(step.index);
    if (!Array.isArray(list) || !Number.isInteger(index) || typeof index !== 'number' || index < 0 || index >= list.length)
      throw new Error(`${context.location}: Indexed assignment requires a list and an existing integer index`);
    const updated = [...list];
    updated[index] = context.value(step.value);
    if ('storageKey' in step.target) context.setGlobal(step.target.storageKey, updated);
    else context.setLocal(step.target.localName, updated);
  },
});

const getCharacterPos = defineCommand({
  returnsValue: true,
  parse: (args, location) => args.length === 1
    ? { character: getScriptValue(args[0], location) } : undefined,
  execute: (step, script, game: GameScriptContext) => {
    const name = getPlayerCharacterName(step.character, script, 'getCharacterPos');
    const character = findCharacter(game.scene, name, game.playerControl.playerWalkCh);
    return [character.x, character.bottomY];
  },
});

const getChPos = getCharacterPos;

const getPropPos = defineCommand({
  returnsValue: true,
  parse: (args, location) => args.length === 1
    ? { prop: getScriptValue(args[0], location) } : undefined,
  execute: (step, script, game: GameScriptContext) => {
    const name = getPropInstanceName(step.prop, script, 'getPropPos');
    const prop = findProp(game.scene, name);
    return [prop.x, prop.y];
  },
});

function parsePositionArgs(args: Command['args'], location: string) {
  if (args.length !== 3) return;
  return {
    entity: getScriptValue(args[0], location),
    x: getScriptValue(args[1], location),
    y: getScriptValue(args[2], location),
  };
}

const setChPos = defineCommand({
  parse: parsePositionArgs,
  execute: (step, script, game: GameScriptContext) => {
    const name = getPlayerCharacterName(step.entity, script, 'setChPos');
    const { x, y } = getPositionCoordinates(step, script, 'setChPos');
    const character = findCharacter(game.scene, name, game.playerControl.playerWalkCh);
    game.playerControl.stopCharacter(character);
    character.x = x;
    character.y = y - character.bottomOffset;
  },
});

const setPropPos = defineCommand({
  parse: parsePositionArgs,
  execute: (step, script, game: GameScriptContext) => {
    const name = getPropInstanceName(step.entity, script, 'setPropPos');
    const { x, y } = getPositionCoordinates(step, script, 'setPropPos');
    const prop = findProp(game.scene, name);
    prop.x = x;
    prop.y = y;
  },
});

const chWalkToCoord = defineCommand({
  parse: (args, location) => {
    if (args.length !== 3) return;
    return {
      character: getScriptValue(args[0], location),
      x: getScriptValue(args[1], location),
      y: getScriptValue(args[2], location),
    };
  },
  execute: (step, script, game: GameScriptContext) => {
    const { name, x, y } = getWalkDestination(step, script);
    if (x < 0 || y < 0 || x >= game.scene.width || y >= game.scene.height)
      throw new Error(`${script.location}: chWalkToCoord destination is outside the scene`);
    const character = findCharacter(game.scene, name, game.playerControl.playerWalkCh);
    character.walkTo(game.scene, getWalkAnchor(game.scene, character, { x, y }));
  },
});

const walkToMarker = defineCommand({
  parse: (args, location) => {
    if (args.length !== 2 && args.length !== 3) return;
    return {
      character: getScriptValue(args[0], location),
      marker: getScriptValue(args[1], location),
      skipWait: args.length === 3 ? getScriptValue(args[2], location) : false,
    };
  },
  execute: (step, script, game: GameScriptContext) => {
    const name = getPlayerCharacterName(step.character, script, 'walkToMarker');
    const markerName = script.value(step.marker);
    const skipWait = getSkipWait(step.skipWait, script);
    if (typeof markerName !== 'string' || !markerName.trim())
      throw new Error(`${script.location}: walkToMarker requires a marker name`);
    const marker = game.scene.getMarker(markerName);
    if (!marker) throw new Error(`${script.location}: Scene ${game.scene.id} has no marker ${markerName}`);
    const character = findCharacter(game.scene, name, game.playerControl.playerWalkCh);
    const destination = getWalkAnchor(game.scene, character, marker);
    walkScriptedToDestination(name, destination, skipWait, script, game);
  },
});

const walkToOffset = defineCommand({
  parse: (args, location) => {
    if (args.length !== 3 && args.length !== 4) return;
    return {
      character: getScriptValue(args[0], location),
      x: getScriptValue(args[1], location),
      y: getScriptValue(args[2], location),
      skipWait: args.length === 4 ? getScriptValue(args[3], location) : false,
    };
  },
  execute: (step, script, game: GameScriptContext) => {
    const name = getPlayerCharacterName(step.character, script, 'walkToOffset');
    const { x, y } = getWalkOffset(step, script);
    const skipWait = getSkipWait(step.skipWait, script, 'walkToOffset');
    const character = findCharacter(game.scene, name, game.playerControl.playerWalkCh);
    const destination = { x: character.x + x, y: character.bottomY + y };
    if (destination.x < 0 || destination.y < 0 || destination.x >= game.scene.width || destination.y >= game.scene.height)
      throw new Error(`${script.location}: walkToOffset destination is outside the scene`);
    walkScriptedToDestination(name, destination, skipWait, script, game);
  },
});

function walkScriptedToDestination(
  name: string, destination: Point, skipWait: boolean,
  script: CommandContext, game: GameScriptContext,
): void {
  const character = findCharacter(game.scene, name, game.playerControl.playerWalkCh);
  if (character.x === destination.x && character.bottomY === destination.y) return;
  const maxAttempts = 4;
  const retryIntervalMs = 100;
  let attempts = 0;
  let retryAtMs = 0;
  const startAttempt = (): void => {
    attempts++;
    const path = findPath(game.scene, character, destination);
    const closest = path.at(-1);
    if (closest) game.playerControl.walkScripted(character, closest);
    retryAtMs = Date.now() + retryIntervalMs;
  };
  startAttempt();
  if (skipWait) return;
  script.waitUntil(() => {
    if (character.x === destination.x && character.bottomY === destination.y) return true;
    if (game.playerControl.wasWalkCancelled(character)) return true;
    if (game.playerControl.isWalkPausedForConversation(character, destination)) return false;
    if (character.isWalking()) return false;
    if (attempts >= maxAttempts) return true;
    if (Date.now() < retryAtMs) return false;
    startAttempt();
    return character.x === destination.x && character.bottomY === destination.y;
  });
}

const stopCh = defineCommand({
  parse: (args, location) => {
    if (args.length !== 1) return;
    return { character: getScriptValue(args[0], location) };
  },
  execute: (step, script, game: GameScriptContext) => {
    const name = getPlayerCharacterName(step.character, script, 'stopCh');
    const character = findCharacter(game.scene, name, game.playerControl.playerWalkCh);
    game.playerControl.stopCharacter(character);
  },
});

const setSpeedMult = defineCommand({
  parse: (args, location) => {
    if (args.length !== 2) return;
    return {
      character: getScriptValue(args[0], location),
      mult: getScriptValue(args[1], location),
    };
  },
  execute: (step, script, game: GameScriptContext) => {
    const name = getPlayerCharacterName(step.character, script, 'setSpeedMult');
    const mult = getSpeedMultiplier(step.mult, script);
    findCharacter(game.scene, name, game.playerControl.playerWalkCh).speedMult = mult;
  },
});

const setFacing = defineCommand({
  parse: (args, location) => {
    if (args.length !== 2) return;
    return {
      character: getScriptValue(args[0], location),
      direction: getScriptValue(args[1], location),
    };
  },
  execute: (step, script, game: GameScriptContext) => {
    const name = getPlayerCharacterName(step.character, script, 'setFacing');
    const direction = getFacingDirection(step.direction, script);
    const character = findCharacter(game.scene, name, game.playerControl.playerWalkCh);
    character.facing = direction;
    character.animate(0);
  },
});

const lookAtCh = defineCommand({
  parse: (args, location) => {
    if (args.length !== 2) return;
    return {
      character: getScriptValue(args[0], location),
      target: getScriptValue(args[1], location),
    };
  },
  execute: (step, script, game: GameScriptContext) => {
    const name = getPlayerCharacterName(step.character, script, 'lookAtCh');
    const targetName = getPlayerCharacterName(step.target, script, 'lookAtCh');
    const character = findCharacter(game.scene, name, game.playerControl.playerWalkCh);
    const target = findCharacter(game.scene, targetName, game.playerControl.playerWalkCh);
    setFacingToward(character, target.x, target.bottomY);
  },
});

const lookAtMarker = defineCommand({
  parse: (args, location) => {
    if (args.length !== 2) return;
    return {
      character: getScriptValue(args[0], location),
      marker: getScriptValue(args[1], location),
    };
  },
  execute: (step, script, game: GameScriptContext) => {
    const name = getPlayerCharacterName(step.character, script, 'lookAtMarker');
    const markerName = script.value(step.marker);
    if (typeof markerName !== 'string' || !markerName.trim())
      throw new Error(`${script.location}: lookAtMarker requires a marker name`);
    const marker = game.scene.getMarker(markerName);
    if (!marker) throw new Error(`${script.location}: Scene ${game.scene.id} has no marker ${markerName}`);
    const character = findCharacter(game.scene, name, game.playerControl.playerWalkCh);
    setFacingToward(character, marker.x, marker.y);
  },
});

function setFacingToward(character: Character, x: number, y: number): void {
  const direction = getFacingToward(character.x, character.bottomY, x, y);
  if (!direction) return;
  character.facing = direction;
  character.animate(0);
}

const bark = defineCommand({
  parse: (args, location) => {
    if (args.length < 2 || args.length > 4) return;
    return {
      character: getScriptValue(args[0], location),
      text: getScriptValue(args[1], location),
      ms: args.length >= 3 ? getScriptValue(args[2], location) : undefined,
      skipWait: args.length === 4 ? getScriptValue(args[3], location) : undefined,
    };
  },
  execute: (step, script, game: GameScriptContext) => {
    const name = getPlayerCharacterName(step.character, script, 'bark');
    const { text, ms, skipWait } = getBark(step, script);
    const isDone = game.bark?.(findCharacter(game.scene, name, game.playerControl.playerWalkCh), text, ms);
    if (isDone && !skipWait) script.waitUntil(isDone);
  },
});

const setAnimState = defineCommand({
  parse: (args, location) => {
    if (args.length !== 2) return;
    return {
      character: getScriptValue(args[0], location),
      state: getScriptValue(args[1], location),
    };
  },
  execute: (step, script, game: GameScriptContext) => {
    const name = getPlayerCharacterName(step.character, script, 'setAnimState');
    const state = getAnimationStateName(step.state, script);
    const character = findCharacter(game.scene, name, game.playerControl.playerWalkCh);
    if (!character.hasAnimationState(state)) {
      script.writeLog(`[RPGSCRIPT] setAnimState: character ${name} has no animation state ${state}; using idle (${script.location})`);
      character.setAnimationState('idle');
      return;
    }
    character.setAnimationState(state);
  },
});

const setCharacterVariant = defineCommand({
  parse: (args, location) => {
    if (args.length !== 2) return;
    return { character: getScriptValue(args[0], location), variant: getScriptValue(args[1], location) };
  },
  execute: (step, script, game: GameScriptContext) => {
    const name = getPlayerCharacterName(step.character, script, 'setCharacterVariant');
    const variant = getCharacterVariantName(step.variant, script);
    findCharacter(game.scene, name, game.playerControl.playerWalkCh).setVariant(variant);
  },
});

const setPropAnimState = defineCommand({
  parse: (args, location) => {
    if (args.length !== 2) return;
    return {
      prop: getScriptValue(args[0], location),
      state: getScriptValue(args[1], location),
    };
  },
  execute: (step, script, game: GameScriptContext) => {
    const name = getPropInstanceName(step.prop, script);
    const state = getAnimationStateName(step.state, script, 'setPropAnimState');
    for (const prop of findAnimatedProps(game.scene, name)) {
      if (!prop.hasAnimationState(state)) {
        script.writeLog(
          `[RPGSCRIPT] setPropAnimState: prop ${name} has no animation state ${state}; using default (${script.location})`,
        );
        prop.setAnimationState(PROP_DEFAULT_STATE);
        continue;
      }
      prop.setAnimationState(state);
    }
  },
});

const despawnCh = defineCommand({
  parse: (args, location) => {
    if (args.length !== 1) return;
    return { character: getScriptValue(args[0], location) };
  },
  execute: (step, script, game: GameScriptContext) => {
    const name = getPlayerCharacterName(step.character, script, 'despawnCh');
    const character = findCharacter(game.scene, name, game.playerControl.playerWalkCh);
    game.playerControl.forgetCharacter(character);
    game.scene.removeEntity(character);
    game.clearBark?.(character);
    game.clearCharacterSubscript?.(character.id);
  },
});

const waitMs = defineCommand({
  parse: (args, location) => {
    if (args.length !== 1) return;
    return { ms: getScriptValue(args[0], location) };
  },
  execute: (step, script) => {
    const ms = getWaitMilliseconds(step.ms, script);
    const deadline = Date.now() + ms;
    script.waitUntil(() => Date.now() >= deadline);
  },
});

const changeScene = defineCommand({
  parse: (args, location) => {
    if (args.length !== 1 && args.length !== 2) return;
    return {
      sceneId: getScriptValue(args[0], location),
      markerName: args.length === 2 ? getScriptValue(args[1], location) : undefined,
    };
  },
  execute: (step, script, game: GameScriptContext) => {
    const sceneId = script.value(step.sceneId);
    const markerName = step.markerName === undefined ? undefined : script.value(step.markerName);
    if (typeof sceneId !== 'string' || !sceneId.trim())
      throw new Error(`${script.location}: changeScene requires a scene ID`);
    if (markerName !== undefined && (typeof markerName !== 'string' || !markerName.trim()))
      throw new Error(`${script.location}: changeScene requires a marker name`);
    if (!game.changeScene) throw new Error(`${script.location}: changeScene requires a game session`);
    let complete = false;
    let failure: unknown;
    void game.changeScene(sceneId, markerName, script.location).then(
      () => { complete = true; },
      (error: unknown) => { failure = error; complete = true; },
    );
    script.waitUntil(() => {
      if (!complete) return false;
      if (failure) throw failure;
      return true;
    });
  },
});

const awaitChoice = defineCommand({
  parse: (args, location) => {
    if (!args.length || !args.every((arg) => typeof arg === 'string')) return;
    checkChoiceCount(args.length, location);
    return { type: 'awaitChoice' as const, options: Object.freeze([...args]) };
  },
  execute: (step, context) => context.showChoices(step.options.map(context.interpolate)),
});

// The language parser emits showChoices for `$` choice blocks.
const showChoices = defineCommand({
  parse: (args, location) => {
    if (
      !args.length ||
      !args.every(
        (arg) =>
          typeof arg === 'object' &&
          arg &&
          'target' in arg &&
          'text' in arg &&
          arg.text &&
          arg.target,
      )
    )
      return;
    checkChoiceCount(args.length, location);
    const options = Object.freeze(
      args.map((arg) => {
        const { text, target } = arg as Choice;
        return Object.freeze({ text, target });
      }),
    );
    return { type: 'choices' as const, options };
  },
  execute: (step, context) =>
    context.showChoices(
      step.options.map((choice) => context.interpolate(choice.text)),
      (index) => context.call(step.options[index].target, []),
    ),
  targets: (step) => step.options.map((choice) => ({ name: choice.target, argumentCount: 0 })),
});

export const commands = {
  callScript,
  callScriptResult,
  returnValue,
  breakLoop,
  continueLoop,
  callChSubscript,
  setBusy,
  playDialogue,
  showCenterToast,
  setStorage,
  rand100,
  acquireItem,
  addItem,
  removeItem,
  examineItem,
  combineItem,
  setStorageIfUndefined,
  setLocal,
  setIndex,
  log,
  setConv,
  setConv2,
  endConv,
  endConvNR,
  setPlayerWalkCh,
  getCharacterPos,
  getChPos,
  getPropPos,
  setChPos,
  setPropPos,
  chWalkToCoord,
  walkToMarker,
  walkToOffset,
  stopCh,
  setSpeedMult,
  setFacing,
  lookAtCh,
  lookAtMarker,
  bark,
  setAnimState,
  setCharacterVariant,
  setPropAnimState,
  despawnCh,
  waitMs,
  changeScene,
  awaitChoice,
  showChoices,
};

export function getPlayerCharacterName(
  value: ScriptValue,
  context: CommandContext,
  command = 'setPlayerWalkCh',
): string {
  const name = context.value(value);
  if (typeof name !== 'string' || !name.trim())
    throw new Error(`${context.location}: ${command} requires a character id or instance name`);
  return name;
}

export function getWalkDestination(
  step: { character: ScriptValue; x: ScriptValue; y: ScriptValue },
  script: CommandContext,
): { name: string; x: number; y: number } {
  const name = getPlayerCharacterName(step.character, script, 'chWalkToCoord');
  const x = script.value(step.x),
    y = script.value(step.y);
  if (
    typeof x !== 'number' ||
    typeof y !== 'number' ||
    !Number.isInteger(x) ||
    !Number.isInteger(y)
  )
    throw new Error(`${script.location}: chWalkToCoord requires integer coordinates`);
  return { name, x, y };
}

export function getPositionCoordinates(
  step: { x: ScriptValue; y: ScriptValue }, script: CommandContext, command: string,
): Point {
  const x = script.value(step.x);
  const y = script.value(step.y);
  if (typeof x !== 'number' || typeof y !== 'number' || !Number.isSafeInteger(x) || !Number.isSafeInteger(y))
    throw new Error(`${script.location}: ${command} requires integer coordinates`);
  return { x, y };
}

export function getWalkOffset(
  step: { x: ScriptValue; y: ScriptValue }, script: CommandContext,
): Point {
  const x = script.value(step.x);
  const y = script.value(step.y);
  if (typeof x !== 'number' || typeof y !== 'number' || !Number.isInteger(x) || !Number.isInteger(y))
    throw new Error(`${script.location}: walkToOffset requires integer offsets`);
  return { x, y };
}

export function getSkipWait(value: ScriptValue, script: CommandContext, command = 'walkToMarker'): boolean {
  const resolved = script.value(value);
  if (resolved === true || resolved === 'true') return true;
  if (resolved === false || resolved === 'false') return false;
  throw new Error(`${script.location}: ${command} skipWait must be a boolean`);
}

export function getBusyState(value: ScriptValue, script: CommandContext): boolean {
  const resolved = script.value(value);
  if (resolved === true || resolved === 'true') return true;
  if (resolved === false || resolved === 'false') return false;
  throw new Error(`${script.location}: setBusy requires true or false`);
}

export function getFacingDirection(value: ScriptValue, script: CommandContext): CharacterDirection {
  const direction = script.value(value);
  if (typeof direction !== 'string' || !CHARACTER_DIRECTIONS.includes(direction as CharacterDirection))
    throw new Error(`${script.location}: setFacing direction must be up, down, left, or right`);
  return direction as CharacterDirection;
}

export function getSpeedMultiplier(value: ScriptValue, script: CommandContext): number {
  const mult = script.value(value);
  if (typeof mult !== 'number' || !Number.isFinite(mult) || mult <= 0)
    throw new Error(`${script.location}: setSpeedMult requires a positive number`);
  return mult;
}

export function getFacingToward(
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
): CharacterDirection | undefined {
  const dx = toX - fromX;
  const dy = toY - fromY;
  if (dx === 0 && dy === 0) return;
  if (Math.abs(dx) >= Math.abs(dy)) return dx > 0 ? 'right' : 'left';
  return dy > 0 ? 'down' : 'up';
}

export function getPropInstanceName(
  value: ScriptValue,
  context: CommandContext,
  command = 'setPropAnimState',
): string {
  const name = context.value(value);
  if (typeof name !== 'string' || !name.trim())
    throw new Error(`${context.location}: ${command} requires a prop instance name or ID`);
  return name;
}

export function getAnimationStateName(
  value: ScriptValue,
  script: CommandContext,
  command = 'setAnimState',
): string {
  const state = script.value(value);
  if (typeof state !== 'string' || !state.trim())
    throw new Error(`${script.location}: ${command} requires an animation state name`);
  return state;
}

export function getCharacterVariantName(
  value: ScriptValue, script: CommandContext, command = 'setCharacterVariant',
): string {
  const variant = script.value(value);
  if (typeof variant !== 'string' || !isCharacterVariantName(variant))
    throw new Error(`${script.location}: ${command} requires a variant name`);
  return variant;
}

export function getWaitMilliseconds(value: ScriptValue, script: CommandContext): number {
  const ms = script.value(value);
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0)
    throw new Error(`${script.location}: waitMs requires a non-negative number of milliseconds`);
  return ms;
}

export const DEFAULT_BARK_MS = 2000;

export function getBark(
  step: { text: ScriptValue; ms?: ScriptValue; skipWait?: ScriptValue },
  script: CommandContext,
): { text: string; ms: number; skipWait: boolean } {
  const text = script.value(step.text);
  if (typeof text !== 'string' && typeof text !== 'number' && typeof text !== 'boolean')
    throw new Error(`${script.location}: bark text must be a string`);
  const ms = step.ms === undefined ? DEFAULT_BARK_MS : Number(script.value(step.ms));
  if (!Number.isFinite(ms) || ms <= 0)
    throw new Error(`${script.location}: bark ms must be a positive number`);
  const skipWait = step.skipWait === undefined ? false : getSkipWait(step.skipWait, script);
  return { text: String(text), ms, skipWait };
}
