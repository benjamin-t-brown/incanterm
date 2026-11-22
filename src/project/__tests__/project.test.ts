import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createProject, getProjectSource, loadProject, parseProjectManifest } from '../project.js';
import { loadProjectFromArguments, parseProjectArguments } from '../cli.js';
import { loadGame } from '../../server/load-game.js';

let directory: string;
beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'incanterm-project-'));
});
afterEach(async () => {
  await fs.rm(directory, { recursive: true, force: true });
});

describe('project files', () => {
  it('creates a blank, playable project and loads it by folder or manifest path', async () => {
    const project = await createProject(path.join(directory, 'game'), 'Test Game');
    expect(project.manifest).toMatchObject({
      format: 'incanterm-project',
      version: 1,
      name: 'Test Game',
      assets: 'assets',
      entryScene: 'start',
    });
    expect(await loadProject(project.manifestPath)).toEqual(project);
    expect(await loadProject(path.relative(process.cwd(), project.root))).toEqual(project);
    const game = await loadGame({ project });
    expect(game.scene.id).toBe('start');
    expect(game.scene.entities).toEqual([]);
  });

  it('does not overwrite an existing folder, even if it is empty', async () => {
    const root = path.join(directory, 'existing');
    await fs.mkdir(root);
    await expect(createProject(root, 'Existing')).rejects.toThrow();
    expect(await fs.readdir(root)).toEqual([]);
  });

  it.each(['roomAlias', 'Room With Spaces'])(
    'starts a scene by ID or label "%s"',
    async (label) => {
      const project = await createProject(path.join(directory, 'labelled'), 'Labelled');
      const scene = JSON.parse(
        await fs.readFile(path.join(project.assetsRoot, 'scenes', 'start.json'), 'utf8'),
      );
      await fs.writeFile(
        path.join(project.assetsRoot, 'scenes', 'other-room.json'),
        JSON.stringify({ ...scene, id: 'other-room', label }),
      );
      expect((await loadGame({ project, sceneId: 'other-room' })).scene.id).toBe('other-room');
      expect((await loadGame({ project, sceneId: label })).scene.id).toBe('other-room');
      expect((await loadGame({ project })).scene.id).toBe('start');
    },
  );

  it('rejects ambiguous and missing startup scene labels instead of guessing', async () => {
    const project = await createProject(path.join(directory, 'ambiguous'), 'Ambiguous');
    const scene = JSON.parse(
      await fs.readFile(path.join(project.assetsRoot, 'scenes', 'start.json'), 'utf8'),
    );
    for (const id of ['first', 'second']) {
      await fs.writeFile(
        path.join(project.assetsRoot, 'scenes', `${id}.json`),
        JSON.stringify({ ...scene, id, label: 'Duplicate Room' }),
      );
    }
    await expect(loadGame({ project, sceneId: 'Duplicate Room' })).rejects.toThrow('ambiguous');
    await expect(loadGame({ project, sceneId: 'Missing Room' })).rejects.toThrow(
      'not found by ID or label',
    );
  });

  it('reads runtime settings for all project launch modes', async () => {
    const project = await createProject(path.join(directory, 'configured'), 'Configured');
    await fs.writeFile(
      path.join(project.assetsRoot, 'session-config.json'),
      JSON.stringify({
        dialogueAnimation: { enabled: false },
        portraitAnimation: { enabled: false },
      }),
    );
    expect(await loadGame({ project })).toMatchObject({
      dialogueAnimation: { enabled: false },
      portraitAnimation: { enabled: false },
    });
    expect(
      (await loadGame({ project, dialogueAnimation: { enabled: true } })).dialogueAnimation,
    ).toEqual({ enabled: true });
  });

  it.each([
    { scriptHooks: [], error: 'scriptHooks must be an object' },
    { scriptHooks: { propBlocked: 'report' }, error: 'Unknown scriptHooks setting propBlocked' },
    { scriptHooks: { propUnreachable: ' ' }, error: 'propUnreachable must be an RPGScript function name' },
    { scriptHooks: { propUnreachable: 'missing' }, error: 'must reference a one-argument RPGScript function: missing' },
    { scriptHooks: { propUnreachable: 'noArguments' }, error: 'must reference a one-argument RPGScript function: noArguments' },
  ])('rejects invalid script hooks: $error', async ({ scriptHooks, error }) => {
    const project = await createProject(path.join(directory, 'configured'), 'Configured');
    await fs.writeFile(path.join(project.assetsRoot, 'session-config.json'), JSON.stringify({ scriptHooks }));
    await fs.writeFile(path.join(project.assetsRoot, 'scripts', 'hooks.rpgscript'), '@noArguments\n<\n');
    await expect(loadGame({ project })).rejects.toThrow(error);
  });

  it('rejects a missing entry scene before starting a runtime', async () => {
    const project = await createProject(path.join(directory, 'missing'), 'Missing');
    await fs.unlink(path.join(project.assetsRoot, 'scenes', 'start.json'));
    await expect(loadProject(project.root)).rejects.toThrow();
  });

  it('rejects an asset directory symlink that escapes the project', async () => {
    const project = await createProject(path.join(directory, 'linked'), 'Linked');
    const outside = path.join(directory, 'outside');
    await fs.mkdir(outside);
    await fs.rm(project.assetsRoot, { recursive: true, force: true });
    await fs.symlink(outside, project.assetsRoot, 'junction');
    await expect(loadProject(project.root)).rejects.toThrow('inside the project');
  });

  it.each([
    { format: 'other' },
    { version: 2 },
    { id: '../bad' },
    { entryScene: '../bad' },
    { entryScene: 'START' },
    { name: '' },
    { name: 'bad\nname' },
    { assets: '../assets' },
    { assets: '/outside' },
    { assets: 'C:/outside' },
    { assets: 'nested/../assets' },
    { assets: 'nested\\assets' },
    { unknown: true },
  ])('rejects invalid manifest fields: %j', async (change) => {
    const project = await createProject(path.join(directory, 'invalid'), 'Valid');
    expect(() => parseProjectManifest({ ...project.manifest, ...change })).toThrow();
  });

  it('requires explicit game content instead of repository defaults', async () => {
    expect(() => getProjectSource({})).toThrow('Open a project');
    expect(() => getProjectSource({ assetsRoot: directory })).toThrow('sceneId');
    const project = await createProject(path.join(directory, 'selected'), 'Selected');
    expect(getProjectSource({ project })).toEqual({
      assetsRoot: project.assetsRoot,
      sceneId: 'start',
    });
    expect(getProjectSource({ project, sceneId: 'other' }).sceneId).toBe('other');
    expect(() => getProjectSource({ project, assetsRoot: directory })).toThrow('not both');
  });
});

