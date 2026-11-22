import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, type ChildProcess } from 'node:child_process';
import { WebSocket } from 'ws';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createProject, loadProject, type LoadedProject } from '../../project/project.js';
import { createAnimation, createCharacter, createProp, createSprite } from '../../editor/schema.js';
import { encodeStoredSprite } from '../../editor/art/sprite-storage.js';
import { getDefaultPalette } from '../../editor/palette.js';
import { exportGame } from '../export-game.js';
import { createItem } from '../../editor/items/item-schema.js';

const ENGINE_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
let directory: string;
let project: LoadedProject;
let outputPath: string;
let spriteContents: string;

beforeAll(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'incanterm-export-'));
  project = await createProject(path.join(directory, 'source'), 'Export Test Game');
  await fs.rename(project.assetsRoot, path.join(project.root, 'content'));
  await fs.writeFile(
    project.manifestPath,
    JSON.stringify({ ...project.manifest, assets: 'content' }),
  );
  project = await loadProject(project.root);
  const sprite = createSprite('body', 1, 1);
  sprite.sprites[0].layers[0].cells[0] = { ch: 'X', fg: 'white', bg: 'black' };
  spriteContents = encodeStoredSprite(sprite);
  await fs.writeFile(path.join(project.assetsRoot, 'sprites', 'body.json'), spriteContents);
  const animation = createAnimation('idle');
  animation.frames = [{ sprite: 'body', index: 0, durationMs: 100 }];
  await fs.writeFile(
    path.join(project.assetsRoot, 'animations', 'idle.json'),
    JSON.stringify(animation),
  );
  await fs.writeFile(
    path.join(project.assetsRoot, 'characters', 'actor.json'),
    JSON.stringify(createCharacter('actor', 'idle')),
  );
  await fs.writeFile(
    path.join(project.assetsRoot, 'props', 'box.json'),
    JSON.stringify(createProp('box', { type: 'sprite', id: 'body', index: 0 })),
  );
  await fs.writeFile(
    path.join(project.assetsRoot, 'sprites', 'key-art.json'),
    encodeStoredSprite(createSprite('key-art', 4, 3)),
  );
  await fs.writeFile(
    path.join(project.assetsRoot, 'items', 'key.json'),
    JSON.stringify(createItem('key', { type: 'sprite', id: 'key-art', index: 0 })),
  );
  const scene = JSON.parse(
    await fs.readFile(path.join(project.assetsRoot, 'scenes', 'start.json'), 'utf8'),
  );
  await fs.writeFile(
    path.join(project.assetsRoot, 'scenes', 'play-room.json'),
    JSON.stringify({
      ...scene,
      id: 'play-room',
      label: 'Play Room',
      triggers: ['entry'],
      entities: [{ id: 'box', type: 'Prop', prop: 'box', x: 10, y: 10, z: 0 }],
    }),
  );
  await fs.writeFile(
    path.join(project.assetsRoot, 'scripts', 'entry.rpgscript'),
    '#entry\nload,greeting\n@greeting\nGuide: "Release hello"\nGuide: "Next line"',
  );
  await fs.writeFile(
    path.join(project.assetsRoot, 'session-config.json'),
    '{"dialogueAnimation":{"enabled":false},"portraitAnimation":{"enabled":false}}',
  );
  await fs.writeFile(
    path.join(project.assetsRoot, 'palette.json'),
    JSON.stringify(getDefaultPalette()),
  );
  await fs.writeFile(
    path.join(project.assetsRoot, 'audio', 'cue.wav'),
    Buffer.from('RIFF-fixture'),
  );
  await fs.mkdir(path.join(project.root, 'story'));
  await fs.writeFile(path.join(project.root, 'story', 'notes.txt'), 'Private author notes');
  await fs.writeFile(path.join(project.root, '.env'), 'TEST_ONLY_SECRET=do-not-export');
  await fs.writeFile(path.join(project.assetsRoot, '.env'), 'TEST_ONLY_SECRET=do-not-export');
  await fs.writeFile(path.join(project.assetsRoot, 'scene-folders.json'), '{"editor":"metadata"}');
  await fs.writeFile(
    path.join(project.assetsRoot, 'references', 'reference.png'),
    'Editor-only image',
  );
  outputPath = path.join(directory, 'release');
  await exportGame({ projectPath: project.root, outputPath, sceneReference: 'Play Room' });
}, 30_000);

