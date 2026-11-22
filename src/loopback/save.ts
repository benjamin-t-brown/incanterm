import fs from 'node:fs/promises';
import type { RuntimeValue } from '../game/rpgscript/index.js';
import type { ScriptVariables } from '../server/game-session.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isScriptValue(value: unknown): value is RuntimeValue {
  if (typeof value === 'boolean' || typeof value === 'string') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isScriptValue);
  return isRecord(value) && Object.values(value).every(isScriptValue);
}

function parseSaveVariables(contents: string): ScriptVariables {
  let save: unknown;
  try {
    save = JSON.parse(contents);
  } catch {
    throw new Error('Invalid JSON');
  }
  if (!isRecord(save)) throw new Error('Expected a JSON object');
  if (save.v !== 1) throw new Error('Expected save version "v": 1');
  for (const key of Object.keys(save)) {
    if (key !== 'v' && key !== 'vars')
      throw new Error(`Unsupported save field ${JSON.stringify(key)}`);
  }
  if (!isRecord(save.vars)) throw new Error('"vars" must be an object');
  const entries = Object.entries(save.vars).map(([key, value]) => {
    if (!/^[A-Za-z_][\w-]*(?:\.[A-Za-z_][\w-]*)*$/.test(key))
      throw new Error(`Invalid RPGScript variable name ${JSON.stringify(key)}`);
    if (!isScriptValue(value))
      throw new Error(`Unsupported value for RPGScript variable ${JSON.stringify(key)}`);
    return [key, value] as const;
  });
  return Object.fromEntries(entries);
}

export async function loadSaveVariables(savePath: string): Promise<ScriptVariables> {
  try {
    return parseSaveVariables(await fs.readFile(savePath, 'utf8'));
  } catch (error) {
    const details = error instanceof Error ? error.message : String(error);
    throw new Error(`Cannot load loopback save ${JSON.stringify(savePath)}: ${details}`, {
      cause: error,
    });
  }
}
