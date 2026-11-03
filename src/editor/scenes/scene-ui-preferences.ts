import { isAssetId } from '../schema.js';

export const SCENE_UI_PREFERENCES_KEY = 'incanterm-editor-scene-show-ui';

export function readSceneUiPreferences(storage: Pick<Storage, 'getItem'>): Record<string, boolean> {
  try {
    const value: unknown = JSON.parse(storage.getItem(SCENE_UI_PREFERENCES_KEY) ?? 'null');
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
    return Object.fromEntries(
      Object.entries(value).filter(([id, visible]) => isAssetId(id) && typeof visible === 'boolean'),
    );
  } catch {
    return {};
  }
}

export function saveSceneUiPreference(
  storage: Pick<Storage, 'setItem'>,
  preferences: Record<string, boolean>,
  sceneId: string,
  visible: boolean,
): void {
  preferences[sceneId] = visible;
  storage.setItem(SCENE_UI_PREFERENCES_KEY, JSON.stringify(preferences));
}
