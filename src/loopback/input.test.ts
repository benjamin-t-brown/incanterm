import { describe, expect, it } from 'vitest';
import { routeLoopbackInput } from './input.js';

describe('loopback terminal input', () => {
  it('switches screens without sending the hotkey to the game', () => {
    expect(routeLoopbackInput('~', 'client')).toEqual({ screen: 'server' });
    expect(routeLoopbackInput('x', 'server')).toEqual({ screen: 'server' });
    expect(routeLoopbackInput('~', 'server')).toEqual({ screen: 'client' });
    expect(routeLoopbackInput(' ', 'client')).toEqual({ screen: 'client', forward: ' ' });
  });

  it('leaves escape sequences intact and accepts Ctrl-C from either screen', () => {
    expect(routeLoopbackInput('\x1b[3~', 'client')).toEqual({
      screen: 'client',
      forward: '\x1b[3~',
    });
    expect(routeLoopbackInput('\x03', 'server')).toEqual({ screen: 'server', quit: true });
  });
});
