import { commands, getPlayerCharacterName, getWalkDestination } from './scene-commands.js';
import { getDialoguePortrait, type PortraitAssets } from './portrait-assets.js';
import type { ScriptLibrary, ScriptRunner } from './rpgscript/runtime.js';
import { parseRpgScript, ScriptRunner as Runner } from './rpgscript/runtime.js';
import { defineCommand } from './rpgscript/command.js';

// A terminal has no player character. Validate the command without controlling a scene.
export const sceneCommandsShim = {
  ...commands,
  chWalkToCoord: defineCommand({
    parse: commands.chWalkToCoord.parse,
    execute: (step, script) => {
      getWalkDestination(step, script);
    },
  }),
  setPlayerWalkCh: defineCommand({
    parse: commands.setPlayerWalkCh.parse,
    execute: (step, script) => {
      getPlayerCharacterName(step.idOrInstanceName, script);
    },
  }),
  endConv: defineCommand({
    parse: commands.endConv.parse,
    execute: (_step, script) => {
      script.setStorage('dialogue.active', false);
      script.setStorage('dialogue.leftActor', undefined);
      script.setStorage('dialogue.rightActor', undefined);
    },
  }),
  endConvNR: defineCommand({
    parse: commands.endConvNR.parse,
    execute: (_step, script) => {
      script.setStorage('dialogue.active', false);
      script.setStorage('dialogue.leftActor', undefined);
      script.setStorage('dialogue.rightActor', undefined);
    },
  }),
};

export type ShimIO = {
  writeLine: (text: string) => void;
  writeLog?: (text: string) => void;
  promptChoice: (options: readonly string[]) => Promise<number>;
  portraits?: PortraitAssets;
};

function printPortrait(io: ShimIO, actor: string, emotion: string | undefined): void {
  const frame = getDialoguePortrait(io.portraits, actor, emotion)?.asset.frames[0];
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

export async function runSceneCommandsShim(
  runner: ScriptRunner<ShimIO>,
  io: ShimIO,
): Promise<void> {
  while (!runner.isIdle()) {
    if (runner.dialogue) {
      if (runner.getStorage('dialogue.active') === true)
        printPortrait(io, runner.dialogue.actor, runner.dialogue.emotion);
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
): Promise<ScriptRunner<ShimIO>> {
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
  const inline = parseRpgScript(`@${entry}\n${body}`, '<terminal>', {
    commands: sceneCommandsShim,
  });
  const scripts = Object.assign(new Map([...library, ...inline]), {
    triggers: library.triggers,
  });
  const runner = new Runner(scripts, {
    commands: sceneCommandsShim,
    context: io,
    writeLog: io.writeLog ?? io.writeLine,
  });
  runner.start(entry);
  await runSceneCommandsShim(runner, io);
  return runner;
}
