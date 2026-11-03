// Keep this catalog and each `const name =` declaration together: the RPGScript
// language extension reads this file to discover supported commands.
import type { Command, ScriptValue } from './rpgscript/parser.js';
import type { PlayerControl } from './player-control.js';
import type { Scene } from './scene.js';
import { findCharacter } from './character-movement.js';
import { defineCommand, type CommandContext } from './rpgscript/command.js';

export type GameScriptContext = { scene: Scene; playerControl: PlayerControl };

export type Choice = Readonly<{ text: string; target: string }>;

function getScriptValue(value: Command['args'][number], location: string): ScriptValue {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')
    return value;
  if ('storageKey' in value || 'localName' in value) return Object.freeze({ ...value });
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
  execute: (step, context) =>
    context.showDialogue(context.interpolate(step.actor), context.interpolate(step.text), step.emotion),
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
    context.setStorage(key, context.value(step.value));
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
  execute: (_step, context) => {
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
  execute: (step, context) => {
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
    if (args.length === 1)
      return { type: 'setPlayerWalkCh' as const, idOrInstanceName: getScriptValue(args[0], location) };
  },
  execute: (step, script, game: GameScriptContext) => {
    game.playerControl.setPlayerWalkCh(getPlayerCharacterName(step.idOrInstanceName, script));
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
    findCharacter(game.scene, name).walkTo(game.scene, { x, y });
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
  playDialogue,
  setStorage,
  setLocal,
  log,
  setConv,
  setConv2,
  endConv,
  endConvNR,
  setPlayerWalkCh,
  chWalkToCoord,
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
