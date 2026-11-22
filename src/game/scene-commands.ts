// Keep this catalog and each `const name =` declaration together: the RPGScript
// language extension reads this file to discover supported commands.
import { PROP_DEFAULT_STATE } from '../editor/schema.js';
import type { Character } from './character.js';
import { findCharacter, getWalkAnchor } from './character-movement.js';
import { getInventoryEntries, getItemAsset, getItemCombinationScript, WorldItem, type ItemTarget } from './items.js';
import { findAnimatedProps, findProp } from './prop-lookup.js';
import { getPropClimbPath as getClimbRoute } from './prop-climb.js';
import { SLIDE_DIRECTIONS } from './prop-slide.js';
import { defineCommand } from './rpgscript/command.js';
import {
  checkChoiceCount, getAnimationStateName, getBark, getBusyState, getCharacterVariantName,
  getFacingDirection, getPlayerCharacterName, getPositionCoordinates, getPropInstanceName,
  getScriptValue, getSkipWait, getSpeedMultiplier, getWaitMilliseconds, getWalkDestination,
  getWalkOffset, parseBarkArgs, parsePositionArgs,
} from './scene-command-support/arguments.js';
import type { Choice, GameScriptContext } from './scene-command-support/context.js';
import { addInventoryItem, addNamedInventoryItem, getInventory, getItemName } from './scene-command-support/inventory.js';
import { setFacingToward, walkScriptedToDestination } from './scene-command-support/movement.js';
import {
  getPropSlideControl, getSlidePropId, isSlideCommandReference, parseSlidePropArgs,
  parseSlidePropId, waitForPropSlideResult,
} from './scene-command-support/prop-slide.js';
import { parseFadeArgs, waitForScreenFade } from './scene-command-support/screen-fade.js';

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

