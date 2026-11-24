export type MergeResult<T> = { ok: true; value: T } | { ok: false; reason: string };

export class SaveConflict extends Error {
  readonly status = 409;

  constructor(
    message: string,
    readonly code?: 'merge-conflict',
  ) {
    super(message);
  }
}

export type SaveOptions<T> = {
  key: string;
  base: unknown;
  doc: unknown;
  validate(value: unknown): T;
  prepareWrite?(value: T): T;
  read(): Promise<T | null>;
  write(value: T): Promise<void>;
  merge(base: T, ours: T, theirs: T): MergeResult<T>;
};

// One coordinator per editor server. The lock spans read, merge, validation and
// write; the same key is used by every editor of a given asset.
export class SaveCoordinator {
  private readonly pending = new Map<string, Promise<void>>();

  async save<T>(options: SaveOptions<T>): Promise<T> {
    const ours = options.validate(options.doc);
    const base = options.base === null ? null : options.validate(options.base);
    return this.run(options.key, async () => {
      const disk = await options.read();
      if (disk === null && base !== null) {
        throw new SaveConflict('File was deleted since it was opened; save as a new id');
      }
      if (disk !== null && base === null) {
        throw new SaveConflict('File already exists; open it before saving');
      }
      const merged =
        disk && base ? options.merge(base, ours, disk) : { ok: true as const, value: ours };
      if (!merged.ok)
        throw new SaveConflict(`${merged.reason}; nothing was saved`, 'merge-conflict');
      const valid = options.validate(options.prepareWrite ? options.prepareWrite(merged.value) : merged.value);
      if (disk === null || !isSame(disk, valid)) await options.write(valid);
      return valid;
    });
  }

  async run<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const waiting = this.pending.get(key) ?? Promise.resolve();
    let release!: () => void;
    const next = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.pending.set(key, next);
    await waiting;
    try {
      return await operation();
    } finally {
      release();
      if (this.pending.get(key) === next) this.pending.delete(key);
    }
  }
}

// JSON documents: merge independent fields recursively. Arrays without stable
// identities are atomic; arrays of objects with stable ids merge by id.
export function mergeJson<T>(base: T, ours: T, theirs: T): MergeResult<T> {
  return mergeValue(base, ours, theirs, 'document') as MergeResult<T>;
}

// A successful merge can return `theirs` directly. Keep the editable draft and
// saved baseline independent so the next edit does not mutate its own base.
export function rebaseJsonDraft<T>(
  sent: T,
  current: T,
  stored: T,
): MergeResult<{ draft: T; baseline: T }> {
  const merged = mergeJson(sent, current, stored);
  return merged.ok
    ? { ok: true, value: { draft: merged.value, baseline: structuredClone(stored) } }
    : merged;
}

function mergeValue(
  base: unknown,
  ours: unknown,
  theirs: unknown,
  at: string,
): MergeResult<unknown> {
  if (isSame(ours, base)) return { ok: true, value: theirs };
  if (isSame(theirs, base) || isSame(ours, theirs)) return { ok: true, value: ours };
  if (isRecord(base) && isRecord(ours) && isRecord(theirs)) {
    const keys = Object.keys(base);
    if (!isSame(keys, Object.keys(ours)) || !isSame(keys, Object.keys(theirs))) {
      return { ok: false, reason: `Both editors changed the structure of ${at}` };
    }
    const result: Record<string, unknown> = {};
    for (const key of keys) {
      const part = mergeValue(base[key], ours[key], theirs[key], `${at}.${key}`);
      if (!part.ok) return part;
      result[key] = part.value;
    }
    return { ok: true, value: result };
  }
  if (
    Array.isArray(base) &&
    Array.isArray(ours) &&
    Array.isArray(theirs) &&
    hasStableIds(base, ours, theirs)
  ) {
    return mergeIdentifiedValues(base, ours, theirs, at);
  }
  return { ok: false, reason: `Both editors changed ${at}` };
}

function hasStableIds(base: unknown[], ours: unknown[], theirs: unknown[]): boolean {
  const getIds = (values: unknown[]) => values.map((value) => (isRecord(value) ? value.id : null));
  const original = getIds(base);
  const originalIds = new Set(original);
  return (
    [base, ours, theirs].every((values) => {
      const ids = getIds(values);
      return ids.every((id) => typeof id === 'string') && new Set(ids).size === ids.length;
    }) &&
    [ours, theirs].every((values) => {
      const ids = getIds(values).filter((id) => originalIds.has(id));
      return isSame(
        ids,
        original.filter((id) => ids.includes(id)),
      );
    })
  );
}

function mergeIdentifiedValues(
  base: unknown[],
  ours: unknown[],
  theirs: unknown[],
  at: string,
): MergeResult<unknown[]> {
  const getEntries = (values: unknown[]) =>
    new Map(values.map((value) => [(value as { id: string }).id, value]));
  const old = getEntries(base);
  const local = getEntries(ours);
  const remote = getEntries(theirs);
  const result: unknown[] = [];
  // Keep the disk order, then append new local entries. Deletions only win over
  // unchanged entries; deleting an entry edited elsewhere is a conflict.
  for (const id of new Set([...remote.keys(), ...local.keys()])) {
    const before = old.get(id);
    const left = local.get(id);
    const right = remote.get(id);
    if (before === undefined) {
      if (left !== undefined && right !== undefined && !isSame(left, right))
        return { ok: false, reason: `Both editors added ${at} id ${id} differently` };
      result.push(left ?? right);
    } else if (left === undefined || right === undefined) {
      if (
        (left !== undefined && !isSame(left, before)) ||
        (right !== undefined && !isSame(right, before))
      )
        return {
          ok: false,
          reason: `One editor deleted ${at} id ${id} while the other changed it`,
        };
    } else {
      const part = mergeValue(before, left, right, `${at}[${id}]`);
      if (!part.ok) return part;
      result.push(part.value);
    }
  }
  return { ok: true, value: result };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isSame(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function mergeText(base: string, ours: string, theirs: string): MergeResult<string> {
  if (ours === base) return { ok: true, value: theirs };
  if (theirs === base || ours === theirs) return { ok: true, value: ours };
  const old = base.split('\n');
  const local = ours.split('\n');
  const remote = theirs.split('\n');
  if (old.length !== local.length || old.length !== remote.length) {
    return { ok: false, reason: 'Both editors changed script lines' };
  }
  const result: string[] = [];
  for (let index = 0; index < old.length; index++) {
    const part = mergeValue(old[index], local[index], remote[index], `line ${index + 1}`);
    if (!part.ok) return part as MergeResult<string>;
    result.push(part.value as string);
  }
  return { ok: true, value: result.join('\n') };
}
