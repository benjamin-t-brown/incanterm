import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ServerMessage } from '../protocol/messages.js';
import { createSprite } from '../editor/schema.js';
import { encodeStoredSprite } from '../editor/art/sprite-storage.js';
import { startLoopback, type Loopback } from './start.js';

describe('isolated loopback game', () => {
  let assetsRoot: string | undefined;
  const running: Loopback[] = [];

  afterEach(async () => {
    await Promise.all(running.splice(0).map((loopback) => loopback.close()));
    if (assetsRoot) await fs.rm(assetsRoot, { recursive: true, force: true });
    assetsRoot = undefined;
  });

  async function fixture(trigger = 'room-entry'): Promise<string> {
    assetsRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'incanterm-loopback-'));
    await fs.mkdir(path.join(assetsRoot, 'scenes'));
    await fs.mkdir(path.join(assetsRoot, 'scripts'));
    await fs.writeFile(
      path.join(assetsRoot, 'scenes', 'e2e-room.json'),
      JSON.stringify({
        format: 'incanterm-scene',
        version: 1,
        id: 'e2e-room',
        width: 5,
        height: 3,
        depthMode: 'regular-z',
        clear: { ch: '.', fg: '#ffffff', bg: '#000000' },
        entities: [],
        triggers: trigger ? [trigger] : [],
      }),
    );
    await fs.writeFile(
      path.join(assetsRoot, 'scripts', 'greeting.rpgscript'),
      '#room-entry\nload,greeting\n@greeting\nGuide: "First"\nGuide: "Second"\n',
    );
    return assetsRoot;
  }

  function messages(): {
    onMessage: (message: ServerMessage) => void;
    next: () => Promise<ServerMessage>;
  } {
    const pending: ServerMessage[] = [];
    let waiter: ((message: ServerMessage) => void) | undefined;
    return {
      onMessage(message) {
        if (waiter) {
          const resolve = waiter;
          waiter = undefined;
          resolve(message);
        } else pending.push(message);
      },
      next() {
        const queued = pending.shift();
        if (queued) return Promise.resolve(queued);
        return new Promise<ServerMessage>((resolve, reject) => {
          const timer = setTimeout(() => {
            waiter = undefined;
            reject(new Error('Timed out waiting for game frame'));
          }, 2000);
          timer.unref();
          waiter = (message) => {
            clearTimeout(timer);
            resolve(message);
          };
        });
      },
    };
  }

  it('boots a selected scene and script through the real WebSocket client', async () => {
    const root = await fixture();
    const first = messages();
    const second = messages();
    const game = await startLoopback({
      sceneId: 'e2e-room',
      assetsRoot: root,
      onMessage: first.onMessage,
    });
    running.push(game);
    const other = await startLoopback({
      sceneId: 'e2e-room',
      assetsRoot: root,
      onMessage: second.onMessage,
    });
    running.push(other);

    expect(game.httpPort).not.toBe(other.httpPort);
    expect(game.sshPort).not.toBe(other.sshPort);
    expect((await first.next()).type).toBe('session-status');
    expect((await second.next()).type).toBe('session-status');
    expect((await first.next()).type).toBe('terminal-data');
    const opening = await second.next();
    expect(opening.type).toBe('terminal-data');
    if (opening.type === 'terminal-data') {
      expect(opening.data).toContain('Guide: First');
      expect(opening.data).toContain('\x1b[38;2;0;0;0;48;2;0;0;0m');
    }

    game.sendInput(' ');
    const advanced = await first.next();
    expect(advanced.type).toBe('terminal-data');
    if (advanced.type === 'terminal-data') expect(advanced.data).toContain('Guide: Second');

    other.resize(40, 16);
    const unchanged = await second.next();
    expect(unchanged.type).toBe('terminal-data');
    if (unchanged.type === 'terminal-data') {
      expect([unchanged.cols, unchanged.rows]).toEqual([40, 16]);
      expect(unchanged.data.split('\r\n')).toHaveLength(16);
      expect(unchanged.data).toContain('='.repeat(40));
      expect(unchanged.data).toContain('Guide: First');
    }
    other.resize(30, 12);
    const tooSmall = await second.next();
    expect(tooSmall.type).toBe('terminal-data');
    if (tooSmall.type === 'terminal-data') {
      expect([tooSmall.cols, tooSmall.rows]).toEqual([30, 12]);
      expect(tooSmall.data).toContain('Terminal needs at least');
    }
    other.resize(120, 40);
    const restored = await second.next();
    expect(restored.type).toBe('terminal-data');
    if (restored.type === 'terminal-data') {
      expect([restored.cols, restored.rows]).toEqual([120, 40]);
      expect(restored.data.split('\r\n')).toHaveLength(40);
      expect(restored.data).toContain('='.repeat(120));
      expect(restored.data).toContain('Guide: First');
    }
    expect((await fetch(`http://127.0.0.1:${game.httpPort}/health`)).status).toBe(200);
  });

  it('fails before listening if the scene references a missing trigger', async () => {
    const root = await fixture('missing');
    await expect(
      startLoopback({
        sceneId: 'e2e-room',
        assetsRoot: root,
        onMessage() {},
      }),
    ).rejects.toThrow('Scene e2e-room references unknown RPGScript trigger missing');
  });

  it('does not start a script that the scene did not bind', async () => {
    const root = await fixture('');
    const received = messages();
    const game = await startLoopback({
      sceneId: 'e2e-room',
      assetsRoot: root,
      onMessage: received.onMessage,
    });
    running.push(game);
    await received.next(); // session status
    const frame = await received.next();
    expect(frame.type).toBe('terminal-data');
    if (frame.type === 'terminal-data') {
      expect(frame.data).toContain('\x1b[38;2;0;0;0;48;2;0;0;0m');
      expect(frame.data).not.toContain('Guide: First');
    }
  });

  it('dispatches later scene-load triggers after an earlier dialogue finishes', async () => {
    const root = await fixture();
    const sceneFile = path.join(root, 'scenes', 'e2e-room.json');
    const scene = JSON.parse(await fs.readFile(sceneFile, 'utf8')) as Record<string, unknown>;
    scene.triggers = ['room-entry', 'after-entry'];
    await fs.writeFile(sceneFile, JSON.stringify(scene));
    await fs.appendFile(
      path.join(root, 'scripts', 'greeting.rpgscript'),
      '\n#after-entry\nload,followup\n@followup\nGuide: "Third"\n',
    );
    const received = messages();
    const game = await startLoopback({
      sceneId: 'e2e-room',
      assetsRoot: root,
      onMessage: received.onMessage,
    });
    running.push(game);
    await received.next(); // session status
    await received.next(); // First
    game.sendInput(' ');
    const second = await received.next();
    if (second.type === 'terminal-data') expect(second.data).toContain('Guide: Second');
    game.sendInput(' ');
    const third = await received.next();
    expect(third.type).toBe('terminal-data');
    if (third.type === 'terminal-data') expect(third.data).toContain('Guide: Third');
  });

  it('keeps the dialogue overlay visible through tab input and resizing', async () => {
    const root = await fixture();
    const received = messages();
    const game = await startLoopback({
      sceneId: 'e2e-room',
      assetsRoot: root,
      onMessage: received.onMessage,
    });
    running.push(game);
    await received.next(); // session status
    const opening = await received.next();
    if (opening.type === 'terminal-data') {
      expect(opening.data).toContain('╔═════════');
      expect(opening.data).toContain('Guide: First');
      expect(opening.data).not.toContain('Inventory');
    }

    game.sendInput('\t');
    const hiddenTab = await received.next();
    if (hiddenTab.type === 'terminal-data') {
      expect(hiddenTab.data).not.toContain('Inventory');
      expect(hiddenTab.data).toContain('Guide: First');
    }
    game.resize(40, 16);
    const small = await received.next();
    if (small.type === 'terminal-data') {
      expect(small.data).toContain('Guide: First');
      expect(small.data).not.toContain('Inventory');
    }
    game.sendInput('\x1b[Z');
    const log = await received.next();
    if (log.type === 'terminal-data') expect(log.data).toContain('Guide: First');
    game.sendInput(' ');
    const advanced = await received.next();
    if (advanced.type === 'terminal-data') expect(advanced.data).toContain('Guide: Second');
    game.sendInput(' ');
    const finished = await received.next();
    if (finished.type === 'terminal-data') expect(finished.data).toContain('Inventory');
  });

  it('loads a named sprite-sheet portrait through the server and shows it beside dialogue', async () => {
    const root = await fixture();
    await fs.mkdir(path.join(root, 'sprites'));
    const sprite = createSprite('face', 3, 2);
    sprite.sprites[0].layers[0].cells[0] = { ch: 'P', fg: 'white', bg: 'black' };
    await fs.writeFile(path.join(root, 'sprites', 'face.json'), encodeStoredSprite(sprite));
    await fs.writeFile(
      path.join(root, 'scripts', 'greeting.rpgscript'),
      '#room-entry\nload,greeting\n@greeting\n+setConv(face_0)\nGuide: "Hello"',
    );
    const received = messages();
    const game = await startLoopback({
      sceneId: 'e2e-room',
      assetsRoot: root,
      onMessage: received.onMessage,
    });
    running.push(game);
    await received.next();
    const opening = await received.next();
    expect(opening.type).toBe('terminal-data');
    if (opening.type === 'terminal-data') {
      expect(opening.data).toContain('┌───┐');
      expect(opening.data).toContain('P');
      expect(opening.data).toContain('Guide: Hello');
    }
    game.resize(40, 16);
    const small = await received.next();
    if (small.type === 'terminal-data') {
      expect(small.data).toContain('P');
      expect(small.data).toContain('Guide: Hello');
    }
  });
});
