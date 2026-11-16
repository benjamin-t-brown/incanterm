import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createSearchSelect } from '../search-select.js';
import { createTestElement, TestElement } from './dom-fixture.js';

beforeEach(() => vi.stubGlobal('document', { createElement: createTestElement }));
afterEach(() => vi.unstubAllGlobals());

function createSelector(labels?: Record<string, string>) {
  const onInput = vi.fn();
  const onCommit = vi.fn();
  const element = createSearchSelect({
    value: 'chair-id',
    choices: ['chair-id', 'lamp-id', 'other-lamp-id'],
    labels,
    ariaLabel: 'Prop asset',
    onInput,
    onCommit,
  }) as unknown as TestElement;
  const [input, list] = element.children;
  function setSearchQuery(value: string): void {
    input.value = value;
    input.dispatch('input');
  }
  return { input, list, onInput, onCommit, setSearchQuery };
}

const labels = {
  'chair-id': 'Reading Chair',
  'lamp-id': 'Desk Lamp',
  'other-lamp-id': 'Desk Lamp',
};

it('shows asset labels and searches both labels and stable IDs', () => {
  const view = createSelector(labels);
  expect(view.input.value).toBe('Reading Chair');
  expect(view.input.attributes.get('role')).toBe('combobox');
  view.setSearchQuery('desk');
  expect(view.list.children.map((row) => row.textContent)).toEqual(['Desk Lamp', 'Desk Lamp']);
  view.setSearchQuery('lamp-id');
  expect(view.list.children.map((row) => row.dataset.value)).toEqual(['lamp-id', 'other-lamp-id']);
});

it('commits the exact asset ID when choosing a label, including duplicate labels', () => {
  const view = createSelector(labels);
  view.setSearchQuery('desk');
  view.list.children[1].dispatch('pointerdown');
  expect(view.onInput).toHaveBeenLastCalledWith('other-lamp-id');
  expect(view.onCommit).toHaveBeenLastCalledWith('other-lamp-id');
  expect(view.input.value).toBe('Desk Lamp');
  view.input.dispatch('blur');
  expect(view.onCommit).toHaveBeenLastCalledWith('other-lamp-id');
});

it('supports keyboard selection without storing a display label as the asset reference', () => {
  const view = createSelector(labels);
  view.setSearchQuery('desk');
  view.input.dispatch('keydown', 'ArrowDown');
  view.input.dispatch('keydown', 'ArrowDown');
  view.input.dispatch('keydown', 'Enter');
  expect(view.onCommit).toHaveBeenLastCalledWith('other-lamp-id');
  expect(view.input.value).toBe('Desk Lamp');
  expect(view.list.hidden).toBe(true);
});

it('commits typed IDs and uniquely matching labels to the corresponding asset ID', () => {
  const view = createSelector(labels);
  view.setSearchQuery('lamp-id');
  view.input.dispatch('keydown', 'Enter');
  expect(view.onCommit).toHaveBeenLastCalledWith('lamp-id');
  expect(view.input.value).toBe('Desk Lamp');
  view.setSearchQuery('Reading Chair');
  view.input.dispatch('blur');
  expect(view.onCommit).toHaveBeenLastCalledWith('chair-id');
});

it('does not change the selected ID on blur when its label is another asset ID', () => {
  const view = createSelector({ ...labels, 'chair-id': 'lamp-id' });
  view.input.dispatch('blur');
  expect(view.onCommit).toHaveBeenLastCalledWith('chair-id');
  view.setSearchQuery('lamp-id');
  view.list.children.find((row) => row.dataset.value === 'lamp-id')?.dispatch('pointerdown');
  expect(view.onCommit).toHaveBeenLastCalledWith('lamp-id');
});

it('preserves free-text behavior for search selects without labels', () => {
  const view = createSelector();
  expect(view.input.value).toBe('chair-id');
  view.setSearchQuery(' new-script ');
  expect(view.onInput).toHaveBeenLastCalledWith(' new-script ');
  view.input.dispatch('keydown', 'Enter');
  expect(view.onCommit).toHaveBeenLastCalledWith('new-script');
  expect(view.input.value).toBe('new-script');
});