afterAll(async () => {
  if (directory) await fs.rm(directory, { recursive: true, force: true });
});

it('exports compiled runtime, deployment files, and production dependency metadata only', async () => {
  expect((await fs.readdir(outputPath)).sort()).toEqual([
    '.dockerignore',
    'Dockerfile',
    'README.md',
    'dist',
    'game',
    'package-lock.json',
    'package.json',
    'release.json',
  ]);
  expect((await fs.readdir(path.join(outputPath, 'dist'))).sort()).toEqual([
    'browser',
    'server.js',
  ]);
  expect(await fs.readFile(path.join(outputPath, 'dist/browser/index.html'), 'utf8')).toContain(
    'assets/',
  );
  const pkg = JSON.parse(await fs.readFile(path.join(outputPath, 'package.json'), 'utf8'));
  const lock = JSON.parse(await fs.readFile(path.join(outputPath, 'package-lock.json'), 'utf8'));
  expect(pkg).not.toHaveProperty('devDependencies');
  expect(pkg.scripts.start).toContain('--no-ssh');
  expect(lock.packages[''].dependencies).toEqual(pkg.dependencies);
  expect(
    Object.values(lock.packages).some((entry) => (entry as { dev?: boolean }).dev === true),
  ).toBe(false);
  const dockerfile = await fs.readFile(path.join(outputPath, 'Dockerfile'), 'utf8');
  expect(dockerfile).toContain('USER node');
  expect(dockerfile).toContain('HEALTHCHECK');
  expect(dockerfile).toContain('EXPOSE 7101');
  expect(dockerfile).not.toContain('EXPOSE 7102');
  expect(dockerfile).toContain('"--no-ssh"');
});

it('keeps asset bytes and IDs, resolves the selected scene label, and never modifies the source project', async () => {
  const exported = await loadProject(path.join(outputPath, 'game'));
  expect(exported.manifest).toMatchObject({
    id: project.manifest.id,
    assets: 'assets',
    entryScene: 'play-room',
  });
  expect(await fs.readFile(path.join(exported.assetsRoot, 'sprites', 'body.json'), 'utf8')).toBe(
    spriteContents,
  );
  expect(await fs.readFile(path.join(exported.assetsRoot, 'audio', 'cue.wav'), 'utf8')).toBe(
    'RIFF-fixture',
  );
  expect(JSON.parse(await fs.readFile(path.join(exported.assetsRoot, 'items', 'key.json'), 'utf8')))
    .toEqual(createItem('key', { type: 'sprite', id: 'key-art', index: 0 }));
  expect(await fs.readdir(exported.assetsRoot)).not.toContain('references');
  expect(await fs.readdir(exported.assetsRoot)).not.toContain('scene-folders.json');
  expect(await fs.readdir(exported.assetsRoot)).not.toContain('.env');
  const original = await loadProject(project.root);
  expect(original.manifest.assets).toBe('content');
  expect(original.manifest.entryScene).toBe('start');
});

it('refuses to overwrite an existing release or write inside the source project or engine source', async () => {
  const manifest = await fs.readFile(path.join(outputPath, 'game/incanterm.json'), 'utf8');
  await expect(exportGame({ projectPath: project.root, outputPath })).rejects.toThrow(
    'already exists',
  );
  await expect(
    exportGame({ projectPath: project.root, outputPath: path.join(project.root, 'release') }),
  ).rejects.toThrow('outside the source');
  await expect(
    exportGame({
      projectPath: project.root,
      outputPath: path.join(ENGINE_ROOT, 'src', 'unsafe-release'),
    }),
  ).rejects.toThrow('outside the source');
  expect(await fs.readFile(path.join(outputPath, 'game/incanterm.json'), 'utf8')).toBe(manifest);
});