const setChForeground = defineCommand({
  parse: (args, location) => args.length === 2
    ? { character: getScriptValue(args[0], location), foreground: getScriptValue(args[1], location) }
    : undefined,
  execute: (step, script, game: GameScriptContext) => {
    const name = getPlayerCharacterName(step.character, script, 'setChForeground');
    const foreground = getBusyState(step.foreground, script, 'setChForeground');
    findCharacter(game.scene, name, game.playerControl.playerWalkCh).foreground = foreground;
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

const acquireItem = defineCommand({
  parse: (args, location) => args.length === 1
    ? { item: getScriptValue(args[0], location) } : undefined,
  execute: (step, context, game?: GameScriptContext) => {
    const item = getItemName(step.item, context, 'acquireItem');
    let label: string | undefined;
    if (game?.scene) label = addInventoryItem(item, context, game, 'first');
    else if (addNamedInventoryItem(item, context, 'first')) label = item;
    if (label !== undefined && !context.background) context.showCenterToast(`Acquired ${label}`);
  },
});

// Add an item without interrupting the script with a toast.
const addItem = defineCommand({
  parse: acquireItem.parse,
  execute: (step, context, game?: GameScriptContext) => {
    const item = getItemName(step.item, context, 'addItem');
    if (!game?.scene) throw new Error(`${context.location}: addItem requires item assets`);
    addInventoryItem(item, context, game);
  },
});

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

const getMarkerPos = defineCommand({
  returnsValue: true,
  parse: (args, location) => args.length === 1 ? { marker: getScriptValue(args[0], location) } : undefined,
  execute: (step, script, game: GameScriptContext) => {
    const name = script.value(step.marker);
    if (typeof name !== 'string' || !name.trim())
      throw new Error(`${script.location}: getMarkerPos requires a marker name`);
    const marker = game.scene.getMarker(name);
    if (!marker) throw new Error(`${script.location}: Scene ${game.scene.id} has no marker ${name}`);
    return [marker.x, marker.y];
  },
});

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

const bark = defineCommand({
  parse: parseBarkArgs,
  execute: (step, script, game: GameScriptContext) => {
    const name = getPlayerCharacterName(step.target, script, 'bark');
    const { text, ms, skipWait } = getBark(step, script);
    const isDone = game.bark?.(findCharacter(game.scene, name, game.playerControl.playerWalkCh), text, ms);
    if (isDone && !skipWait) script.waitUntil(isDone);
  },
});

const barkProp = defineCommand({
  parse: parseBarkArgs,
  execute: (step, script, game: GameScriptContext) => {
    const name = getPropInstanceName(step.target, script, 'barkProp');
    const { text, ms, skipWait } = getBark(step, script, 'barkProp');
    const prop = findProp(game.scene, name);
    const isDone = game.bark?.(prop, text, ms);
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

const fadeOut = defineCommand({
  parse: parseFadeArgs,
  execute: (step, script, game: GameScriptContext) => waitForScreenFade(step, script, game, 1),
});

const fadeIn = defineCommand({
  parse: parseFadeArgs,
  execute: (step, script, game: GameScriptContext) => waitForScreenFade(step, script, game, 0),
});

const getSceneId = defineCommand({
  returnsValue: true,
  parse: (args) => args.length === 0 ? {} : undefined,
  execute: (_step, _script, game: GameScriptContext) => game.scene.id,
});

const getSceneName = defineCommand({
  returnsValue: true,
  parse: getSceneId.parse,
  execute: (_step, _script, game: GameScriptContext) => game.scene.label ?? game.scene.id,
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

const approachSlideProp = defineCommand({
  returnsValue: 'deferred',
  parse: parseSlidePropArgs,
  execute: (step, script, game: GameScriptContext, setResult) => {
    const id = getSlidePropId(step.prop, script);
    waitForPropSlideResult(script, getPropSlideControl(game, script, true).startApproach(id), setResult);
  },
});

const getPropPushes = defineCommand({
  returnsValue: true,
  parse: parseSlidePropArgs,
  execute: (step, script, game: GameScriptContext) =>
    getPropSlideControl(game, script).getPushes(getSlidePropId(step.prop, script)),
});

const choosePropPush = defineCommand({
  returnsValue: 'deferred',
  parse: parseSlidePropArgs,
  execute: (step, script, game: GameScriptContext, setResult) => {
    const id = getSlidePropId(step.prop, script);
    const control = getPropSlideControl(game, script, true);
    if (!control.canChoosePush(id)) {
      setResult('cancel');
      return;
    }
    const directions = control.getPushes(id);
    if (!directions.length) script.writeLog('No pushes are available.');
    game.revealPropPushChoices?.();
    const labels = directions.map(direction => direction[0].toUpperCase() + direction.slice(1));
    script.showChoices([...labels, 'Cancel'],
      (index) => setResult(directions[index] ?? 'cancel'));
  },
});

const slideProp = defineCommand({
  returnsValue: 'deferred',
  parse: (args, location) => {
    if (args.length !== 2) throw new Error(`${location}: Expected a slidable prop instance ID and a direction`);
    const direction = getScriptValue(args[1], location);
    if (!SLIDE_DIRECTIONS.some((side) => side === direction) && !isSlideCommandReference(direction))
      throw new Error(`${location}: Prop push direction must be left, right, up, or down`);
    return { prop: parseSlidePropId(args[0], location), direction };
  },
  execute: (step, script, game: GameScriptContext, setResult) => {
    const id = getSlidePropId(step.prop, script);
    const value = script.value(step.direction);
    const direction = SLIDE_DIRECTIONS.find((side) => side === value);
    if (!direction) throw new Error(`${script.location}: Prop push direction must be left, right, up, or down`);
    waitForPropSlideResult(script, getPropSlideControl(game, script, true).startSlide(id, direction), setResult);
  },
});

const resetPropSlides = defineCommand({
  returnsValue: true,
  parse: (args, location) => {
    if (args.length !== 1) throw new Error(`${location}: resetPropSlides requires one safe marker name`);
    const marker = getScriptValue(args[0], location);
    if (!(typeof marker === 'string' && marker.trim()) && !isSlideCommandReference(marker))
      throw new Error(`${location}: resetPropSlides requires a safe marker name`);
    return { marker };
  },
  execute: (step, script, game: GameScriptContext) => {
    const markerName = script.value(step.marker);
    if (typeof markerName !== 'string' || !markerName.trim())
      throw new Error(`${script.location}: resetPropSlides requires a safe marker name`);
    if (!game.resetPropSlides) throw new Error(`${script.location}: resetPropSlides requires a game session`);
    return game.resetPropSlides(markerName, script.background ?? false);
  },
});

const getPropClimbPath = defineCommand({
  returnsValue: true,
  parse: (args, location) => {
    if (args.length !== 1 && args.length !== 2) return;
    return {
      marker: getScriptValue(args[0], location),
      mode: args.length === 2 ? getScriptValue(args[1], location) : 'waypoints',
    };
  },
  execute: (step, script, game: GameScriptContext) => {
    const name = script.value(step.marker);
    if (typeof name !== 'string' || !name.trim())
      throw new Error(`${script.location}: getPropClimbPath requires a landing marker name`);
    const landing = game.scene.getMarker(name);
    if (!landing) throw new Error(`${script.location}: Scene ${game.scene.id} has no marker ${name}`);
    const mode = script.value(step.mode);
    if (mode !== 'waypoints' && mode !== 'shelfCenters')
      throw new Error(`${script.location}: getPropClimbPath mode must be waypoints or shelfCenters`);
    const player = game.playerControl.playerWalkCh;
    if (!player || !game.scene.entities.includes(player)) return [];
    return getClimbRoute(game.scene, landing, player, mode).map((step) => {
      const point = mode === 'shelfCenters' && step.kind === 'roof'
        ? getWalkAnchor(game.scene, player, step)
        : step;
      return [point.x, point.y];
    });
  },
});

const awaitChoice = defineCommand({
  parse: (args, location) => {
    if (args.length < 2 || !args.every((arg) => typeof arg === 'string') || !args[0].trim())
      throw new Error(`${location}: awaitChoice requires a question followed by at least one option`);
    const [question, ...options] = args;
    checkChoiceCount(options.length, location);
    return { type: 'awaitChoice' as const, question, options: Object.freeze(options) };
  },
  execute: (step, context) => context.showChoices(step.options.map(context.interpolate), undefined, context.interpolate(step.question)),
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
  setChForeground,
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
  getMarkerPos,
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
  barkProp,
  setAnimState,
  setCharacterVariant,
  setPropAnimState,
  despawnCh,
  waitMs,
  fadeOut,
  fadeIn,
  getSceneId,
  getSceneName,
  changeScene,
  approachSlideProp,
  getPropPushes,
  choosePropPush,
  slideProp,
  resetPropSlides,
  getPropClimbPath,
  awaitChoice,
  showChoices,
};
