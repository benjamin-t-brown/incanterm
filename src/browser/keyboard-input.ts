import { CANCEL_UI_AND_OPEN_LOG_INPUT } from '../protocol/input.js';

type KeyboardInputEvent = {
  key: string;
  code: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
};

export function getKeyboardInput(event: KeyboardInputEvent): string | null {
  if (event.ctrlKey && !event.metaKey && !event.altKey &&
    (event.code === 'Backquote' || event.key === '~' || event.key === '`'))
    return CANCEL_UI_AND_OPEN_LOG_INPUT;
  if (event.ctrlKey || event.metaKey || event.altKey) return null;
  if (event.key === 'Enter') return '\r';
  if (event.key === 'Backspace') return '\x7f';
  if (event.key === 'Tab') return event.shiftKey ? '\x1b[Z' : '\t';
  if (event.key === 'ArrowUp') return '\x1b[A';
  if (event.key === 'ArrowDown') return '\x1b[B';
  if (event.key === 'ArrowRight') return '\x1b[C';
  if (event.key === 'ArrowLeft') return '\x1b[D';
  if (event.key.length === 1) return event.key;
  return null;
}
