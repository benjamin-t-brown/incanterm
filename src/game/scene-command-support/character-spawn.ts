import type { CommandContext } from '../rpgscript/command.js';
import type { ScriptValue } from '../rpgscript/parser.js';
import { getCharacterVariantName, getPlayerCharacterName } from './arguments.js';

export function getSpawnTarget(step: { character: ScriptValue; variant: ScriptValue; marker: ScriptValue }, script: CommandContext) {
  const name = getPlayerCharacterName(step.character, script, 'spawnCh');
  const variant = getCharacterVariantName(step.variant, script, 'spawnCh');
  const marker = script.value(step.marker);
  if (typeof marker !== 'string' || !marker.trim())
    throw new Error(`${script.location}: spawnCh requires a marker name`);
  return { name, variant, marker };
}

export function waitForCharacterLoad(script: CommandContext, pending: Promise<void>): void {
  let complete = false;
  let failure: { error: unknown } | undefined;
  void pending.then(
    () => { complete = true; },
    (error: unknown) => { failure = { error }; },
  );
  script.waitUntil(() => {
    if (failure) throw failure.error;
    return complete;
  });
}
