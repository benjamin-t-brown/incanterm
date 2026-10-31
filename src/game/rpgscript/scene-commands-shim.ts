import { commands } from './scene-commands.js';
import type { PortraitAssets } from '../portrait-assets.js';
import type { ScriptLibrary, ScriptRunner } from './runtime.js';
import { parseRpgScript, ScriptRunner as Runner } from './runtime.js';

// Preserve the normal command catalog and validation in the scene-free runner.
export const sceneCommandsShim = {
  ...commands,
};

export type ShimIO = {
  writeLine: (text: string) => void;
  writeLog?: (text: string) => void;
  promptChoice: (options: readonly string[]) => Promise<number>;
  portraits?: PortraitAssets;
};

function printPortrait(io: ShimIO, name: string | undefined): void {
  const frame = name ? io.portraits?.get(name)?.frames[0] : undefined;
  if (!frame?.cells) return;
  for (let y = 0; y < frame.height; y++) {
    io.writeLine(
      frame.cells
        .slice(y * frame.width, (y + 1) * frame.width)
        .map((cell) => cell.ch)
        .join(''),
    );
  }
  io.writeLine('');
}

export async function runSceneCommandsShim(runner: ScriptRunner, io: ShimIO): Promise<void> {
  while (!runner.isIdle()) {
    if (runner.dialogue) {
      io.writeLine(`${runner.dialogue.actor}: ${runner.dialogue.text}`);
      runner.advance();
    } else if (runner.choice) {
      const index = await io.promptChoice(runner.choice.options);
      runner.choose(index);
    } else {
      throw new Error('RPGScript paused without dialogue or choices');
    }
  }
}

export async function runRpgScriptSnippet(
  library: ScriptLibrary,
  snippet: string,
  io: ShimIO,
): Promise<ScriptRunner> {
  const source = snippet.trim();
  if (!source) throw new Error('Expected an RPGScript snippet');
  const entry = '__terminal_snippet__';
  if (library.has(entry)) throw new Error(`RPGScript ${entry} is reserved for terminal snippets`);
  const call = /^([\w-]+)\(\s*\)$/.exec(source);
  const body = call
    ? `+callScript(${call[1]})`
    : source
        .split(/\r?\n/)
        .map((line) => (/^[\w-]+\(/.test(line.trim()) ? `+${line.trim()}` : line))
        .join('\n');
  const inline = parseRpgScript(`@${entry}\n${body}`, '<terminal>', { shim: true });
  const scripts = Object.assign(new Map([...library, ...inline]), { triggers: library.triggers });
  const runner = new Runner(scripts, io.writeLog ?? io.writeLine, (name) =>
    printPortrait(io, name),
  );
  runner.start(entry);
  await runSceneCommandsShim(runner, io);
  return runner;
}
