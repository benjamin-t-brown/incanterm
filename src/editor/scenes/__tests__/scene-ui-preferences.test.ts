import { expect, it } from 'vitest';
import {
  readSceneUiPreferences,
  saveSceneUiPreference,
  SCENE_UI_PREFERENCES_KEY,
} from '../scene-ui-preferences.js';

it('keeps Show UI independently for each loaded scene across editor sessions', () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  };
  const preferences = readSceneUiPreferences(storage);
  saveSceneUiPreference(storage, preferences, 'classroom', true);
  saveSceneUiPreference(storage, preferences, 'hallway', false);
  expect(readSceneUiPreferences(storage)).toEqual({ classroom: true, hallway: false });
  saveSceneUiPreference(storage, preferences, 'hallway', true);
  expect(readSceneUiPreferences(storage)).toEqual({ classroom: true, hallway: true });
  expect(values.has(SCENE_UI_PREFERENCES_KEY)).toBe(true);
});

it('ignores invalid or stale stored preferences', () => {
  expect(readSceneUiPreferences({ getItem: () => '{' })).toEqual({});
  expect(readSceneUiPreferences({ getItem: () => JSON.stringify({
    classroom: true,
    hallway: 'true',
    '../invalid': true,
  }) })).toEqual({ classroom: true });
});
