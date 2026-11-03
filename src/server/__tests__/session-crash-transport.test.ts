import { afterEach, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import { parseServerMessage } from '../../protocol/messages.js';
import { parseRpgScript } from '../../game/rpgscript/__tests__/test-support.js';
import { Prop, Scene } from '../../game/scene.js';
import { Sprite } from '../../game/sprite.js';
import { startHttpServer } from '../http.js';

afterEach(() => vi.restoreAllMocks());

it('logs a missing marker and keeps the WebSocket game session open', async () => {
  const ink = { ch: ' ', fg: { r: 255, g: 255, b: 255 }, bg: { r: 0, g: 0, b: 0 } };
  const scene = new Scene('room', 4, 3, 'regular-z', ink, [], ['entry']);
  const scripts = parseRpgScript('#entry\nload,start\n@start\n+walkToMarker(hero, WrongName)', 'broken.rpgscript');
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
  const server = await startHttpServer({ host: '127.0.0.1', port: 0, scene, scripts });
  const socket = new WebSocket(`ws://127.0.0.1:${server.port}/ws`);
  try {
    const frame = await new Promise<string>((resolve, reject) => {
      socket.on('message', (data) => {
        const message = parseServerMessage(data.toString());
        if (message?.type === 'terminal-data' && message.data.includes('has no marker WrongName'))
          resolve(message.data);
      });
      socket.once('error', reject);
    });
    expect(frame).toContain('[RPGSCRIPT ERROR]');
    expect(errors).not.toHaveBeenCalled();
    expect(socket.readyState).toBe(WebSocket.OPEN);
    const response = await fetch(`http://127.0.0.1:${server.port}/health`);
    expect(response.status).toBe(200);
  } finally {
    socket.terminate();
    await server.close();
  }
});

it('sends a stack trace before closing a crashed session', async () => {
  const ink = { ch: ' ', fg: { r: 255, g: 255, b: 255 }, bg: { r: 0, g: 0, b: 0 } };
  const prop = new Prop('broken', 0, 0, 0, 0, new Sprite('broken', 1, 1, 0, 0, [ink]));
  prop.update = () => { throw new Error('Frame exploded'); };
  const scene = new Scene('room', 4, 3, 'regular-z', ink, [prop]);
  const scripts = parseRpgScript('@start\n+log("unused")', 'unused.rpgscript');
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const server = await startHttpServer({ host: '127.0.0.1', port: 0, scene, scripts });
  const socket = new WebSocket(`ws://127.0.0.1:${server.port}/ws`);
  const received: string[] = [];
  try {
    await new Promise<void>((resolve, reject) => {
      socket.on('message', (data) => {
        const message = parseServerMessage(data.toString());
        if (message?.type === 'session-error') received.push(message.details);
      });
      socket.once('close', resolve);
      socket.once('error', reject);
    });
    expect(received).toHaveLength(1);
    expect(received[0]).toContain('Error: Frame exploded');
    expect(received[0]).toContain('session-crash-transport.test.ts');
    expect((await fetch(`http://127.0.0.1:${server.port}/health`)).status).toBe(200);
  } finally {
    socket.terminate();
    await server.close();
  }
});
