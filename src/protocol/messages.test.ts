import { describe, expect, it } from 'vitest';
import { parseClientMessage, parseServerMessage } from './messages.js';

describe('client messages', () => {
  it('accepts input and resize frames', () => {
    expect(parseClientMessage(JSON.stringify({ type: 'input', data: 'hi' }))).toEqual({
      type: 'input',
      data: 'hi',
    });
    expect(parseClientMessage(JSON.stringify({ type: 'resize', cols: 80, rows: 24 }))).toEqual({
      type: 'resize',
      cols: 80,
      rows: 24,
    });
  });

  it('rejects malformed frames', () => {
    expect(parseClientMessage('not-json')).toBeNull();
    expect(
      parseClientMessage(JSON.stringify({ type: 'input', data: 'x'.repeat(8193) })),
    ).toBeNull();
    expect(parseClientMessage(JSON.stringify({ type: 'resize', cols: 0, rows: 24 }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ type: 'resize', cols: 80.5, rows: 24 }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ type: 'exec', command: 'rm' }))).toBeNull();
  });
});

describe('server messages', () => {
  it('accepts terminal, session, and audio frames', () => {
    expect(parseServerMessage(JSON.stringify({ type: 'terminal-data', data: 'ok' }))).toEqual({
      type: 'terminal-data',
      data: 'ok',
    });
    expect(
      parseServerMessage(
        JSON.stringify({ type: 'session-status', status: 'connected', sessionId: 'abc' }),
      ),
    ).toEqual({ type: 'session-status', status: 'connected', sessionId: 'abc' });
    expect(parseServerMessage(JSON.stringify({ type: 'play-sound', assetId: 'door' }))).toEqual({
      type: 'play-sound',
      assetId: 'door',
    });
    expect(parseServerMessage(JSON.stringify({ type: 'stop-sound', assetId: 'door' }))).toEqual({
      type: 'stop-sound',
      assetId: 'door',
    });
  });

  it('rejects unknown or incomplete frames', () => {
    expect(
      parseServerMessage(JSON.stringify({ type: 'session-status', status: 'closed' })),
    ).toBeNull();
    expect(parseServerMessage(JSON.stringify({ type: 'play-sound', assetId: '' }))).toBeNull();
    expect(parseServerMessage('[]')).toBeNull();
  });
});
