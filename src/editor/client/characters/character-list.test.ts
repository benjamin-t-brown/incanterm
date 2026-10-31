import { describe, expect, it } from 'vitest';
import { createCharacter } from '../../schema.js';
import { characterListEntries } from './character-list.js';

describe('character search list', () => {
  const files = ['existing-id'];
  const labels = { 'existing-id': 'Existing Hero' };
  const draft = createCharacter('new-uuid', 'idle-clip', 'Folder Hero');

  it('shows labels for saved characters and includes an unsaved folder draft immediately', () => {
    expect(characterListEntries(files, labels, draft, '')).toEqual([
      { id: 'new-uuid', label: 'Folder Hero' },
      { id: 'existing-id', label: 'Existing Hero' },
    ]);
  });

  it('searches labels and ids without displaying ids or duplicating saved entries', () => {
    expect(characterListEntries(files, labels, draft, 'new-uuid')).toEqual([
      { id: 'new-uuid', label: 'Folder Hero' },
    ]);
    expect(characterListEntries(files, labels, draft, 'existing hero')).toEqual([
      { id: 'existing-id', label: 'Existing Hero' },
    ]);
    expect(
      characterListEntries(
        ['new-uuid', ...files],
        { ...labels, 'new-uuid': 'Old Label' },
        draft,
        '',
      ),
    ).toEqual([
      { id: 'new-uuid', label: 'Folder Hero' },
      { id: 'existing-id', label: 'Existing Hero' },
    ]);
    expect(characterListEntries(files, labels, null, '')).toEqual([
      { id: 'existing-id', label: 'Existing Hero' },
    ]);
  });
});
