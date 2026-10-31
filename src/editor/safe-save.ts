export type MergeResult<T> = { ok: true; value: T } | { ok: false; reason: string };

export class SaveConflict extends Error {
  readonly status = 409;
}

export type SaveOptions<T> = {
  key: string;
  base: unknown;
  doc: unknown;
  validate(value: unknown): T;
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
      if (!merged.ok) throw new SaveConflict(`${merged.reason}; nothing was saved`);
      const valid = options.validate(merged.value);
      if (disk === null || !same(disk, valid)) await options.write(valid);
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
// identities are atomic; arrays of objects with unchanged ids merge by id.
export function mergeJson<T>(base: T, ours: T, theirs: T): MergeResult<T> {
  return mergeValue(base, ours, theirs, 'document') as MergeResult<T>;
}

function mergeValue(
  base: unknown,
  ours: unknown,
  theirs: unknown,
  at: string,
): MergeResult<unknown> {
  if (same(ours, base)) return { ok: true, value: theirs };
  if (same(theirs, base) || same(ours, theirs)) return { ok: true, value: ours };
  if (isRecord(base) && isRecord(ours) && isRecord(theirs)) {
    const keys = Object.keys(base);
    if (!same(keys, Object.keys(ours)) || !same(keys, Object.keys(theirs))) {
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
    stableIds(base, ours, theirs)
  ) {
    const result: unknown[] = [];
    for (let index = 0; index < base.length; index++) {
      const part = mergeValue(base[index], ours[index], theirs[index], `${at}[${index}]`);
      if (!part.ok) return part;
      result.push(part.value);
    }
    return { ok: true, value: result };
  }
  return { ok: false, reason: `Both editors changed ${at}` };
}

function stableIds(base: unknown[], ours: unknown[], theirs: unknown[]): boolean {
  if (base.length !== ours.length || base.length !== theirs.length) return false;
  const ids = (values: unknown[]) => values.map((value) => (isRecord(value) ? value.id : null));
  const original = ids(base);
  return (
    original.every((id) => typeof id === 'string') &&
    same(original, ids(ours)) &&
    same(original, ids(theirs))
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function same(a: unknown, b: unknown): boolean {
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
