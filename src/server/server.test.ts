import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Client as SshClient, ClientChannel } from 'ssh2';
import { Client } from './ssh2.js';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { parseServerMessage } from '../protocol/messages.js';
import { generateHostKey } from './host-key.js';
import { startServer, type StartedServer } from './start.js';

const hostKey = generateHostKey();

describe('game server', () => {
  let server: StartedServer | undefined;

  afterEach(async () => {
    await server?.close();
    server = undefined;
  });

  it('answers health checks', async () => {
    server = await start();
    const response = await fetch(`http://127.0.0.1:${server.httpPort}/health`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });

  it('sends the test scene to a WebSocket client', async () => {
    server = await start();
    const socket = new WebSocket(`ws://127.0.0.1:${server.httpPort}/ws`);
    try {
      const messages = messageQueue(socket);
      await waitForOpen(socket);
      const status = parseServerMessage(await messages.next());
      expect(status?.type).toBe('session-status');
      const welcome = parseServerMessage(await messages.next());
      expect(welcome?.type).toBe('terminal-data');
      if (welcome?.type === 'terminal-data') expect(visibleText(welcome.data)).toContain('+---+');

      socket.send(JSON.stringify({ type: 'input', data: 'hi' }));
      socket.send('not-json');
      socket.send(JSON.stringify({ type: 'resize', cols: 40, rows: 16 }));
      const resized = parseServerMessage(await messages.next());
      expect(resized?.type).toBe('terminal-data');
      if (resized?.type === 'terminal-data') {
        const text = visibleText(resized.data);
        expect(text).toContain('| # |');
        expect(text).not.toContain('hi');
      }
    } finally {
      socket.close();
    }
  });

  it('sends the test scene to an SSH shell', async () => {
    server = await start();
    const connection = new Client();
    try {
      await connect(connection, server.sshPort);
      const stream = await shell(connection);
      const frame = await readUntil(stream, (text) => visibleText(text).includes('| # |'));
      expect(visibleText(frame)).toContain('+---+');
    } finally {
      connection.end();
    }
  });

  it('serves the built browser client from /play', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'incanterm-'));
    try {
      await fs.writeFile(path.join(root, 'index.html'), '<!doctype html><title>Incanterm</title>');
      server = await start(root);
      const response = await fetch(`http://127.0.0.1:${server.httpPort}/play`);
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('text/html');
      expect(await response.text()).toContain('<title>Incanterm</title>');
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});

function visibleText(value: string): string {
  const csi = new RegExp(`${String.fromCharCode(0x1b)}\\[[0-9;?]*[A-Za-z]`, 'g');
  return value.replace(csi, '');
}

function start(staticRoot?: string): Promise<StartedServer> {
  return startServer({ host: '127.0.0.1', httpPort: 0, sshPort: 0, hostKey, staticRoot });
}

function waitForOpen(socket: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.once('open', () => resolve());
    socket.once('error', reject);
  });
}

function messageQueue(socket: WebSocket): { next: () => Promise<string> } {
  const pending: string[] = [];
  let waiter: ((value: string) => void) | undefined;
  socket.on('message', (data) => {
    const text = data.toString();
    if (waiter) {
      const resolve = waiter;
      waiter = undefined;
      resolve(text);
      return;
    }
    pending.push(text);
  });
  return {
    next() {
      const queued = pending.shift();
      if (queued !== undefined) return Promise.resolve(queued);
      return new Promise((resolve) => {
        waiter = resolve;
      });
    },
  };
}

function connect(connection: SshClient, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    connection.once('ready', () => resolve());
    connection.once('error', reject);
    connection.connect({
      host: '127.0.0.1',
      port,
      username: 'player',
      password: 'incanterm',
      readyTimeout: 5000,
      hostVerifier: () => true,
    });
  });
}

function shell(connection: SshClient): Promise<ClientChannel> {
  return new Promise((resolve, reject) => {
    connection.shell((error, channel) => {
      if (error || !channel) reject(error ?? new Error('SSH shell was not opened'));
      else resolve(channel);
    });
  });
}

function readUntil(stream: ClientChannel, done: (text: string) => boolean): Promise<string> {
  return new Promise((resolve, reject) => {
    let text = '';
    const timer = setTimeout(() => {
      reject(new Error(`Timed out waiting for SSH output: ${JSON.stringify(text)}`));
    }, 5000);
    const onData = (chunk: Buffer | string) => {
      text += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
      if (!done(text)) return;
      clearTimeout(timer);
      stream.off('data', onData);
      resolve(text);
    };
    stream.on('data', onData);
  });
}
