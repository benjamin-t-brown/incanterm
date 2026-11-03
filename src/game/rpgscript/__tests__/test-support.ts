// Game-backed fixtures for interpreter tests; production RPGScript has no game defaults.
import { commands } from '../../scene-commands.js';
import { sceneCommandsShim, type ShimIO } from '../../scene-commands-shim.js';
import * as runtime from '../runtime.js';
import type { CommandCatalog } from '../command.js';

export { commands } from '../../scene-commands.js';
export { ScriptParser, TriggerType } from '../parser.js';

type TestOptions = { shim?: boolean; commands?: CommandCatalog };

export function parseRpgScript(source: string, file: string, options: TestOptions = {}) {
  return runtime.parseRpgScript(source, file, {
    commands: options.commands ?? (options.shim ? sceneCommandsShim : commands),
  });
}

export function loadRpgScripts(root: string, options: TestOptions = {}) {
  return runtime.loadRpgScripts(root, {
    commands: options.commands ?? (options.shim ? sceneCommandsShim : commands),
  });
}

export class ScriptRunner extends runtime.ScriptRunner<ShimIO> {
  constructor(library: runtime.ScriptLibrary, writeLog?: (message: string) => void) {
    super(library, {
      commands: sceneCommandsShim,
      context: { writeLine: () => {}, promptChoice: async () => 0 },
      writeLog,
    });
  }
}
