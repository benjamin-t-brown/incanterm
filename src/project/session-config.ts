import fs from 'node:fs/promises';
import path from 'node:path';
import type { DialogueAnimationOptions, PortraitAnimationOptions } from '../server/game-session.js';

export type SessionScriptHooks = Readonly<{
  propUnreachable?: string;
}>;

export type SessionConfig = {
  dialogueAnimation?: DialogueAnimationOptions;
  portraitAnimation?: PortraitAnimationOptions;
  timerTriggers?: readonly string[];
  scriptHooks?: SessionScriptHooks;
};

/** Reads project-owned runtime settings shared by server and local previews. */
export async function loadSessionConfig(assetsRoot: string): Promise<SessionConfig> {
  const file = path.join(assetsRoot, 'session-config.json');
  let contents: string;
  try {
    contents = await fs.readFile(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw error;
  }
  let value: unknown;
  try {
    value = JSON.parse(contents);
  } catch {
    throw new Error(`${file}: Invalid JSON`);
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`${file}: Expected an object`);
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!['dialogueAnimation', 'portraitAnimation', 'timerTriggers', 'scriptHooks'].includes(key))
      throw new Error(`${file}: Unknown setting ${key}`);
  }
  const config: SessionConfig = {};
  const hooks = record.scriptHooks;
  if (hooks !== undefined) {
    if (hooks === null || typeof hooks !== 'object' || Array.isArray(hooks))
      throw new Error(`${file}: scriptHooks must be an object`);
    const { propUnreachable, ...unknownHooks } = hooks as Record<string, unknown>;
    for (const key of Object.keys(unknownHooks))
      throw new Error(`${file}: Unknown scriptHooks setting ${key}`);
    if (propUnreachable !== undefined && (typeof propUnreachable !== 'string' || !propUnreachable.trim()))
      throw new Error(`${file}: scriptHooks.propUnreachable must be an RPGScript function name`);
    config.scriptHooks = propUnreachable === undefined ? {} : { propUnreachable };
  }
  const timerTriggers = record.timerTriggers;
  if (timerTriggers !== undefined) {
    if (
      !Array.isArray(timerTriggers) ||
      timerTriggers.some((name: unknown) => typeof name !== 'string' || !name.trim())
    )
      throw new Error(`${file}: timerTriggers must be an array of RPGScript trigger names`);
    config.timerTriggers = timerTriggers;
  }
  const portrait = record.portraitAnimation;
  if (portrait !== undefined) {
    if (portrait === null || typeof portrait !== 'object' || Array.isArray(portrait))
      throw new Error(`${file}: portraitAnimation must be an object`);
    const settings = portrait as Record<string, unknown>;
    for (const key of Object.keys(settings)) {
      if (!['enabled', 'stepDurationMs', 'rowDelayMs'].includes(key))
        throw new Error(`${file}: Unknown portraitAnimation setting ${key}`);
    }
    if (settings.enabled !== undefined && typeof settings.enabled !== 'boolean')
      throw new Error(`${file}: portraitAnimation.enabled must be a boolean`);
    if (
      settings.stepDurationMs !== undefined &&
      (typeof settings.stepDurationMs !== 'number' ||
        !Number.isFinite(settings.stepDurationMs) ||
        settings.stepDurationMs <= 0)
    )
      throw new Error(`${file}: portraitAnimation.stepDurationMs must be a positive number`);
    if (
      settings.rowDelayMs !== undefined &&
      (typeof settings.rowDelayMs !== 'number' ||
        !Number.isFinite(settings.rowDelayMs) ||
        settings.rowDelayMs < 0)
    )
      throw new Error(`${file}: portraitAnimation.rowDelayMs must be a nonnegative number`);
    config.portraitAnimation = settings as PortraitAnimationOptions;
  }
  const animation = record.dialogueAnimation;
  if (animation === undefined) return config;
  if (animation === null || typeof animation !== 'object' || Array.isArray(animation))
    throw new Error(`${file}: dialogueAnimation must be an object`);
  const settings = animation as Record<string, unknown>;
  for (const key of Object.keys(settings)) {
    if (
      ![
        'enabled',
        'stepDurationMs',
        'wordDelayMs',
        'growthSequences',
        'shortGrowthSequences',
      ].includes(key)
    )
      throw new Error(`${file}: Unknown dialogueAnimation setting ${key}`);
  }
  if (settings.enabled !== undefined && typeof settings.enabled !== 'boolean')
    throw new Error(`${file}: dialogueAnimation.enabled must be a boolean`);
  if (
    settings.stepDurationMs !== undefined &&
    (typeof settings.stepDurationMs !== 'number' ||
      !Number.isFinite(settings.stepDurationMs) ||
      settings.stepDurationMs <= 0)
  )
    throw new Error(`${file}: dialogueAnimation.stepDurationMs must be a positive number`);
  if (
    settings.wordDelayMs !== undefined &&
    (typeof settings.wordDelayMs !== 'number' ||
      !Number.isFinite(settings.wordDelayMs) ||
      settings.wordDelayMs < 0)
  )
    throw new Error(`${file}: dialogueAnimation.wordDelayMs must be a nonnegative number`);
  if (
    settings.growthSequences !== undefined &&
    (!Array.isArray(settings.growthSequences) ||
      !settings.growthSequences.length ||
      settings.growthSequences.some(
        (sequence: unknown) => typeof sequence !== 'string' || sequence.length !== 4,
      ))
  )
    throw new Error(
      `${file}: dialogueAnimation.growthSequences must contain four-character strings`,
    );
  if (
    settings.shortGrowthSequences !== undefined &&
    (!Array.isArray(settings.shortGrowthSequences) ||
      !settings.shortGrowthSequences.length ||
      settings.shortGrowthSequences.some(
        (sequence: unknown) => typeof sequence !== 'string' || sequence.length !== 4,
      ))
  )
    throw new Error(
      `${file}: dialogueAnimation.shortGrowthSequences must contain four-character strings`,
    );
  config.dialogueAnimation = settings as DialogueAnimationOptions;
  return config;
}
