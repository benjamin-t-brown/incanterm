import { isAssetId, parseCharacter, type CharacterDocument } from '../schema.js';

export const OPEN_CHARACTERS_KEY = 'incanterm-editor-open-characters';
export type CharacterTabSession = { doc: CharacterDocument; saved: CharacterDocument | null };
export type CharacterTabStore = {
  version: 1;
  tabs: string[];
  active: string | null;
  drafts: Record<string, CharacterTabSession>;
};

export function readCharacterTabs(storage: Pick<Storage, 'getItem'>): CharacterTabStore {
  const empty: CharacterTabStore = { version: 1, tabs: [], active: null, drafts: {} };
  try {
    const value: unknown = JSON.parse(storage.getItem(OPEN_CHARACTERS_KEY) ?? 'null');
    if (!value || typeof value !== 'object' || !('version' in value) || value.version !== 1)
      return empty;
    const raw = value as Record<string, unknown>;
    const tabs = Array.isArray(raw.tabs)
      ? [...new Set(raw.tabs.filter((id): id is string => typeof id === 'string' && isAssetId(id)))]
      : [];
    const drafts: Record<string, CharacterTabSession> = {};
    const entries =
      raw.drafts && typeof raw.drafts === 'object' ? (raw.drafts as Record<string, unknown>) : {};
    for (const id of tabs) {
      const entry = entries[id];
      if (!entry || typeof entry !== 'object') continue;
      const session = entry as Record<string, unknown>;
      const doc = parseCharacter(session.doc);
      const saved = session.saved === null ? null : parseCharacter(session.saved);
      if (doc.ok && doc.value.id === id && (saved === null || (saved.ok && saved.value.id === id)))
        drafts[id] = { doc: doc.value, saved: saved === null ? null : saved.value };
    }
    return {
      version: 1,
      tabs,
      active: typeof raw.active === 'string' && tabs.includes(raw.active) ? raw.active : null,
      drafts,
    };
  } catch {
    return empty;
  }
}

export function neighborCharacterTab(tabs: readonly string[], id: string): string | null {
  const index = tabs.indexOf(id);
  return tabs[index + 1] ?? tabs[index - 1] ?? null;
}
