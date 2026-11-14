import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { WebSocket } from 'ws';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { ProjectRegistry, dispatchProjectRequest } from '../projects.js';
import { createProject } from '../../project/project.js';
import { parseServerMessage } from '../../protocol/messages.js';

let directory: string;
let registry: ProjectRegistry;
const sockets: WebSocket[] = [];
beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'incanterm-project-api-'));
  registry = new ProjectRegistry(directory);
});
afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.terminate();
  await registry.close();
  await fs.rm(directory, { recursive: true, force: true });
});

it('opens external project folders and lists workspace projects without selecting a global current game', async () => {
  const external = await createProject(path.join(directory, 'external'), 'External');
  await fs.mkdir(path.join(directory, 'projects'));
  await createProject(path.join(directory, 'projects', 'local'), 'Local');
  const response = await dispatchProjectRequest(
    registry,
    'POST',
    '/api/projects/open',
    JSON.stringify({ path: external.root }),
  );
  expect(response.status).toBe(200);
  const list = await registry.listProjects();
  expect(list.map((project) => project.name)).toEqual(['External', 'Local']);
  expect((await dispatchProjectRequest(registry, 'GET', '/api/scenes', '')).status).toBe(409);
});

it('creates a new project without replacing files in an existing directory', async () => {
  const body = JSON.stringify({ path: 'new-project', name: 'New Project' });
  expect(
    (await dispatchProjectRequest(registry, 'POST', '/api/projects/create', body)).status,
  ).toBe(200);
  expect(
    (await dispatchProjectRequest(registry, 'POST', '/api/projects/create', body)).status,
  ).toBe(422);
  expect(
    (await dispatchProjectRequest(registry, 'POST', '/api/projects/open', 'null')).status,
  ).toBe(400);
  expect((await dispatchProjectRequest(registry, 'POST', '/api/projects/open', '{')).status).toBe(
    400,
  );
});

it('keeps reads and late saves pinned to the requested project, including cloned project IDs', async () => {
  const a = await createProject(path.join(directory, 'a'), 'A');
  const b = await createProject(path.join(directory, 'b'), 'B');
  await fs.writeFile(b.manifestPath, JSON.stringify({ ...b.manifest, id: a.manifest.id }));
  const first = await registry.openProject(a.root);
  const getOriginal = await dispatchProjectRequest(
    registry,
    'GET',
    `/api/projects/${first.key}/assets/scenes/start`,
    '',
  );
  const original = JSON.parse(String(getOriginal.body));
  const second = await registry.openProject(b.root);
  expect(first.id).toBe(second.id);
  expect(first.key).not.toBe(second.key);
  const save = await dispatchProjectRequest(
    registry,
    'PUT',
    `/api/projects/${first.key}/assets/scenes/start`,
    JSON.stringify({ doc: { ...original, width: 17 }, base: original }),
  );
  expect(save.status).toBe(200);
  expect((await registry.getProject(first.key).store.readScene('start')).width).toBe(17);
  expect((await registry.getProject(second.key).store.readScene('start')).width).toBe(120);
  expect(
    (await dispatchProjectRequest(registry, 'GET', '/api/projects/unknown/assets/scenes/start', ''))
      .status,
  ).toBe(422);
});

async function readPreviewFrame(port: number): Promise<string> {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  sockets.push(socket);
  return new Promise((resolve, reject) => {
    socket.on('message', (data) => {
      const message = parseServerMessage(String(data));
      if (message?.type === 'terminal-data') resolve(message.data);
    });
    socket.once('error', reject);
  });
}

it('runs each project preview against its own scenes and scripts', async () => {
  const keys: string[] = [];
  for (const name of ['A', 'B']) {
    const project = await createProject(path.join(directory, name), name);
    const sceneFile = path.join(project.assetsRoot, 'scenes', 'start.json');
    const scene = JSON.parse(await fs.readFile(sceneFile, 'utf8'));
    await fs.writeFile(sceneFile, JSON.stringify({ ...scene, triggers: ['entry'] }));
    await fs.writeFile(
      path.join(project.assetsRoot, 'scripts', 'entry.rpgscript'),
      `#entry\nload,start\n@start\nGuide: "Only ${name}"`,
    );
    await fs.writeFile(
      path.join(project.assetsRoot, 'session-config.json'),
      '{"dialogueAnimation":{"enabled":false},"portraitAnimation":{"enabled":false}}',
    );
    keys.push((await registry.openProject(project.root)).key);
  }
  const a = await registry.startPreview(keys[0]);
  const b = await registry.startPreview(keys[1]);
  expect(a.port).not.toBe(b.port);
  expect(await registry.startPreview(keys[0])).toBe(a);
  const first = await readPreviewFrame(a.port);
  const second = await readPreviewFrame(b.port);
  expect(first).toContain('Only A');
  expect(first).not.toContain('Only B');
  expect(second).toContain('Only B');
  const response = await dispatchProjectRequest(
    registry,
    'POST',
    `/api/projects/${keys[0]}/play`,
    '{}',
  );
  expect(response.status).toBe(200);
  expect(JSON.parse(String(response.body)).url).toBe(`/game-preview?project=${keys[0]}`);
});
