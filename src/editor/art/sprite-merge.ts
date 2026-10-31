import type { SpriteCell, SpriteDocument } from '../schema.js';

export type SpriteMergeResult = { ok: true; value: SpriteDocument } | { ok: false; reason: string };

// Three-way merge: base is the version the editor opened, ours is its draft,
// and theirs is the most recent document on disk. Never guess on overlaps.
export function mergeSprite(
  base: SpriteDocument,
  ours: SpriteDocument,
  theirs: SpriteDocument,
): SpriteMergeResult {
  if (same(ours, base)) return { ok: true, value: theirs };
  if (same(theirs, base) || same(ours, theirs)) return { ok: true, value: ours };

  // Resizes, added/removed/reordered frames or layers change the meaning of
  // cell indexes. If both sides edited, a positional merge would lose work.
  if (!same(shape(base), shape(ours)) || !same(shape(base), shape(theirs))) {
    return { ok: false, reason: 'Sprite structure changed in another editor' };
  }

  const result: SpriteDocument = structuredClone(theirs);
  for (const field of ['originX', 'originY', 'font'] as const) {
    const value = choose(base[field], ours[field], theirs[field]);
    if (!value.ok) return { ok: false, reason: `Both editors changed ${field}` };
    // The field types differ, so assign through the specific field.
    if (field === 'font') result.font = value.value as SpriteDocument['font'];
    else result[field] = value.value as number;
  }

  for (let frameIndex = 0; frameIndex < base.sprites.length; frameIndex++) {
    for (let layerIndex = 0; layerIndex < base.sprites[frameIndex].layers.length; layerIndex++) {
      const old = base.sprites[frameIndex].layers[layerIndex];
      const local = ours.sprites[frameIndex].layers[layerIndex];
      const remote = theirs.sprites[frameIndex].layers[layerIndex];
      const merged = result.sprites[frameIndex].layers[layerIndex];
      for (const field of ['name', 'visible', 'locked'] as const) {
        const value = choose(old[field], local[field], remote[field]);
        if (!value.ok) {
          return { ok: false, reason: `Both editors changed ${old.id} ${field}` };
        }
        if (field === 'name') merged.name = value.value as string;
        else merged[field] = value.value as boolean;
      }
      for (let index = 0; index < old.cells.length; index++) {
        const value = mergeCell(old.cells[index], local.cells[index], remote.cells[index]);
        if (!value.ok) {
          const x = index % base.width;
          const y = Math.floor(index / base.width);
          return {
            ok: false,
            reason: `Both editors changed frame ${frameIndex + 1}, layer ${old.name}, cell ${x + 1},${y + 1}`,
          };
        }
        merged.cells[index] = value.value;
      }
    }
  }
  return { ok: true, value: result };
}

function shape(doc: SpriteDocument): unknown {
  return [
    doc.id,
    doc.width,
    doc.height,
    doc.sprites.map((frame) => frame.layers.map((layer) => layer.id)),
  ];
}

function choose<T>(base: T, ours: T, theirs: T): { ok: true; value: T } | { ok: false } {
  if (same(ours, base)) return { ok: true, value: theirs };
  if (same(theirs, base) || same(ours, theirs)) return { ok: true, value: ours };
  return { ok: false };
}

function mergeCell(
  base: SpriteCell | null,
  ours: SpriteCell | null,
  theirs: SpriteCell | null,
): { ok: true; value: SpriteCell | null } | { ok: false } {
  const whole = choose(base, ours, theirs);
  if (whole.ok || !base || !ours || !theirs) return whole;
  const ch = choose(base.ch, ours.ch, theirs.ch);
  const fg = choose(base.fg, ours.fg, theirs.fg);
  const bg = choose(base.bg, ours.bg, theirs.bg);
  if (!ch.ok || !fg.ok || !bg.ok) return { ok: false };
  return { ok: true, value: { ch: ch.value, fg: fg.value, bg: bg.value } };
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
