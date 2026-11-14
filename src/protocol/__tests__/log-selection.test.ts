import { expect, it } from 'vitest';
import { encodeMessage, parseServerMessage } from '../messages.js';

it('preserves the selectable Log region on terminal frames', () => {
  const message = { type: 'terminal-data' as const, data: 'frame', cols: 80, rows: 24,
    logSelection: { x: 1, y: 13, width: 78, height: 10 } };
  expect(parseServerMessage(encodeMessage(message))).toEqual(message);
  expect(parseServerMessage(JSON.stringify({ ...message,
    logSelection: { x: -1, y: 13, width: 78, height: 10 } }))).toBeNull();
});
