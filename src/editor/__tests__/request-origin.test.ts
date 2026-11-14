import { expect, it } from 'vitest';
import { isLocalEditorRequest } from '../request-origin.js';

it.each(['localhost:7104', '127.0.0.1:7104', '[::1]:7104'])(
  'allows local reads from %s',
  (host) => {
    expect(isLocalEditorRequest('GET', host)).toBe(true);
  },
);

it.each([
  ['POST', '127.0.0.1:7104', 'http://127.0.0.1:7104', true],
  ['DELETE', 'localhost:7104', 'http://localhost:7104', true],
  ['POST', 'localhost:7104', undefined, false],
  ['POST', 'localhost:7104', 'null', false],
  ['PUT', 'localhost:7104', 'http://example.com', false],
  ['POST', 'localhost:7104', 'http://localhost:9999', false],
  ['GET', 'attacker.example:7104', undefined, false],
  ['POST', 'attacker.example:7104', 'http://attacker.example:7104', false],
])('checks editor request origin %s %s %s', (method, host, origin, allowed) => {
  expect(isLocalEditorRequest(method, host, origin)).toBe(allowed);
});
