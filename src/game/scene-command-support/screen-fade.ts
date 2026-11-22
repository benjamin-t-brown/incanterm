import type { CommandContext } from '../rpgscript/command.js';
import type { Command, ScriptValue } from '../rpgscript/parser.js';
import { getScriptValue, getWaitMilliseconds } from './arguments.js';
import type { GameScriptContext } from './context.js';

export function parseFadeArgs(args: Command['args'], location: string): { ms: ScriptValue } | undefined {
  if (args.length !== 1) return;
  return { ms: getScriptValue(args[0], location) };
}

export function waitForScreenFade(
  step: { ms: ScriptValue }, script: CommandContext, game: GameScriptContext, target: 0 | 1,
): void {
  const command = target === 1 ? 'fadeOut' : 'fadeIn';
  const ms = getWaitMilliseconds(step.ms, script, command);
  if (script.background) throw new Error(`${script.location}: Character subscripts cannot fade the screen`);
  if (!game?.startScreenFade) throw new Error(`${script.location}: ${command} requires a game session`);
  script.waitUntil(game.startScreenFade(target, ms));
}
