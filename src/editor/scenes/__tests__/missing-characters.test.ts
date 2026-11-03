import { describe, expect, it } from 'vitest';
import { createScene } from '../../schema.js';
import { getMissingSceneCharacters, removeMissingSceneCharacters } from '../scene-characters.js';
import { rebaseJsonDraft } from '../../safe-save.js';

describe('restored scene draft cleanup', () => {
  it('cleans both the draft and baseline without losing unrelated unsaved changes', async () => {
    const saved = createScene('room');
    saved.entities = [
      {
        id: 'gone',
        type: 'Character',
        character: 'deleted',
        x: 1,
        y: 1,
        z: 0,
        facing: 'down',
        state: 'idle',
      },
      {
        id: 'kept',
        type: 'Character',
        character: 'existing',
        x: 3,
        y: 1,
        z: 0,
        facing: 'down',
        state: 'idle',
      },
    ];
    const draft = structuredClone(saved);
    draft.entities[0].x = 6;
    draft.entities[1].x = 8;
    draft.label = 'Unsaved label';
    const checked: string[] = [];
    const missing = await getMissingSceneCharacters([draft, saved], async (id) => {
      checked.push(id);
      return id !== 'deleted';
    });
    expect(checked).toEqual(['deleted', 'existing']);
    const cleanDraft = removeMissingSceneCharacters(draft, missing);
    const cleanBase = removeMissingSceneCharacters(saved, missing);
    expect(cleanDraft.entities.map((entity) => [entity.id, entity.x])).toEqual([['kept', 8]]);
    expect(cleanBase.entities[0].x).toBe(3);
    expect(cleanDraft.label).toBe('Unsaved label');
    expect(draft.entities).toHaveLength(2);
    const rebased = rebaseJsonDraft(cleanBase, cleanDraft, cleanBase);
    expect(rebased).toMatchObject({ ok: true, value: { draft: cleanDraft } });
  });

  it('does not treat failed availability checks as confirmation of deletion', async () => {
    const scene = createScene('room');
    scene.entities = [
      {
        id: 'hero',
        type: 'Character',
        character: 'hero',
        x: 1,
        y: 1,
        z: 0,
        facing: 'down',
        state: 'idle',
      },
    ];
    await expect(
      getMissingSceneCharacters([scene], async () => {
        throw new Error('Offline');
      }),
    ).rejects.toThrow('Offline');
    expect(scene.entities).toHaveLength(1);
  });
});