describe('project command lines', () => {
  it('parses project selection, scene overrides, and remaining script arguments', () => {
    expect(
      parseProjectArguments(['--project', 'some folder', '--scene', 'other', '+log("Hello")']),
    ).toEqual({ projectPath: 'some folder', sceneId: 'other', remaining: ['+log("Hello")'] });
    expect(parseProjectArguments(['--assets', 'fixtures', '--plain'])).toEqual({
      assetsRoot: 'fixtures',
      remaining: ['--plain'],
    });
  });

  it.each([
    ['--project'],
    ['--assets'],
    ['--scene', '--plain'],
    ['--project', 'a', '--assets', 'b'],
  ])('rejects invalid selection arguments %j', (...args) => {
    expect(() => parseProjectArguments(args)).toThrow();
  });

  it('supports explicit selection and an environment selection without a built-in game', async () => {
    const project = await createProject(path.join(directory, 'external'), 'External');
    expect(await loadProjectFromArguments(parseProjectArguments([]), {})).toBeUndefined();
    expect(
      await loadProjectFromArguments(parseProjectArguments([]), {
        INCANTERM_PROJECT: project.root,
      }),
    ).toEqual(project);
    expect(
      await loadProjectFromArguments(parseProjectArguments(['--project', project.root]), {
        INCANTERM_PROJECT: 'missing',
      }),
    ).toEqual(project);
    expect(
      await loadProjectFromArguments(parseProjectArguments(['--assets', directory]), {
        INCANTERM_PROJECT: 'missing',
      }),
    ).toBeUndefined();
  });
});
