import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createScene } from '../editor/schema.js';

export const PROJECT_FILE = 'incanterm.json';

export type ProjectManifest = {
  format: 'incanterm-project';
  version: 1;
  id: string;
  name: string;
  assets: string;
  entryScene: string;
};

export type LoadedProject = {
  manifest: ProjectManifest;
  manifestPath: string;
  root: string;
  assetsRoot: string;
};

export type ProjectSourceOptions = {
  project?: LoadedProject;
  assetsRoot?: string;
  sceneId?: string;
};

export function parseProjectManifest(value: unknown): ProjectManifest {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Expected an Incanterm project manifest');
  const record = value as Record<string, unknown>;
  if (record.format !== 'incanterm-project' || record.version !== 1)
    throw new Error('Unsupported project format or version');
  for (const key of Object.keys(record))
    if (!['format', 'version', 'id', 'name', 'assets', 'entryScene'].includes(key))
      throw new Error(`Unknown project setting ${key}`);
  for (const key of ['id', 'entryScene'] as const)
    if (typeof record[key] !== 'string' || !/^[a-z0-9_-]+$/.test(record[key]))
      throw new Error(`Project ${key} must be an asset ID`);
  if (
    typeof record.name !== 'string' ||
    !record.name.trim() ||
    record.name.length > 100 ||
    [...record.name].some((character) => {
      const code = character.charCodeAt(0);
      return code < 32 || code === 127;
    })
  )
    throw new Error('Project name must be 1 to 100 characters without control characters');
  if (
    typeof record.assets !== 'string' ||
    !record.assets ||
    path.isAbsolute(record.assets) ||
    path.win32.isAbsolute(record.assets) ||
    record.assets.includes('\\') ||
    record.assets.split('/').some((part) => !part || part === '.' || part === '..')
  )
    throw new Error('Project assets must be a relative folder inside the project');
  return record as ProjectManifest;
}

function assertProjectPath(root: string, file: string): void {
  const relative = path.relative(root, file);
  if (
    !relative ||
    relative === '..' ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  )
    throw new Error('Project assets must stay inside the project directory');
}

export async function loadProject(location: string): Promise<LoadedProject> {
  const selected = path.resolve(location);
  const manifestPath = await fs.realpath(
    (await fs.stat(selected)).isDirectory() ? path.join(selected, PROJECT_FILE) : selected,
  );
  const root = path.dirname(manifestPath);
  const manifest = parseProjectManifest(JSON.parse(await fs.readFile(manifestPath, 'utf8')));
  const assetsRoot = await fs.realpath(path.resolve(root, manifest.assets));
  assertProjectPath(root, assetsRoot);
  if (!(await fs.stat(assetsRoot)).isDirectory())
    throw new Error('Project assets must be a directory');
  const entry = path.join(assetsRoot, 'scenes', `${manifest.entryScene}.json`);
  const entryPath = await fs.realpath(entry);
  assertProjectPath(assetsRoot, entryPath);
  if (!(await fs.stat(entryPath)).isFile()) throw new Error('Project entry scene must be a file');
  return { manifest, manifestPath, root, assetsRoot };
}

export async function createProject(location: string, name: string): Promise<LoadedProject> {
  const manifest = parseProjectManifest({
    format: 'incanterm-project',
    version: 1,
    id: randomUUID(),
    name: name.trim(),
    assets: 'assets',
    entryScene: 'start',
  });
  const root = path.resolve(location);
  // Only a new directory is accepted: never overwrite or adopt an existing game's files.
  await fs.mkdir(root);
  const assetsRoot = path.join(root, manifest.assets);
  await fs.mkdir(assetsRoot);
  for (const folder of [
    'scenes',
    'scripts',
    'sprites',
    'animations',
    'characters',
    'props',
    'items',
    'audio',
    'references',
  ])
    await fs.mkdir(path.join(assetsRoot, folder));
  await fs.writeFile(
    path.join(assetsRoot, 'scenes', 'start.json'),
    `${JSON.stringify(createScene('start', 'Start'), null, 2)}\n`,
    { flag: 'wx' },
  );
  await fs.writeFile(path.join(root, PROJECT_FILE), `${JSON.stringify(manifest, null, 2)}\n`, {
    flag: 'wx',
  });
  return loadProject(root);
}

export function getProjectSource(options: ProjectSourceOptions): {
  assetsRoot: string;
  sceneId: string;
} {
  if (options.project && options.assetsRoot)
    throw new Error('Choose a project or an explicit asset root, not both');
  const assetsRoot = options.project?.assetsRoot ?? options.assetsRoot;
  const sceneId = options.sceneId ?? options.project?.manifest.entryScene;
  if (!assetsRoot || !sceneId)
    throw new Error('Open a project, or provide both assetsRoot and sceneId');
  return { assetsRoot: path.resolve(assetsRoot), sceneId };
}
