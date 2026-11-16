import { describe, expect, it } from 'vitest';
import { createProp, createScene, parseScene } from '../../schema.js';
import { addSceneProp } from '../scene-props.js';

describe('placing existing props', () => {
  it('adds separate scene instances that reference the same reusable prop', () => {
    const scene = createScene('room');
    const prop = createProp('chair', { type: 'sprite', id: 'chair-sprite', index: 0 });
    scene.triggers = ['chair-1'];
    const first = addSceneProp(scene, prop, 12, 8);
    const second = addSceneProp(scene, prop, 20, 10);
    expect(first).toMatchObject({ id: 'chair-2', name: 'chair_2', prop: 'chair', x: 12, y: 8 });
    expect(second).toMatchObject({ id: 'chair-3', name: 'chair_3', prop: 'chair', x: 20, y: 10 });
    expect(parseScene(scene).ok).toBe(true);
  });

  it('uses the prop label for instance names without changing stable IDs or references', () => {
    const scene = createScene('room');
    const prop = createProp('prop-uuid', { type: 'sprite', id: 'chair-sprite', index: 0 });
    prop.label = 'Reading Chair';
    const first = addSceneProp(scene, prop, 12, 8);
    const second = addSceneProp(scene, prop, 20, 10);
    expect(first).toMatchObject({
      id: 'prop-uuid-1',
      name: 'Reading Chair',
      prop: 'prop-uuid',
      state: 'default',
    });
    expect(second).toMatchObject({
      id: 'prop-uuid-2',
      name: 'Reading Chair',
      prop: 'prop-uuid',
    });
    expect(parseScene(scene)).toMatchObject({
      ok: true,
      value: { entities: [{ name: 'Reading Chair' }, { name: 'Reading Chair' }] },
    });
  });

  it('keeps the full label and does not overwrite names on existing instances', () => {
    const scene = createScene('room');
    const prop = createProp('prop-uuid', { type: 'sprite', id: 'chair-sprite', index: 0 });
    prop.label = 'A'.repeat(80);
    const first = addSceneProp(scene, prop, 12, 8);
    expect(first.name).toBe(prop.label);
    first.name = 'My custom chair';
    prop.label = 'Updated prop label';
    const second = addSceneProp(scene, prop, 20, 10);
    expect(first.name).toBe('My custom chair');
    expect(second.name).toBe('Updated prop label');
    expect(parseScene(scene).ok).toBe(true);
  });
});
