import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { getProjectSource } from '../src/project/project.js';
import { loadProjectFromArguments, parseProjectArguments } from '../src/project/cli.js';

const options = parseProjectArguments(process.argv.slice(2));
if (options.remaining.length) throw new Error(`Unknown arguments: ${options.remaining.join(' ')}`);
const project = await loadProjectFromArguments(options);
const source = getProjectSource({
  project,
  assetsRoot: options.assetsRoot,
  sceneId: options.sceneId,
});
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const serverSelection = project
  ? ['--project', project.manifestPath, ...(options.sceneId ? ['--scene', options.sceneId] : [])]
  : ['--assets', source.assetsRoot, '--scene', source.sceneId];
const children: ChildProcess[] = [];
let stopping = false;

function stopChildren(code = 0): void {
  if (stopping) return;
  stopping = true;
  process.exitCode = code;
  for (const child of children) child.kill();
}

for (const args of [
  [
    '--watch',
    '--watch-preserve-output',
    '--import',
    'tsx',
    'src/server/index.ts',
    ...serverSelection,
  ],
  ['node_modules/vite/bin/vite.js'],
]) {
  const child = spawn(process.execPath, args, { cwd: root, stdio: 'inherit' });
  children.push(child);
  child.on('error', (error) => {
    console.error(error);
    stopChildren(1);
  });
  child.on('exit', (code) => {
    if (!stopping) stopChildren(code ?? 1);
  });
}
process.once('SIGINT', () => stopChildren());
process.once('SIGTERM', () => stopChildren());
