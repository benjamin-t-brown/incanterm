import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build as buildJavaScript } from 'esbuild';
import { build as buildBrowser } from 'vite';
import { loadProject, PROJECT_FILE } from '../project/project.js';
import { loadGame } from '../server/load-game.js';
import { getDockerfile, getDockerignore, getReleaseReadme } from './deployment.js';
import { createRuntimePackage } from './runtime-package.js';
import type { ExportOptions } from './export-options.js';

const ENGINE_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const RUNTIME_FOLDERS = {
  scenes: 'incanterm-scene',
  sprites: 'incanterm-sprite',
  animations: 'incanterm-animation',
  characters: 'incanterm-character',
  props: 'incanterm-prop',
  items: 'incanterm-item',
  scripts: null,
  audio: null,
};

function isPathInside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return (
    relative === '' ||
    (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
  );
}

async function resolveOutputPath(location: string): Promise<string> {
  const absolute = path.resolve(location);
  let parent = path.dirname(absolute);
  for (;;) {
    try {
      const canonical = await fs.realpath(parent);
      return path.resolve(canonical, path.relative(parent, absolute));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      const next = path.dirname(parent);
      if (next === parent) throw error;
      parent = next;
    }
  }
}

async function writeJson(file: string, value: unknown): Promise<void> {
  await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
}

async function copyRuntimeFile(
  source: string,
  target: string,
  format: string | null,
): Promise<void> {
  const stat = await fs.lstat(source);
  if (!stat.isFile() || stat.isSymbolicLink())
    throw new Error(`Runtime assets must be regular files, not links: ${source}`);
  const contents = await fs.readFile(source);
  if (format) {
    const document: unknown = JSON.parse(contents.toString('utf8'));
    if (
      !document ||
      typeof document !== 'object' ||
      !('format' in document) ||
      document.format !== format
    )
      throw new Error(`Expected ${format} in runtime asset ${source}`);
  }
  await fs.writeFile(target, contents, { flag: 'wx', mode: 0o644 });
}

async function copyRuntimeFolder(
  source: string,
  target: string,
  folder: string,
  format: string | null,
): Promise<void> {
  let entries: import('node:fs').Dirent[];
  try {
    entries = await fs.readdir(source, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const from = path.join(source, entry.name);
    const to = path.join(target, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Runtime asset links cannot be exported: ${from}`);
    if (entry.isDirectory()) {
      await fs.mkdir(to);
      await copyRuntimeFolder(from, to, folder, format);
    } else {
      const extension = path.extname(entry.name).toLowerCase();
      const allowed = format
        ? extension === '.json'
        : folder === 'scripts'
          ? extension === '.rpgscript'
          : ['.wav', '.ogg', '.mp3'].includes(extension);
      if (allowed) await copyRuntimeFile(from, to, format);
    }
  }
}

async function copyRuntimeAssets(source: string, target: string): Promise<void> {
  await fs.mkdir(target);
  for (const [folder, format] of Object.entries(RUNTIME_FOLDERS)) {
    const from = path.join(source, folder);
    try {
      const stat = await fs.lstat(from);
      if (!stat.isDirectory() || stat.isSymbolicLink())
        throw new Error(`Runtime asset folders cannot be links: ${from}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    const to = path.join(target, folder);
    await fs.mkdir(to);
    await copyRuntimeFolder(from, to, folder, format);
  }
  for (const [file, format] of [
    ['palette.json', 'incanterm-palette'],
    ['session-config.json', null],
  ] as const) {
    const from = path.join(source, file);
    try {
      await fs.lstat(from);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw error;
    }
    await copyRuntimeFile(from, path.join(target, file), format);
  }
}

export async function exportGame(
  options: ExportOptions,
): Promise<{ outputPath: string; entryScene: string }> {
  const project = await loadProject(options.projectPath);
  const outputPath = await resolveOutputPath(options.outputPath);
  const protectedRoots = [
    project.root,
    ...['src', 'scripts', 'node_modules', '.git', 'dist'].map((folder) =>
      path.join(ENGINE_ROOT, folder),
    ),
  ];
  if (protectedRoots.some((root) => isPathInside(root, outputPath)))
    throw new Error(
      'Export output must be outside the source project and engine source directories',
    );
  try {
    await fs.lstat(outputPath);
    throw new Error(`Export output already exists: ${outputPath}. Choose a new directory.`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const game = await loadGame({ project, sceneId: options.sceneReference });
  const enginePackage: unknown = JSON.parse(
    await fs.readFile(path.join(ENGINE_ROOT, 'package.json'), 'utf8'),
  );
  const engineLock: unknown = JSON.parse(
    await fs.readFile(path.join(ENGINE_ROOT, 'package-lock.json'), 'utf8'),
  );
  const runtime = createRuntimePackage(enginePackage, engineLock);
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  // Atomically claim a new directory. Never empty or reuse an existing output.
  await fs.mkdir(outputPath);
  try {
    const gameRoot = path.join(outputPath, 'game');
    await fs.mkdir(gameRoot);
    await copyRuntimeAssets(project.assetsRoot, path.join(gameRoot, 'assets'));
    await writeJson(path.join(gameRoot, PROJECT_FILE), {
      ...project.manifest,
      assets: 'assets',
      entryScene: game.scene.id,
    });
    // Validate the exported snapshot too, so copied scripts and entry assets agree.
    await loadGame({ project: await loadProject(gameRoot) });
    await writeJson(path.join(outputPath, 'package.json'), runtime.pkg);
    await writeJson(path.join(outputPath, 'package-lock.json'), runtime.lock);
    await buildJavaScript({
      entryPoints: [path.join(ENGINE_ROOT, 'src/server/index.ts')],
      outfile: path.join(outputPath, 'dist/server.js'),
      bundle: true,
      platform: 'node',
      format: 'esm',
      target: 'node22',
      packages: 'external',
      sourcemap: false,
    });
    await buildBrowser({
      configFile: false,
      root: path.join(ENGINE_ROOT, 'src/browser'),
      base: '/',
      logLevel: 'warn',
      build: {
        outDir: path.join(outputPath, 'dist/browser'),
        emptyOutDir: false,
        sourcemap: false,
      },
    });
    await fs.writeFile(path.join(outputPath, 'Dockerfile'), getDockerfile(), { flag: 'wx' });
    await fs.writeFile(path.join(outputPath, '.dockerignore'), getDockerignore(), { flag: 'wx' });
    await fs.writeFile(
      path.join(outputPath, 'README.md'),
      getReleaseReadme(project.manifest.name),
      { flag: 'wx' },
    );
    await writeJson(path.join(outputPath, 'release.json'), {
      format: 'incanterm-release',
      version: 1,
      engineVersion: runtime.pkg.version,
      projectId: project.manifest.id,
      projectName: project.manifest.name,
      entryScene: game.scene.id,
    });
    return { outputPath, entryScene: game.scene.id };
  } catch (error) {
    // This directory was exclusively created above; source and previous releases are never removed.
    await fs.rm(outputPath, { recursive: true, force: true });
    throw error;
  }
}