it('cleans up only its own incomplete output when an invalid runtime asset is encountered', async () => {
  const invalid = await createProject(path.join(directory, 'invalid'), 'Invalid');
  await fs.writeFile(
    path.join(invalid.assetsRoot, 'props', 'bad.json'),
    '{"not":"a runtime prop"}',
  );
  const failed = path.join(directory, 'failed-release');
  await expect(exportGame({ projectPath: invalid.root, outputPath: failed })).rejects.toThrow(
    'incanterm-prop',
  );
  await expect(fs.access(failed)).rejects.toThrow();
  expect(await fs.readFile(path.join(invalid.assetsRoot, 'props', 'bad.json'), 'utf8')).toBe(
    '{"not":"a runtime prop"}',
  );
});

it('rejects nested asset links rather than copying files from outside the project', async () => {
  const linked = await createProject(path.join(directory, 'linked'), 'Linked');
  const outside = path.join(directory, 'outside');
  await fs.mkdir(outside);
  await fs.writeFile(path.join(outside, 'private.wav'), 'do-not-copy');
  await fs.symlink(outside, path.join(linked.assetsRoot, 'audio', 'linked'), 'junction');
  const failed = path.join(directory, 'linked-release');
  await expect(exportGame({ projectPath: linked.root, outputPath: failed })).rejects.toThrow(
    'links',
  );
  await expect(fs.access(failed)).rejects.toThrow();
  expect(await fs.readFile(path.join(outside, 'private.wav'), 'utf8')).toBe('do-not-copy');
});

function getStartedPort(child: ChildProcess): Promise<number> {
  return new Promise((resolve, reject) => {
    let output = '';
    let errors = '';
    const timer = setTimeout(() => reject(new Error(`Release startup timed out: ${errors}`)), 5000);
    child.stderr?.on('data', (data) => {
      errors += String(data);
    });
    child.stdout?.on('data', (data) => {
      output += String(data);
      const match = output.match(/HTTP\/WebSocket\s+http:\/\/127\.0\.0\.1:(\d+)/);
      if (match) {
        clearTimeout(timer);
        resolve(Number(match[1]));
      }
    });
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('exit', () => {
      clearTimeout(timer);
      reject(new Error(`Release exited: ${errors}`));
    });
  });
}

it('runs the built release from an unrelated working directory and exposes play, health and WebSocket endpoints only', async () => {
  const modules = path.join(outputPath, 'node_modules');
  await fs.symlink(path.join(ENGINE_ROOT, 'node_modules'), modules, 'junction');
  const cwd = path.join(directory, 'working-directory');
  await fs.mkdir(cwd);
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    PORT: '0',
    INCANTERM_HOST: '127.0.0.1',
    INCANTERM_SSH_PORT: 'unused-with-ssh-disabled',
  };
  delete environment.INCANTERM_HTTP_PORT;
  const child = spawn(
    process.execPath,
    [
      path.join(outputPath, 'dist/server.js'),
      '--project',
      path.join(outputPath, 'game'),
      '--no-ssh',
    ],
    { cwd, env: environment, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  const exited = new Promise((resolve) => child.once('exit', resolve));
  let socket: WebSocket | undefined;
  try {
    const port = await getStartedPort(child);
    const base = `http://127.0.0.1:${port}`;
    expect(await (await fetch(`${base}/health`)).json()).toEqual({ ok: true });
    const html = await (await fetch(`${base}/play`)).text();
    expect(html).toContain('<!doctype html>');
    const script = /src="([^"]+\.js)"/.exec(html)?.[1];
    if (!script) throw new Error('Exported browser entry script is missing');
    expect((await fetch(new URL(script, base))).status).toBe(200);
    expect((await fetch(`${base}/api/projects`)).status).toBe(404);
    expect((await fetch(`${base}/game/incanterm.json`)).status).toBe(404);
    socket = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const frame = await new Promise<string>((resolve, reject) => {
      socket?.on('message', (data) => {
        const message = JSON.parse(String(data));
        if (message.type === 'terminal-data') resolve(message.data);
      });
      socket?.once('error', reject);
    });
    expect(frame).toContain('Release hello');
    await expect(fs.access(path.join(cwd, '.data'))).rejects.toThrow();
  } finally {
    socket?.terminate();
    child.kill();
    await exited;
    await fs.rm(modules, { recursive: true, force: true });
  }
}, 15_000);
