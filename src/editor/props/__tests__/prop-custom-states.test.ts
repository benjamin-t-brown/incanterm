import { expect, it } from 'vitest';
import { createProp, parseProp } from '../../schema.js';
import { updatePropCustomState } from '../prop-custom-states.js';

function createTestProp() {
  const prop = createProp('test-prop', { type: 'sprite', id: 'test-art', index: 0 });
  prop.customAnimations = { open: 'open-animation', closed: 'closed-animation' };
  return prop;
}

it('updates the animation without treating an unchanged name as a duplicate', () => {
  const prop = createTestProp();
  updatePropCustomState(prop, 'open', 'new-animation', 'open');
  expect(prop.customAnimations).toEqual({ open: 'new-animation', closed: 'closed-animation' });
  expect(parseProp(prop)).toEqual({ ok: true, value: prop });
});

it('renames the state and changes its animation without leaving the old state behind', () => {
  const prop = createTestProp();
  updatePropCustomState(prop, '  partly open  ', 'half-animation', 'open');
  expect(prop.customAnimations).toEqual({
    'partly open': 'half-animation',
    closed: 'closed-animation',
  });
  expect(Object.keys(prop.customAnimations)).toEqual(['partly open', 'closed']);
});

it('still supports adding a new state', () => {
  const prop = createTestProp();
  updatePropCustomState(prop, 'broken', 'broken-animation');
  expect(prop.customAnimations).toEqual({
    open: 'open-animation',
    closed: 'closed-animation',
    broken: 'broken-animation',
  });
});

it.each(['closed', 'default', '', 'Open', 'bad\nname'])(
  'rejects invalid or conflicting edits (%j) without changing the prop',
  (name) => {
    const prop = createTestProp();
    const before = structuredClone(prop);
    expect(() => updatePropCustomState(prop, name, 'new-animation', 'open')).toThrow(
      'Use a unique lowercase state name',
    );
    expect(prop).toEqual(before);
  },
);

it('does not recreate an edited state that was removed while the dialog was open', () => {
  const prop = createTestProp();
  delete prop.customAnimations.open;
  expect(() => updatePropCustomState(prop, 'open', 'new-animation', 'open')).toThrow(
    'This custom state no longer exists',
  );
  expect(prop.customAnimations).toEqual({ closed: 'closed-animation' });
});

it('allows editing at the 64-state limit but prevents adding another state', () => {
  const prop = createTestProp();
  prop.customAnimations = Object.fromEntries(
    Array.from({ length: 64 }, (_, index) => [`state-${index}`, 'test-animation']),
  );
  updatePropCustomState(prop, 'renamed', 'new-animation', 'state-0');
  expect(prop.customAnimations.renamed).toBe('new-animation');
  expect(Object.keys(prop.customAnimations)).toHaveLength(64);
  expect(() => updatePropCustomState(prop, 'extra', 'test-animation')).toThrow(
    'Maximum 64 custom states',
  );
});
