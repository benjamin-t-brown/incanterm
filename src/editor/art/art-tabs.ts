import { isAssetId, parseSprite, type SpriteCell, type SpriteDocument } from '../schema.js';

export const LAST_SPRITE_KEY = 'incanterm-editor-last-sprite';
export const OPEN_SPRITES_KEY = 'incanterm-editor-open-sprites';
export const ART_TAB_STORE_VERSION = 1;
export const ART_TAB_PERSIST_MS = 400;

export type ArtTabStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

export type ArtTabSelection = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type ArtTabStamp = {
  width: number;
  height: number;
  cells: (SpriteCell | null)[];
};

export type ArtTabChrome = {
  selectedFrame: number;
  playFrom: number;
  playTo: number;
  rangeSelected: boolean;
  moveArmed: boolean;
  activeLayerId: string | null;
  selection: ArtTabSelection | null;
  stamp: ArtTabStamp | null;
  pasteMode: boolean;
  celMarked: boolean;
  zoom: number;
  ox: number;
  oy: number;
  autoFit: boolean;
};

export type ArtTabDirtySession = ArtTabChrome & {
  doc: SpriteDocument;
  savedState: string;
};

export type ArtTabStore = {
  version: typeof ART_TAB_STORE_VERSION;
  tabs: string[];
  active: string | null;
  sessions: Record<string, ArtTabDirtySession>;
};

export type ArtTabWriteResult = { ok: true } | { ok: false; quota: boolean };

export function getDefaultArtTabChrome(): ArtTabChrome {
  return {
    selectedFrame: 0,
    playFrom: 0,
    playTo: 0,
    rangeSelected: false,
    moveArmed: false,
    activeLayerId: null,
    selection: null,
    stamp: null,
    pasteMode: false,
    celMarked: false,
    zoom: 1,
    ox: 30,
    oy: 30,
    autoFit: true,
  };
}

export function createEmptyArtTabStore(): ArtTabStore {
  return { version: ART_TAB_STORE_VERSION, tabs: [], active: null, sessions: {} };
}

export function addOpenTab(tabs: readonly string[], id: string): string[] {
  if (!isAssetId(id) || tabs.includes(id)) return [...tabs];
  return [...tabs, id];
}

export function closeOpenTab(tabs: readonly string[], id: string): string[] {
  return tabs.filter((tab) => tab !== id);
}

export function renameOpenTab(tabs: readonly string[], from: string, to: string): string[] {
  if (!isAssetId(to)) return [...tabs];
  const next: string[] = [];
  for (const tab of tabs) {
    const id = tab === from ? to : tab;
    if (!next.includes(id)) next.push(id);
  }
  return next;
}

export function getNeighborTab(tabs: readonly string[], id: string): string | null {
  const index = tabs.indexOf(id);
  if (index < 0) return tabs[tabs.length - 1] ?? null;
  return tabs[index + 1] ?? tabs[index - 1] ?? null;
}

export function pruneMissingTabs(
  tabs: readonly string[],
  files: readonly string[],
  dirtyIds: ReadonlySet<string>,
): string[] {
  const known = new Set(files);
  return tabs.filter((id) => known.has(id) || dirtyIds.has(id));
}

export function isSessionDirty(doc: SpriteDocument, savedState: string): boolean {
  return JSON.stringify(doc) !== savedState;
}

export function buildArtTabStore(
  tabs: readonly string[],
  active: string | null,
  sessions: Iterable<readonly [string, ArtTabDirtySession]>,
): ArtTabStore {
  const open = getUniqueAssetIds(tabs);
  const openSet = new Set(open);
  const stored: Record<string, ArtTabDirtySession> = {};
  for (const [id, session] of sessions) {
    if (!openSet.has(id) || !isSessionDirty(session.doc, session.savedState)) continue;
    stored[id] = session;
  }
  return {
    version: ART_TAB_STORE_VERSION,
    tabs: open,
    active: active && openSet.has(active) ? active : (open[open.length - 1] ?? null),
    sessions: stored,
  };
}

export function parseArtTabStore(value: unknown): ArtTabStore {
  if (!isRecord(value) || value.version !== ART_TAB_STORE_VERSION) return createEmptyArtTabStore();
  const tabs = getUniqueAssetIds(Array.isArray(value.tabs) ? value.tabs.filter(isString) : []);
  const active =
    typeof value.active === 'string' && tabs.includes(value.active) ? value.active : null;
  const sessions: Record<string, ArtTabDirtySession> = {};
  if (isRecord(value.sessions)) {
    for (const [id, raw] of Object.entries(value.sessions)) {
      if (!tabs.includes(id)) continue;
      const session = parseArtTabDirtySession(id, raw);
      if (session) sessions[id] = session;
    }
  }
  return { version: ART_TAB_STORE_VERSION, tabs, active, sessions };
}

