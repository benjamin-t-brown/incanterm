import { CHARACTER_DIRECTIONS, isCharacterVariantName, type CharacterDirection } from '../../editor/schema.js';
import type { Point } from '../character-movement.js';
import type { CommandContext } from '../rpgscript/command.js';
import type { Command, ScriptValue } from '../rpgscript/parser.js';

export function getScriptValue(value: Command['args'][number], location: string): ScriptValue {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')
    return value;
  if ('storageKey' in value || 'localName' in value || 'expression' in value || 'list' in value || 'indexed' in value) return Object.freeze({ ...value });
  throw new Error(`${location}: Expected a scalar script argument`);
}

export function checkChoiceCount(count: number, location: string): void {
  if (count > 9) throw new Error(`${location}: At most 9 choices can be displayed`);
}

export function parsePositionArgs(args: Command['args'], location: string) {
  if (args.length !== 3) return;
  return {
    entity: getScriptValue(args[0], location),
    x: getScriptValue(args[1], location),
    y: getScriptValue(args[2], location),
  };
}

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
