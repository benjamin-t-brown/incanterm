import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createAnimation, createCharacter, createScene } from '../schema.js';
import { AssetStore } from '../store.js';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

async function createFixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'incanterm-missing-character-'));
  roots.push(root);
  await fs.mkdir(path.join(root, 'characters'));
  await fs.mkdir(path.join(root, 'scenes'));
  for (const id of ['hero', 'npc'])
    await fs.writeFile(
      path.join(root, 'characters', `${id}.json`),
      JSON.stringify(createCharacter(id, 'stand')),
    );
  for (const id of ['first', 'second']) {
    const scene = createScene(id);
    scene.entities = [
      {
        id: 'hero-1',
        type: 'Character',
        character: 'hero',
        x: 3,
        y: 4,
        z: 0,
        state: 'idle',
        facing: 'down',
      },
      {
        id: 'hero-2',
        type: 'Character',
        character: 'hero',
        x: 5,
        y: 4,
        z: 0,
        state: 'idle',
        facing: 'down',
      },
      {
        id: 'npc-1',
        type: 'Character',
        character: 'npc',
        x: 7,
        y: 4,
        z: 0,
        state: 'idle',
        facing: 'down',
      },
      { id: 'desk', type: 'Prop', prop: 'desk', x: 9, y: 4, z: 0 },
    ];
    scene.blockedCells = [10, 11];
    await fs.writeFile(path.join(root, 'scenes', `${id}.json`), JSON.stringify(scene));
  }
  return { root, store: new AssetStore(root) };
}

describe('missing scene characters', () => {
  it('saves an old draft with entity additions and edits after deletion cleaned the disk', async () => {
    const { root, store } = await createFixture();
    await fs.mkdir(path.join(root, 'animations'));
    await fs.writeFile(
      path.join(root, 'animations', 'stand.json'),
      JSON.stringify(createAnimation('stand')),
    );
    const base = await store.readScene('first');
    base.entities = base.entities.filter((entity) => entity.type === 'Character');
    await fs.writeFile(path.join(root, 'scenes', 'first.json'), JSON.stringify(base));
    const draft = structuredClone(base);
    draft.entities[0].x = 15; // Even edits to a deleted character should be pruned.
    draft.entities[2].x = 20;
    draft.entities.push({ ...draft.entities[2], id: 'npc-2', x: 30 });
    await store.deleteCharacter('hero');
    const stored = await store.saveSceneDraft('first', draft, base);
    expect(stored.entities.map((entity) => [entity.id, entity.x])).toEqual([
      ['npc-1', 20],
      ['npc-2', 30],
    ]);
    expect((await store.readScene('first')).entities).toEqual(stored.entities);
    expect(draft.entities).toHaveLength(4);
  });

  it('removes all instances from saved scenes when the character is deleted', async () => {
    const { root, store } = await createFixture();
    await store.deleteCharacter('hero');
    for (const id of ['first', 'second']) {
      const saved = JSON.parse(await fs.readFile(path.join(root, 'scenes', `${id}.json`), 'utf8'));
      expect(saved.entities.map((entity: { id: string }) => entity.id)).toEqual(['npc-1', 'desk']);
      expect(saved.blockedCells).toEqual([10, 11]);
      expect((await store.readScene(id)).entities).toEqual(saved.entities);
    }
  });

  it('repairs and persists a scene opened after an external character deletion', async () => {
    const { root, store } = await createFixture();
    await fs.unlink(path.join(root, 'characters', 'hero.json'));
    const scene = await store.readScene('first');
    expect(scene.entities.map((entity) => entity.id)).toEqual(['npc-1', 'desk']);
    const saved = JSON.parse(await fs.readFile(path.join(root, 'scenes', 'first.json'), 'utf8'));
    expect(saved.entities).toEqual(scene.entities);
    // No-op saves still use the same scene lock without recursively acquiring it.
    expect(await store.saveSceneDraft('first', scene, scene)).toEqual(scene);
  });

  it('does not remove instances merely because an existing character file is malformed', async () => {
    const { root, store } = await createFixture();
    await fs.writeFile(path.join(root, 'characters', 'hero.json'), 'invalid JSON');
    expect((await store.readScene('first')).entities.map((entity) => entity.id)).toEqual([
      'hero-1',
      'hero-2',
      'npc-1',
      'desk',
    ]);
  });
});
