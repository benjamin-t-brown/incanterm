import { describe, expect, it } from 'vitest';
import {
  SaveConflict,
  SaveCoordinator,
  mergeJson,
  mergeText,
  rebaseJsonDraft,
} from './safe-save.js';

describe('shared editor saves', () => {
  it('keeps the next editable draft separate from its saved merge baseline', () => {
    const sent = { entities: [{ id: 'hero', x: 1 }] };
    const result = rebaseJsonDraft(sent, sent, { entities: [{ id: 'hero', x: 1 }] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    result.value.draft.entities[0].x = 2;
    expect(result.value.baseline.entities[0].x).toBe(1);
  });
  it('serializes disk reads and merges concurrent independent edits', async () => {
    const coordinator = new SaveCoordinator();
    const base = { left: 0, right: 0 };
    let disk: typeof base | null = base;
    const write = async (doc: typeof base) => {
      disk = doc;
    };
    const options = (doc: typeof base) => ({
      key: 'shared.json',
      base,
      doc,
      validate: (value: unknown) => value as typeof base,
      read: async () => disk,
      write,
      merge: mergeJson,
    });
    const results = await Promise.all([
      coordinator.save(options({ left: 1, right: 0 })),
      coordinator.save(options({ left: 0, right: 2 })),
    ]);
    expect(results[1]).toEqual({ left: 1, right: 2 });
    expect(disk).toEqual({ left: 1, right: 2 });
    await expect(coordinator.save(options({ left: 3, right: 0 }))).rejects.toBeInstanceOf(
      SaveConflict,
    );
    expect(disk).toEqual({ left: 1, right: 2 });
  });

  it('merges stable-id lists and refuses positional arrays with no identity', () => {
    const base = [
      { id: 'one', rgb: '#000000' },
      { id: 'two', rgb: '#000000' },
    ];
    expect(
      mergeJson(
        base,
        [{ ...base[0], rgb: '#111111' }, base[1]],
        [base[0], { ...base[1], rgb: '#222222' }],
      ),
    ).toEqual({
      ok: true,
      value: [
        { id: 'one', rgb: '#111111' },
        { id: 'two', rgb: '#222222' },
      ],
    });
    expect(mergeJson([0, 0], [1, 0], [0, 2])).toMatchObject({ ok: false });
  });

  it('merges separate script lines but stops on overlapping or structural edits', () => {
    expect(mergeText('one\ntwo\n', 'ONE\ntwo\n', 'one\nTWO\n')).toEqual({
      ok: true,
      value: 'ONE\nTWO\n',
    });
    expect(mergeText('one\n', 'ONE\n', 'other\n')).toMatchObject({ ok: false });
    expect(mergeText('one\n', 'one\nnew\n', 'ONE\n')).toMatchObject({ ok: false });
  });

  it('rejects a new file if another editor created it', async () => {
    const coordinator = new SaveCoordinator();
    await expect(
      coordinator.save({
        key: 'new',
        base: null,
        doc: 'ours',
        read: async () => 'theirs',
        write: async () => {
          throw new Error('must not write');
        },
        validate: (value) => String(value),
        merge: mergeJson,
      }),
    ).rejects.toBeInstanceOf(SaveConflict);
  });
});
