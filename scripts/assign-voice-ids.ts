import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { loadProject } from '../src/project/project.js';
import { assignMissingVoiceIds } from '../src/game/rpgscript/voice-ids.js';

async function assignProjectVoiceIds(location: string) {
  const project = await loadProject(location);
  const directory = path.join(project.assetsRoot, 'scripts');
  if (!(await fs.lstat(directory)).isDirectory()) throw new Error('Expected a scripts directory');
  const changes = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    if (!entry.name.endsWith('.rpgscript')) continue;
    if (!entry.isFile()) throw new Error(`Expected a regular script: ${entry.name}`);
    const file = path.join(directory, entry.name);
    const before = await fs.readFile(file, 'utf8');
    const after = assignMissingVoiceIds(before, entry.name);
    if (before !== after) changes.push({ file, before, after });
  }
  for (const { file, before, after } of changes) {
    const temp = `${file}.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(temp, after, { flag: 'wx', mode: (await fs.stat(file)).mode });
      if (await fs.readFile(file, 'utf8') !== before) throw new Error(`Script changed; retry: ${file}`);
      await fs.rename(temp, file);
      console.log(`Assigned missing voice IDs in ${file}`);
    } finally {
      await fs.rm(temp, { force: true });
    }
  }
  if (!changes.length) console.log('No missing voice IDs.');
}

if (process.argv.length !== 3) throw new Error('Usage: npm run voice:ids -- path/to/incanterm.json');
await assignProjectVoiceIds(process.argv[2]);
