import path from 'node:path';
import readline from 'node:readline';
import { styleText } from 'node:util';
import { loadPortraitAssets } from './portrait-assets.js';
import { loadRpgScripts } from './rpgscript/runtime.js';
import { runRpgScriptSnippet, sceneCommandsShim, type ShimIO } from './scene-commands-shim.js';
import { parseProjectArguments, loadProjectFromArguments } from '../project/cli.js';

async function runMain(args: string[]): Promise<void> {
  const options = parseProjectArguments(args);
  const project = await loadProjectFromArguments(options);
  const assetsRoot =
    project?.assetsRoot ?? (options.assetsRoot ? path.resolve(options.assetsRoot) : undefined);
  args = options.remaining;
  if (!assetsRoot)
    throw new Error('Select a project with --project path (or provide --assets path)');
  if (!args.length)
    throw new Error('Usage: npm run run-rpgscript -- --project path "scriptName()"');

  const library = await loadRpgScripts(assetsRoot, { commands: sceneCommandsShim });
  const portraits = await loadPortraitAssets(assetsRoot);
  const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  const lines = input[Symbol.asyncIterator]();
  const io: ShimIO = {
    portraits,
    writeLine(text) {
      process.stdout.write(`${text}\n`);
    },
    writeLog(text) {
      process.stdout.write(`${styleText('gray', text)}\n`);
    },
    async promptChoice(options) {
      options.forEach((option, index) => {
        io.writeLine(`${index + 1}. ${option}`);
      });
      for (;;) {
        process.stdout.write(`Choose (1-${options.length}): `);
        const answer = await lines.next();
        if (answer.done) throw new Error('Input ended before a choice was selected');
        if (!process.stdin.isTTY) process.stdout.write('\n');
        const index = Number(answer.value.trim()) - 1;
        if (/^[1-9]$/.test(answer.value.trim()) && index >= 0 && index < options.length) {
          return index;
        }
        io.writeLine('Invalid choice; enter a number from the list.');
      }
    },
  };
  try {
    await runRpgScriptSnippet(library, args.join(' '), io);
  } finally {
    input.close();
  }
}

runMain(process.argv.slice(2)).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
