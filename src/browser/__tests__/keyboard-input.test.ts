import { expect, it } from 'vitest';
import { CANCEL_UI_AND_OPEN_LOG_INPUT } from '../../protocol/input.js';
import { getKeyboardInput } from '../keyboard-input.js';

const plainEvent = { key: '', code: '', ctrlKey: false, metaKey: false, altKey: false, shiftKey: false };

it.each([
  { key: '~', code: 'Backquote' },
  { key: '`', code: 'Backquote' },
  { key: 'Dead', code: 'Backquote' },
  { key: '~', code: '' },
])('encodes the emergency shortcut for %j', (event) => {
  expect(getKeyboardInput({ ...plainEvent, ...event, ctrlKey: true })).toBe(CANCEL_UI_AND_OPEN_LOG_INPUT);
});

it.each(['~', '`'])('preserves unmodified %s', (key) => {
  expect(getKeyboardInput({ ...plainEvent, key, code: 'Backquote' })).toBe(key);
});

it('encodes reverse game panel navigation when game controls have captured Shift+Tab', () => {
  expect(getKeyboardInput({ ...plainEvent, key: 'Tab', shiftKey: true })).toBe('\x1b[Z');
});

it.each([
  { key: '~', ctrlKey: false, metaKey: true },
  { key: '~', ctrlKey: true, altKey: true },
  { key: '~', ctrlKey: true, metaKey: true },
  { key: 'a', code: 'KeyA', ctrlKey: true },
])('ignores unrelated modifier combinations: %j', (event) => {
  expect(getKeyboardInput({ ...plainEvent, ...event })).toBeNull();
});

it.each([
  ['Enter', '\r'], ['Backspace', '\x7f'], ['Tab', '\t'],
  ['ArrowUp', '\x1b[A'], ['ArrowDown', '\x1b[B'],
  ['ArrowRight', '\x1b[C'], ['ArrowLeft', '\x1b[D'], ['a', 'a'], ['Escape', null],
])('preserves keyboard input for %s', (key, expected) => {
  expect(getKeyboardInput({ ...plainEvent, key })).toBe(expected);
});