export function readArtTabStore(storage: ArtTabStorage): ArtTabStore {
  try {
    const raw = storage.getItem(OPEN_SPRITES_KEY);
    if (!raw) return createEmptyArtTabStore();
    return parseArtTabStore(JSON.parse(raw) as unknown);
  } catch {
    return createEmptyArtTabStore();
  }
}

export function writeArtTabStore(storage: ArtTabStorage, store: ArtTabStore): ArtTabWriteResult {
  try {
    storage.setItem(OPEN_SPRITES_KEY, JSON.stringify(parseArtTabStore(store)));
    if (store.active && isAssetId(store.active)) storage.setItem(LAST_SPRITE_KEY, store.active);
    else storage.removeItem(LAST_SPRITE_KEY);
    return { ok: true };
  } catch (error) {
    return { ok: false, quota: isQuotaError(error) };
  }
}

function parseArtTabDirtySession(id: string, value: unknown): ArtTabDirtySession | null {
  if (!isRecord(value)) return null;
  const parsed = parseSprite(value.doc);
  if (!parsed.ok || parsed.value.id !== id) return null;
  return {
    ...parseArtTabChrome(value),
    doc: parsed.value,
    savedState: readSavedState(value.savedState, parsed.value),
  };
}

function parseArtTabChrome(value: Record<string, unknown>): ArtTabChrome {
  const fallback = getDefaultArtTabChrome();
  return {
    selectedFrame: readInt(value.selectedFrame, fallback.selectedFrame),
    playFrom: readInt(value.playFrom, fallback.playFrom),
    playTo: readInt(value.playTo, fallback.playTo),
    rangeSelected: readBoolean(value.rangeSelected, fallback.rangeSelected),
    moveArmed: readBoolean(value.moveArmed, fallback.moveArmed),
    activeLayerId: typeof value.activeLayerId === 'string' ? value.activeLayerId : null,
    selection: parseSelection(value.selection),
    stamp: parseStamp(value.stamp),
    pasteMode: readBoolean(value.pasteMode, fallback.pasteMode),
    celMarked: readBoolean(value.celMarked, fallback.celMarked),
    zoom: readNumber(value.zoom, fallback.zoom),
    ox: readNumber(value.ox, fallback.ox),
    oy: readNumber(value.oy, fallback.oy),
    autoFit: readBoolean(value.autoFit, fallback.autoFit),
  };
}

function readSavedState(value: unknown, fallback: SpriteDocument): string {
  if (typeof value !== 'string') return JSON.stringify(fallback);
  try {
    const parsed = parseSprite(JSON.parse(value) as unknown);
    if (parsed.ok) return JSON.stringify(parsed.value);
  } catch {
    return value;
  }
  return value;
}

function parseSelection(value: unknown): ArtTabSelection | null {
  if (!isRecord(value)) return null;
  const x = readInt(value.x, Number.NaN);
  const y = readInt(value.y, Number.NaN);
  const width = readInt(value.width, Number.NaN);
  const height = readInt(value.height, Number.NaN);
  if (![x, y, width, height].every(Number.isFinite) || width < 1 || height < 1) return null;
  return { x, y, width, height };
}

function parseStamp(value: unknown): ArtTabStamp | null {
  if (!isRecord(value)) return null;
  const width = readInt(value.width, Number.NaN);
  const height = readInt(value.height, Number.NaN);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) return null;
  if (!Array.isArray(value.cells) || value.cells.length !== width * height) return null;
  const cells: (SpriteCell | null)[] = [];
  for (const entry of value.cells) {
    if (entry === null) {
      cells.push(null);
      continue;
    }
    if (!isRecord(entry) || typeof entry.ch !== 'string') return null;
    if (typeof entry.fg !== 'string' || typeof entry.bg !== 'string') return null;
    cells.push({ ch: entry.ch, fg: entry.fg, bg: entry.bg });
  }
  return { width, height, cells };
}

function getUniqueAssetIds(ids: readonly string[]): string[] {
  const next: string[] = [];
  for (const id of ids) {
    if (isAssetId(id) && !next.includes(id)) next.push(id);
  }
  return next;
}

function isQuotaError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === 'QuotaExceededError' || error.name === 'NS_ERROR_DOM_QUOTA_REACHED')
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function readInt(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isInteger(value) ? value : fallback;
}

function readNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}
