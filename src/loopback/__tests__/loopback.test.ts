import fs from 'node:fs/promises';
import { TerminalScreen } from '../../client/terminal-screen.js';
import { encodeTerminal } from '../../game/terminal.js';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ServerMessage } from '../../protocol/messages.js';
import { createAnimation, createSprite, createCharacter } from '../../editor/schema.js';
import { encodeStoredSprite } from '../../editor/art/sprite-storage.js';
import { loadLoopbackOptions } from '../cli.js';
import { startLoopback, type Loopback } from '../start.js';
import { loadSessionConfig } from '../../project/session-config.js';
import { routeLoopbackInput } from '../input.js';

describe('isolated loopback game', () => {
  let assetsRoot: string | undefined;
  const running: Loopback[] = [];

  afterEach(async () => {
    await Promise.all(running.splice(0).map((loopback) => loopback.close()));
    if (assetsRoot) await fs.rm(assetsRoot, { recursive: true, force: true });
    assetsRoot = undefined;
  });

  async function createFixture(trigger = 'room-entry'): Promise<string> {
    assetsRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'incanterm-loopback-'));
    await fs.mkdir(path.join(assetsRoot, 'scenes'));
    await fs.mkdir(path.join(assetsRoot, 'scripts'));
    await fs.writeFile(
      path.join(assetsRoot, 'scenes', 'e2e-room.json'),
      JSON.stringify({
        format: 'incanterm-scene',
        version: 1,
        id: 'e2e-room',
        label: 'Fixture Room',
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

  function getMessages(): {
    onMessage: (message: ServerMessage) => void;
    next: () => Promise<ServerMessage>;
  } {
    const pending: ServerMessage[] = [];
    const terminal = new TerminalScreen();
    let waiter: ((message: ServerMessage) => void) | undefined;
    return {
      onMessage(message) {
        if (message.type === 'terminal-data') {
          terminal.apply(message.data, message.cols ?? 80, message.rows ?? 24);
          message = { ...message, data: encodeTerminal(terminal.buffer) };
        }
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

  async function getFrameContaining(messages: ReturnType<typeof getMessages>, text: string): Promise<ServerMessage> {
    for (let attempt = 0; attempt < 100; attempt++) {
      const frame = await messages.next();
      if (frame.type === 'terminal-data' && frame.data.includes(text)) return frame;
    }
    throw new Error(`No game frame contained ${text}`);
  }

  it('boots a selected scene and script through the real WebSocket client', async () => {
    const root = await createFixture();
    const first = getMessages();
    const second = getMessages();
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
    const opening = await getFrameContaining(second, 'First');
    expect(opening.type).toBe('terminal-data');
    if (opening.type === 'terminal-data') {
      expect(opening.data).toContain('Guide');
      expect(opening.data).not.toContain('Guide:');
      expect(opening.data).toContain('First');
      expect(opening.data).toContain('\x1b[38;2;0;0;0;48;2;0;0;0m');
    }

    game.sendInput(' ');
    const advanced = await getFrameContaining(first, 'Second');
    expect(advanced.type).toBe('terminal-data');
    if (advanced.type === 'terminal-data') expect(advanced.data).toContain('Second');

    other.resize(40, 16);
    const unchanged = await getFrameContaining(second, 'First');
    expect(unchanged.type).toBe('terminal-data');
    if (unchanged.type === 'terminal-data') {
      expect([unchanged.cols, unchanged.rows]).toEqual([40, 16]);
      expect(unchanged.data.split('\r\n')).toHaveLength(16);
      expect(unchanged.data).toContain('='.repeat(40));
      expect(unchanged.data).toContain('First');
    }
    other.resize(30, 12);
    const tooSmall = await second.next();
    expect(tooSmall.type).toBe('terminal-data');
    if (tooSmall.type === 'terminal-data') {
      expect([tooSmall.cols, tooSmall.rows]).toEqual([30, 12]);
      expect(tooSmall.data).toContain('Terminal needs at least');
    }
    other.resize(120, 40);
    const restored = await getFrameContaining(second, 'First');
    expect(restored.type).toBe('terminal-data');
    if (restored.type === 'terminal-data') {
      expect([restored.cols, restored.rows]).toEqual([120, 40]);
      expect(restored.data.split('\r\n')).toHaveLength(40);
      expect(restored.data).toContain('='.repeat(120));
      expect(restored.data).toContain('First');
    }
    expect((await fetch(`http://127.0.0.1:${game.httpPort}/health`)).status).toBe(200);
  });

  it('boots a scene selected by its label through the real WebSocket client', async () => {
    const root = await createFixture();
    const received = getMessages();
    const game = await startLoopback({
      assetsRoot: root,
      sceneId: 'Fixture Room',
      onMessage: received.onMessage,
    });
    running.push(game);
    expect((await received.next()).type).toBe('session-status');
    const frame = await getFrameContaining(received, 'First');
    expect(frame.type).toBe('terminal-data');
    if (frame.type === 'terminal-data') expect(frame.data).toContain('Guide');
  });

  it.each([
    { name: 'requested.json', requested: true, text: 'Book requested' },
    { name: 'not requested.json', requested: false, text: 'Waiting for request' },
    { name: undefined, requested: undefined, text: 'Waiting for request' },
  ])('runs scene load scripts with variables from $name', async ({ name, requested, text }) => {
    const root = await createFixture();
    await fs.writeFile(
      path.join(root, 'scripts', 'greeting.rpgscript'),
      [
        '#room-entry',
        'load,greeting',
        '@greeting',
        '+^quest.requested=false',
        '+?is(quest.requested):{',
        'Guide: "Book requested"',
        '}',
        '+?else:{',
        'Guide: "Waiting for request"',
        '}',
        '',
      ].join('\n'),
    );
    await fs.writeFile(
      path.join(root, 'session-config.json'),
      JSON.stringify({ dialogueAnimation: { enabled: false } }),
    );
    const args = ['--assets', root, '--scene', 'Fixture Room'];
    const savePath = name === undefined ? undefined : path.join(root, name);
    const save = JSON.stringify({ v: 1, vars: { 'quest.requested': requested } });
    if (savePath !== undefined) {
      await fs.writeFile(savePath, save);
      args.push('--save', savePath);
    }
    const received = getMessages();
    const game = await startLoopback({
      ...(await loadLoopbackOptions(args)),
      onMessage: received.onMessage,
    });
    running.push(game);
    expect((await getFrameContaining(received, text)).type).toBe('terminal-data');
    await game.close();
    if (savePath !== undefined) expect(await fs.readFile(savePath, 'utf8')).toBe(save);
  });

  it('fails before listening if the scene references a missing trigger', async () => {
    const root = await createFixture('missing');
    await expect(
      startLoopback({
        sceneId: 'e2e-room',
        assetsRoot: root,
        onMessage() {},
      }),
    ).rejects.toThrow('Scene e2e-room references unknown RPGScript trigger missing');
  });

  it('does not start a script that the scene did not bind', async () => {
    const root = await createFixture('');
    const received = getMessages();
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

  it('runs configured timer bindings without binding them to the scene', async () => {
    const root = await createFixture('');
    await fs.appendFile(
      path.join(root, 'scripts', 'greeting.rpgscript'),
      '\n#clock\nload,greeting\ntimer,tick,50\n@tick\nGuide: "Session tick"\n',
    );
    await fs.writeFile(
      path.join(root, 'session-config.json'),
      JSON.stringify({ timerTriggers: ['clock'], dialogueAnimation: { enabled: false } }),
    );
    const received = getMessages();
    const game = await startLoopback({
      sceneId: 'e2e-room', assetsRoot: root, onMessage: received.onMessage,
    });
    running.push(game);
    expect((await getFrameContaining(received, 'Session tick')).type).toBe('terminal-data');
  });

  it('runs the project’s unreachable prop hook through the real WebSocket client', async () => {
    const root = await createFixture();
    for (const folder of ['sprites', 'animations', 'characters']) await fs.mkdir(path.join(root, folder));
    const art = createSprite('art', 1, 1);
    art.sprites[0].layers[0].cells[0] = { ch: '@', fg: 'white', bg: 'black' };
    await fs.writeFile(path.join(root, 'sprites', 'art.json'), encodeStoredSprite(art));
    const animation = createAnimation('idle');
    animation.frames = [{ sprite: 'art', index: 0, durationMs: 100 }];
    await fs.writeFile(path.join(root, 'animations', 'idle.json'), JSON.stringify(animation));
    await fs.writeFile(path.join(root, 'characters', 'actor.json'), JSON.stringify({
      ...createCharacter('actor', 'idle'), scriptName: 'Explorer',
    }));
    const sceneFile = path.join(root, 'scenes', 'e2e-room.json');
    const scene = JSON.parse(await fs.readFile(sceneFile, 'utf8')) as Record<string, unknown>;
    scene.blockedCells = [2, 7, 12];
    scene.entities = [
      { id: 'hero', type: 'Character', character: 'actor', x: 0, y: 1, z: 0, facing: 'down', state: 'idle' },
      { id: 'sign', type: 'Prop', sprite: 'art', actionScript: 'readSign', x: 4, y: 1, z: 0 },
    ];
    await fs.writeFile(sceneFile, JSON.stringify(scene));
    await fs.writeFile(path.join(root, 'scripts', 'greeting.rpgscript'), `
#room-entry
load,start
@start
  +setPlayerWalkCh(hero)
@readSign
  +log("Read the sign")
@reportBlocked(instance)
  +setConv()
  player: "Can't get to [instance]."
  +endConv()
`);
    await fs.writeFile(path.join(root, 'session-config.json'), JSON.stringify({
      dialogueAnimation: { enabled: false }, scriptHooks: { propUnreachable: 'reportBlocked' },
    }));
    const received = getMessages();
    const game = await startLoopback({ sceneId: 'e2e-room', assetsRoot: root, onMessage: received.onMessage });
    running.push(game);
    game.sendInput('\r');
    const frame = await getFrameContaining(received, "Can't get to sign.");
    expect(frame).toMatchObject({ type: 'terminal-data', data: expect.stringContaining('Explorer') });
  });

  it.each([
    { timerTriggers: 'room-entry', error: 'timerTriggers must be an array' },
    { timerTriggers: [' '], error: 'timerTriggers must be an array' },
    { timerTriggers: ['missing'], error: 'unknown RPGScript trigger missing' },
    { timerTriggers: ['room-entry'], error: 'room-entry has no timer bindings' },
  ])('rejects invalid session timer triggers: $error', async ({ timerTriggers, error }) => {
    const root = await createFixture();
    await fs.writeFile(path.join(root, 'session-config.json'), JSON.stringify({ timerTriggers }));
    await expect(startLoopback({ sceneId: 'e2e-room', assetsRoot: root, onMessage() {} }))
      .rejects.toThrow(error);
  });

  it('reads dialogue animation settings from the selected assets folder', async () => {
    const root = await createFixture();
    await fs.writeFile(path.join(root, 'session-config.json'), JSON.stringify({
      dialogueAnimation: { enabled: false, stepDurationMs: 12, wordDelayMs: 5 },
    }));
    const received = getMessages();
    const game = await startLoopback({ sceneId: 'e2e-room', assetsRoot: root, onMessage: received.onMessage });
    running.push(game);
    await received.next(); // session status
    const opening = await received.next();
    expect(opening.type).toBe('terminal-data');
    if (opening.type === 'terminal-data') expect(opening.data).toContain('First');
    game.sendInput(' ');
    const next = await received.next();
    if (next.type === 'terminal-data') expect(next.data).toContain('Second');
  });

  it('rejects invalid dialogue settings before starting the server', async () => {
    const root = await createFixture();
    await fs.writeFile(path.join(root, 'session-config.json'), '{"dialogueAnimation":{"stepDurationMs":0}}');
    await expect(startLoopback({ sceneId: 'e2e-room', assetsRoot: root, onMessage() {} }))
      .rejects.toThrow('stepDurationMs must be a positive number');
    await fs.writeFile(path.join(root, 'session-config.json'), '{"dialogueAnimation":{"shortGrowthSequences":["abc"]}}');
    await expect(startLoopback({ sceneId: 'e2e-room', assetsRoot: root, onMessage() {} }))
      .rejects.toThrow('shortGrowthSequences must contain four-character strings');
  });

  it('reads portrait timing independently and rejects invalid row delays', async () => {
    const root = await createFixture();
    const portraitAnimation = { enabled: true, stepDurationMs: 33, rowDelayMs: 8.25 };
    await fs.writeFile(path.join(root, 'session-config.json'), JSON.stringify({ portraitAnimation }));
    expect(await loadSessionConfig(root)).toEqual({ portraitAnimation });
    await fs.writeFile(path.join(root, 'session-config.json'), '{"portraitAnimation":{"rowDelayMs":-1}}');
    await expect(startLoopback({ sceneId: 'e2e-room', assetsRoot: root, onMessage() {} }))
      .rejects.toThrow('portraitAnimation.rowDelayMs must be a nonnegative number');
  });

  it('reads custom character growth sequences from the session config', async () => {
    const root = await createFixture();
    await fs.writeFile(path.join(root, 'session-config.json'), JSON.stringify({
      dialogueAnimation: { growthSequences: ['ABCD'], shortGrowthSequences: ['wxyz'] },
    }));
    const received = getMessages();
    const game = await startLoopback({ sceneId: 'e2e-room', assetsRoot: root, onMessage: received.onMessage });
    running.push(game);
    await received.next(); // session status
    const opening = await received.next();
    if (opening.type === 'terminal-data') expect(opening.data).toContain('AAwwA');
  });

  it('dispatches later scene-load triggers after an earlier dialogue finishes', async () => {
    const root = await createFixture();
    const sceneFile = path.join(root, 'scenes', 'e2e-room.json');
    const scene = JSON.parse(await fs.readFile(sceneFile, 'utf8')) as Record<string, unknown>;
    scene.triggers = ['room-entry', 'after-entry'];
    await fs.writeFile(sceneFile, JSON.stringify(scene));
    await fs.appendFile(
      path.join(root, 'scripts', 'greeting.rpgscript'),
      '\n#after-entry\nload,followup\n@followup\nGuide: "Third"\n',
    );
    const received = getMessages();
    const game = await startLoopback({
      sceneId: 'e2e-room',
      assetsRoot: root,
      onMessage: received.onMessage,
    });
    running.push(game);
    await received.next(); // session status
    await getFrameContaining(received, 'First');
    game.sendInput(' ');
    const second = await getFrameContaining(received, 'Second');
    if (second.type === 'terminal-data') expect(second.data).toContain('Second');
    game.sendInput(' ');
    const third = await getFrameContaining(received, 'Third');
    expect(third.type).toBe('terminal-data');
    if (third.type === 'terminal-data') expect(third.data).toContain('Third');
  });

  it('keeps the dialogue overlay visible through tab input and resizing', async () => {
    const root = await createFixture();
    const received = getMessages();
    const game = await startLoopback({
      sceneId: 'e2e-room',
      assetsRoot: root,
      onMessage: received.onMessage,
    });
    running.push(game);
    await received.next(); // session status
    const opening = await getFrameContaining(received, 'First');
    if (opening.type === 'terminal-data') {
      expect(opening.data).toContain('╔═══════╗');
      expect(opening.data).toContain('Guide');
      expect(opening.data).toContain('First');
      expect(opening.data).not.toContain('Inventory');
    }

    game.sendInput('\t');
    game.resize(80, 24); // Request a snapshot: changing a hidden tab emits no delta.
    const hiddenTab = await getFrameContaining(received, 'First');
    if (hiddenTab.type === 'terminal-data') {
      expect(hiddenTab.data).not.toContain('Inventory');
      expect(hiddenTab.data).toContain('First');
    }
    game.resize(40, 16);
    const small = await getFrameContaining(received, 'First');
    if (small.type === 'terminal-data') {
      expect(small.data).toContain('First');
      expect(small.data).not.toContain('Inventory');
    }
    game.sendInput('\x1b[Z');
    game.resize(40, 16);
    const log = await getFrameContaining(received, 'First');
    if (log.type === 'terminal-data') expect(log.data).toContain('First');
    game.sendInput(' ');
    const advanced = await getFrameContaining(received, 'Second');
    if (advanced.type === 'terminal-data') expect(advanced.data).toContain('Second');
    game.sendInput(' ');
    const finished = await getFrameContaining(received, 'Inventory');
    if (finished.type === 'terminal-data') expect(finished.data).toContain('Inventory');
  });

  it.each(['\x00', '\x1e'])('opens an obscured error log through terminal input %j', async (key) => {
    const root = await createFixture();
    await fs.writeFile(
      path.join(root, 'scripts', 'greeting.rpgscript'),
      '#room-entry\nload,greeting\n@greeting\n+setConv()\n+bad={missing}+1\n+log("UNREACHABLE")',
    );
    const received = getMessages();
    const game = await startLoopback({
      sceneId: 'e2e-room', assetsRoot: root, onMessage: received.onMessage,
    });
    running.push(game);
    expect((await received.next()).type).toBe('session-status');
    const opening = await received.next();
    expect(opening.type).toBe('terminal-data');
    if (opening.type === 'terminal-data') {
      expect(opening.logSelection).toBeUndefined();
      expect(opening.data).not.toContain('[RPGSCRIPT ERROR]');
    }
    const routed = routeLoopbackInput(Buffer.from(key).toString('utf8'), 'client');
    expect(routed.forward).toBe(key);
    game.sendInput(routed.forward ?? '');
    const frame = await getFrameContaining(received, '[RPGSCRIPT ERROR]');
    if (frame.type === 'terminal-data') {
      expect(frame.logSelection).toBeDefined();
      expect(frame.data).not.toContain('UNREACHABLE');
    }
  });

  it('toggles the large log window with a plain backtick through the real terminal client', async () => {
    const root = await createFixture();
    await fs.writeFile(
      path.join(root, 'scripts', 'greeting.rpgscript'),
      '#room-entry\nload,greeting\n@greeting\n+log("Diagnostic entry")\n+setConv()\nGuide: "First"\nGuide: "Second"',
    );
    const received = getMessages();
    const game = await startLoopback({
      sceneId: 'e2e-room', assetsRoot: root, onMessage: received.onMessage,
    });
    running.push(game);
    await received.next(); // session status
    await getFrameContaining(received, 'First');
    const routed = routeLoopbackInput('`', 'client');
    expect(routed.forward).toBe('`');
    game.sendInput(routed.forward ?? '');
    const log = await getFrameContaining(received, 'Diagnostic entry');
    if (log.type === 'terminal-data') {
      expect(log.data).toContain('Log | ` to return');
      expect(log.data).not.toContain('First');
      expect(log.logSelection?.height).toBe(20);
    }
    game.sendInput('`');
    const restored = await getFrameContaining(received, 'First');
    if (restored.type === 'terminal-data') {
      expect(restored.data).not.toContain('Diagnostic entry');
      expect(restored.data).not.toContain('Second');
      expect(restored.logSelection).toBeUndefined();
    }
  });

  it('loads a named sprite-sheet portrait through the server and shows it beside dialogue', async () => {
    const root = await createFixture();
    await fs.mkdir(path.join(root, 'sprites'));
    const sprite = createSprite('face', 3, 2);
    sprite.sprites[0].layers[0].cells[0] = { ch: 'P', fg: 'white', bg: 'black' };
    await fs.writeFile(path.join(root, 'sprites', 'face.json'), encodeStoredSprite(sprite));
    await fs.mkdir(path.join(root, 'characters'));
    await fs.writeFile(path.join(root, 'characters', 'guide.json'), JSON.stringify({
      ...createCharacter('guide', 'idle'), scriptName: 'Guide',
      portraits: [{ facing: 'right', emotion: '', portrait: 'face_0' }],
    }));
    await fs.writeFile(
      path.join(root, 'scripts', 'greeting.rpgscript'),
       '#room-entry\nload,greeting\n@greeting\n+setConv()\nGuide: "Hello"',
    );
    const received = getMessages();
    const game = await startLoopback({
      sceneId: 'e2e-room',
      assetsRoot: root,
      onMessage: received.onMessage,
    });
    running.push(game);
    await received.next();
    const opening = await getFrameContaining(received, 'Hello');
    expect(opening.type).toBe('terminal-data');
    if (opening.type === 'terminal-data') {
      expect(opening.data).toContain('╭───╮');
      expect(opening.data).toContain('P');
      expect(opening.data).toContain('Guide');
      expect(opening.data).toContain('Hello');
    }
    game.resize(40, 16);
    const small = await getFrameContaining(received, 'Hello');
    if (small.type === 'terminal-data') {
      expect(small.data).toContain('P');
      expect(small.data).toContain('Hello');
    }
  });
});
