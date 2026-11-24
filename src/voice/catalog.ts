import fs from 'node:fs/promises';
import path from 'node:path';
import { ScriptParser } from '../game/rpgscript/parser.js';
import { commands } from '../game/scene-commands.js';
import type {
  VoiceCatalog,
  VoiceCatalogLine,
  VoiceContext,
  VoiceLocation,
} from './catalog-types.js';

export { getVoiceRevision } from './contracts.js';
export type {
  VoiceCatalog,
  VoiceCatalogLine,
  VoiceContext,
  VoiceLocation,
} from './catalog-types.js';

function getScriptLines(file: string, source: string): VoiceCatalogLine[] {
  const result: VoiceCatalogLine[] = [];
  for (const script of Object.values(new ScriptParser(file).parse(source).scripts)) {
    let before: VoiceContext | null = null;
    let preceding: VoiceCatalogLine | undefined;
    for (const block of script.blocks) {
      for (const command of block.commands) {
        if (command.type !== 'playDialogue' && command.type !== 'playDialogueInterruptable')
          continue;
        // Use the command compiler, not just its argument parser: result assignment
        // to a dialogue command is invalid even if the dialogue arguments are valid.
        const dialogue = commands.playDialogue(command, `${file}:${command.i}`, script.parameters);
        const context = { speaker: dialogue.actor, text: dialogue.text };
        if (preceding) preceding.after = context;
        preceding = undefined;
        if (dialogue.voice) {
          preceding = {
            ...context,
            ...dialogue.voice,
            file,
            script: script.name,
            line: command.i,
            before,
            after: null,
          };
          result.push(preceding);
        }
        before = context;
      }
    }
  }
  return result;
}

/** Locations are relative to the selected assets root (e.g. scripts/intro.rpgscript). */
export async function readVoiceCatalog(assetsRoot: string): Promise<VoiceCatalog> {
  const catalog: VoiceCatalog = { lines: [], errors: [], duplicates: [] };
  function reportError(file: string, cause: unknown) {
    catalog.errors.push({ file, message: cause instanceof Error ? cause.message : String(cause) });
  }
  try {
    const directory = path.join(assetsRoot, 'scripts');
    const stat = await fs.lstat(directory);
    if (!stat.isDirectory())
      throw new Error('Expected scripts to be a directory, not a link or file');
    // Match loadRpgScripts, including dotted file names which the asset picker does not list.
    const files = (await fs.readdir(directory))
      .filter((name) => name.endsWith('.rpgscript'))
      .sort();
    for (const name of files) {
      const file = `scripts/${name}`;
      try {
        const fullPath = path.join(directory, name);
        if (!(await fs.lstat(fullPath)).isFile())
          throw new Error(`Expected a regular script file: ${file}`);
        catalog.lines.push(...getScriptLines(file, await fs.readFile(fullPath, 'utf8')));
      } catch (error) {
        reportError(file, error);
      }
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') reportError('scripts', error);
  }
  const owners = new Map<string, VoiceLocation[]>();
  for (const { lineId, file, script, line } of catalog.lines) {
    const locations = owners.get(lineId) ?? [];
    locations.push({ file, script, line });
    owners.set(lineId, locations);
  }
  for (const [lineId, locations] of owners) {
    if (locations.length > 1) catalog.duplicates.push({ lineId, locations });
  }
  return catalog;
}
