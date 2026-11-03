import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { loadSceneByReference } from '../load-scene.js';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

async function createScenesRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'incanterm-scene-reference-'));
  roots.push(root);
  await fs.mkdir(path.join(root, 'scenes'));
  return root;
}

async function writeScene(root: string, id: string, label: string): Promise<void> {
  await fs.writeFile(path.join(root, 'scenes', `${id}.json`), JSON.stringify({
    format: 'incanterm-scene', version: 1, id, label,
    width: 7, height: 7, depthMode: 'bottom-up',
    clear: { ch: ' ', fg: '#ffffff', bg: '#000000' }, entities: [],
  }));
}

it('loads a scene by exact label while keeping ID precedence', async () => {
  const root = await createScenesRoot();
  await writeScene(root, 'room-1', 'hallway1');
  await writeScene(root, 'hallway1', 'other');
  await writeScene(root, 'room-3', 'The Hallway');
  expect((await loadSceneByReference(root, 'room-1')).id).toBe('room-1');
  expect((await loadSceneByReference(root, 'hallway1')).id).toBe('hallway1');
  expect((await loadSceneByReference(root, 'other')).id).toBe('hallway1');
  expect((await loadSceneByReference(root, 'The Hallway')).id).toBe('room-3');
  await expect(loadSceneByReference(root, 'HALLWAY1')).rejects.toThrow('not found by ID or label');
});

it('rejects missing and ambiguous labels rather than choosing an arbitrary scene', async () => {
  const root = await createScenesRoot();
  await writeScene(root, 'room-1', 'hallway1');
  await writeScene(root, 'room-2', 'hallway1');
  await expect(loadSceneByReference(root, 'hallway1')).rejects.toThrow('ambiguous');
  await expect(loadSceneByReference(root, 'missing')).rejects.toThrow('not found by ID or label');
});
