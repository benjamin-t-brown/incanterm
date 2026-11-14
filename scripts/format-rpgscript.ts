import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { formatRpgScript } from '../src/game/rpgscript/format.js';
import { loadProjectFromArguments, parseProjectArguments } from '../src/project/cli.js';

const options = parseProjectArguments(process.argv.slice(2));
const write = options.remaining.includes('--write');
if (options.remaining.some((arg) => arg !== '--write' && arg !== '--check')) {
  console.error('Usage: tsx scripts/format-rpgscript.ts --project path [--check | --write]');
  process.exitCode = 2;
} else {
  const project = await loadProjectFromArguments(options);
  const assetsRoot = project?.assetsRoot ?? options.assetsRoot;
  if (!assetsRoot)
    throw new Error('Select a project with --project path (or provide --assets path)');
  const root = path.resolve(assetsRoot, 'scripts');
  let changed = 0;

  async function visit(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(file);
      } else if (entry.isFile() && entry.name.endsWith('.rpgscript')) {
        const source = await readFile(file, 'utf8');
        const formatted = formatRpgScript(source);
        if (source === formatted) continue;

        changed++;
        console.log(path.relative(process.cwd(), file));
        if (write) await writeFile(file, formatted);
      }
    }
  }

  await visit(root);
  if (changed) {
    console.log(`${write ? 'Formatted' : 'Needs formatting:'} ${changed} RPGScript file(s).`);
    if (!write) process.exitCode = 1;
  } else {
    console.log('RPGScript files are formatted.');
  }
}
