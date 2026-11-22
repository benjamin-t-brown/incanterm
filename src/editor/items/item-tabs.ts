import { isAssetId } from '../schema.js';
import { parseItem, type ItemDocument } from './item-schema.js';

export const OPEN_ITEMS_KEY = 'incanterm-editor-open-items';
export type ItemTabSession = {
  doc: ItemDocument;
  base: ItemDocument | null;
  folder: string;
};
type ItemTabStore = {
  version: 1;
  tabs: string[];
  active: string | null;
  drafts: Record<string, ItemTabSession>;
};

export function readItemTabs(storage: Pick<Storage, 'getItem'>): ItemTabStore {
  const empty: ItemTabStore = { version: 1, tabs: [], active: null, drafts: {} };
  try {
    const raw = JSON.parse(storage.getItem(OPEN_ITEMS_KEY) ?? 'null');
    if (raw?.version !== 1) return empty;
    const tabs = Array.isArray(raw.tabs)
      ? [
          ...new Set<string>(
            raw.tabs.filter((id: unknown) => typeof id === 'string' && isAssetId(id)),
          ),
        ]
      : [];
    const drafts: Record<string, ItemTabSession> = {};
    for (const id of tabs) {
      const session = raw.drafts?.[id];
      if (!session) continue;
      // Half-entered labels, aliases, hooks and rules are legitimate local drafts.
      const doc = parseItem({
        ...session.doc,
        label: id,
        scriptName: undefined,
        examineScript: undefined,
        combineFailScript: undefined,
        combinations: [],
      });
      const base = session.base === null ? null : parseItem(session.base);
      const rules = session.doc?.combinations;
      if (
        !doc.ok ||
        doc.value.id !== id ||
        typeof session.doc.label !== 'string' ||
        (session.doc.scriptName !== undefined && typeof session.doc.scriptName !== 'string') ||
        (session.doc.examineScript !== undefined &&
          typeof session.doc.examineScript !== 'string') ||
        (session.doc.combineFailScript !== undefined &&
          typeof session.doc.combineFailScript !== 'string') ||
        !Array.isArray(rules) ||
        !rules.every(
          (rule) =>
            rule &&
            ['item', 'prop', 'character'].includes(rule.targetType) &&
            typeof rule.target === 'string' &&
            typeof rule.script === 'string',
        ) ||
        (base !== null && (!base.ok || base.value.id !== id))
      )
        continue;
      drafts[id] = {
        doc: {
          ...doc.value,
          label: session.doc.label,
          ...(session.doc.scriptName !== undefined ? { scriptName: session.doc.scriptName } : {}),
          ...(session.doc.examineScript !== undefined
            ? { examineScript: session.doc.examineScript }
            : {}),
          ...(session.doc.combineFailScript !== undefined
            ? { combineFailScript: session.doc.combineFailScript }
            : {}),
          combinations: rules,
        },
        base: base === null ? null : base.value,
        folder: typeof session.folder === 'string' ? session.folder : '',
      };
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
