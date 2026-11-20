import type { PropSlideControl } from '../prop-slide-control.js';
import type { CommandContext } from '../rpgscript/command.js';
import type { Command, ScriptValue } from '../rpgscript/parser.js';
import { getScriptValue } from './arguments.js';
import type { GameScriptContext } from './context.js';

export function parseSlidePropArgs(args: Command['args'], location: string) {
  if (args.length !== 1) throw new Error(`${location}: Expected one slidable prop instance ID`);
  return { prop: parseSlidePropId(args[0], location) };
}

export function isSlideCommandReference(value: ScriptValue): boolean {
  return typeof value === 'object' && ('localName' in value || 'storageKey' in value || 'indexed' in value);
}

export function parseSlidePropId(arg: Command['args'][number], location: string): ScriptValue {
  const prop = getScriptValue(arg, location);
  if (!(typeof prop === 'string' && prop.trim()) && !isSlideCommandReference(prop))
    throw new Error(`${location}: Expected a slidable prop instance ID`);
  return prop;
}

export function getSlidePropId(value: ScriptValue, script: CommandContext): string {
  const id = script.value(value);
  if (typeof id !== 'string' || !id.trim())
    throw new Error(`${script.location}: Expected a slidable prop instance ID`);
  return id;
}

export function getPropSlideControl(game: Partial<GameScriptContext> | undefined, script: CommandContext, interactive = false): PropSlideControl {
  if (!game?.propSlides) throw new Error(`${script.location}: Prop slide commands require a game session`);
  if (interactive) {
    if (script.background) throw new Error(`${script.location}: Prop slide interactions require a foreground script`);
    game.beginPropSlideInteraction?.();
  }
  return game.propSlides;
}

export function waitForPropSlideResult(
  script: CommandContext, getResult: () => boolean | undefined, setResult: (result: boolean) => void,
): void {
  script.waitUntil(() => {
    const result = getResult();
    if (result === undefined) return false;
    setResult(result);
    return true;
  });
}
