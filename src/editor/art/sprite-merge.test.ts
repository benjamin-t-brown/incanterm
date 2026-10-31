import { describe, expect, it } from 'vitest';
import { createSprite } from '../schema.js';
import { mergeSprite } from './sprite-merge.js';

const a = { ch: 'A', fg: 'white', bg: 'black' };
const b = { ch: 'B', fg: 'white', bg: 'black' };

describe('sprite three-way merge', () => {
  it('keeps independent edits to cells and properties', () => {
    const base = createSprite('test', 2, 1);
    const ours = structuredClone(base);
    const theirs = structuredClone(base);
    ours.sprites[0].layers[0].cells[0] = a;
    ours.originX = 1;
    theirs.sprites[0].layers[0].cells[1] = b;
    theirs.sprites[0].layers[0].name = 'Other';
    const merged = mergeSprite(base, ours, theirs);
    expect(merged.ok).toBe(true);
    if (!merged.ok) return;
    expect(merged.value.originX).toBe(1);
    expect(merged.value.sprites[0].layers[0]).toMatchObject({
      name: 'Other',
      cells: [a, b],
    });
    expect(base.sprites[0].layers[0].cells).toEqual([null, null]);
  });

  it('refuses conflicting edits instead of choosing a winner', () => {
    const base = createSprite('test', 1, 1);
    const ours = structuredClone(base);
    const theirs = structuredClone(base);
    ours.sprites[0].layers[0].cells[0] = a;
    theirs.sprites[0].layers[0].cells[0] = b;
    expect(mergeSprite(base, ours, theirs)).toMatchObject({
      ok: false,
      reason: expect.stringContaining('cell'),
    });
    theirs.sprites[0].layers[0].cells[0] = a;
    expect(mergeSprite(base, ours, theirs)).toMatchObject({ ok: true });
  });

  it('merges different properties of a painted cell', () => {
    const base = createSprite('test', 1, 1);
    base.sprites[0].layers[0].cells[0] = a;
    const ours = structuredClone(base);
    const theirs = structuredClone(base);
    ours.sprites[0].layers[0].cells[0] = { ...a, ch: 'Z' };
    theirs.sprites[0].layers[0].cells[0] = { ...a, fg: 'red' };
    const merged = mergeSprite(base, ours, theirs);
    expect(merged.ok && merged.value.sprites[0].layers[0].cells[0]).toEqual({
      ...a,
      ch: 'Z',
      fg: 'red',
    });
  });

  it('does not guess at frame/layer structure changes', () => {
    const base = createSprite('test', 1, 1);
    const ours = structuredClone(base);
    const theirs = structuredClone(base);
    ours.sprites.push(structuredClone(ours.sprites[0]));
    theirs.sprites[0].layers[0].cells[0] = a;
    expect(mergeSprite(base, ours, theirs)).toMatchObject({ ok: false });
    expect(mergeSprite(base, base, ours)).toEqual({ ok: true, value: ours });
  });
});
