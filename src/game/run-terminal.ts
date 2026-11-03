import path from 'node:path';
import readline from 'node:readline';
import { styleText } from 'node:util';
import { loadPortraitAssets } from './portrait-assets.js';
import { loadRpgScripts } from './rpgscript/runtime.js';
import { runRpgScriptSnippet, sceneCommandsShim, type ShimIO } from './scene-commands-shim.js';

async function runMain(args: string[]): Promise<void> {
  let assetsRoot = path.join(process.cwd(), 'assets');
  if (args[0] === '--assets') {
    if (!args[1]) throw new Error('Missing path after --assets');
    assetsRoot = path.resolve(args[1]);
    args = args.slice(2);
  }
  if (!args.length)
    throw new Error('Usage: npm run run-rpgscript -- [--assets path] "testDialogue()"');

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
