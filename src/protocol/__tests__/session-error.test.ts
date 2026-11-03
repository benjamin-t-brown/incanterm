import { expect, it } from 'vitest';
import { encodeMessage, parseServerMessage } from '../messages.js';
import { getSessionErrorText } from '../session-error.js';

it('preserves stack lines while removing terminal controls from error text', () => {
  const details = getSessionErrorText(new Error('Oops\x1b[2J\nsecond line'));
  expect(details).toContain('Oops [2J\nsecond line');
  expect(details).not.toContain('\x1b');
  expect(parseServerMessage(encodeMessage({ type: 'session-error', details }))).toEqual({
    type: 'session-error', details,
  });
});
