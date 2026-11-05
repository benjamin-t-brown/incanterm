import path from 'node:path';
import { matchesViewport, type TerminalViewport } from '../client/viewport.js';
import type { ServerMessage } from '../protocol/messages.js';
import { routeLoopbackInput } from './input.js';
import { startLoopback, type Loopback } from './start.js';
import { TerminalScreen } from '../client/terminal-screen.js';
import { encodeTerminal } from '../game/terminal.js';
import { formatTerminalError, installTerminalCleanup, TERMINAL_POINTER } from '../client/terminal-cleanup.js';
import { getSessionErrorText } from '../protocol/session-error.js';

function parseOptionsFromArgs(args: string[]): {
  sceneId?: string;
  assetsRoot?: string;
} {
  const options: { sceneId?: string; assetsRoot?: string } = {};
  for (let i = 0; i < args.length; i += 2) {
    const value = args[i + 1];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${args[i]}`);
    if (args[i] === '--scene') options.sceneId = value;
    else if (args[i] === '--assets') options.assetsRoot = path.resolve(value);
    else throw new Error(`Unknown option ${args[i]}`);
  }
  return options;
}

if (!process.stdin.isTTY || !process.stdout.isTTY) {
  console.error('Loopback mode needs an interactive terminal.');
  process.exitCode = 1;
} else {
  const restoreTerminal = installTerminalCleanup();
  let loopback: Loopback | undefined;
  let latestFrame = '';
  const terminal = new TerminalScreen();
  let screen: 'client' | 'server' = 'client';
  let sessionId = 'connecting';
  let failure: string | undefined;
  let frames = 0;
  let closing = false;
  let started = false;
  let viewport: TerminalViewport | undefined;
  const events: string[] = [];

  function log(event: string): void {
    events.push(event);
    if (events.length > 40) events.shift();
    if (screen === 'server') showServer();
  }

  function showServer(): void {
    if (!loopback) return;
    const cols = Math.max(1, process.stdout.columns ?? 80);
    const rows = Math.max(1, process.stdout.rows ?? 24);
    const lines = [
      `Incanterm loopback · server view   [~] client   [Ctrl-C] quit`,
      `Scene: ${loopback.sceneId}   Session: ${sessionId}`,
      `HTTP/WebSocket: 127.0.0.1:${loopback.httpPort}   SSH: 127.0.0.1:${loopback.sshPort}`,
      `Frames sent: ${frames}`,
      '',
      'Events:',
      ...events.slice(-Math.max(0, rows - 7)),
    ];
    process.stdout.write(
      `\x1b[2J\x1b[H${lines
        .slice(0, rows)
        .map((line) => line.slice(0, cols))
        .join('\r\n')}`,
    );
  }

  function onMessage(message: ServerMessage): void {
    if (message.type === 'terminal-data') {
      if (!matchesViewport(message, viewport)) return;
      terminal.apply(message.data, message.cols ?? 80, message.rows ?? 24);
      latestFrame = encodeTerminal(terminal.buffer);
      frames++;
      if (screen === 'client' && started) process.stdout.write(message.data);
      else showServer();
    } else if (message.type === 'session-status') {
      sessionId = message.sessionId;
      log(`Session ${sessionId} connected`);
    } else if (message.type === 'session-error') {
      failure = getSessionErrorText(message.details);
    } else {
      log(`${message.type}: ${message.assetId}`);
    }
  }

  function onInput(chunk: Buffer): void {
    const data = chunk.toString('utf8');
    const next = routeLoopbackInput(data, screen);
    if (next.quit) {
      void stop();
    } else if (next.screen !== screen) {
      screen = next.screen;
      if (screen === 'server') showServer();
      else process.stdout.write(`\x1b[2J\x1b[H${latestFrame || 'Waiting for game frame…'}`);
    } else if (next.forward) {
      loopback?.sendInput(next.forward);
      log(`Input ${JSON.stringify(next.forward)}`);
    }
  }

  function onResize(): void {
    const cols = process.stdout.columns;
    const rows = process.stdout.rows;
    if (!cols || !rows) return;
    if (viewport?.cols !== cols || viewport.rows !== rows) {
      viewport = { cols, rows };
      latestFrame = '';
      if (screen === 'client' && started) process.stdout.write('\x1b[2J\x1b[HResizing game…');
      loopback?.resize(cols, rows);
    }
    if (screen === 'server') showServer();
  }

  async function stop(code = 0): Promise<void> {
    if (closing) return;
    closing = true;
    process.stdin.off('data', onInput);
    process.stdout.off('resize', onResize);
    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);
    restoreTerminal();
    process.stdin.pause();
    if (failure) console.error(`\n${formatTerminalError(`Game session failed:\n${failure}`)}`);
    try {
      await loopback?.close();
    } finally {
      process.exitCode = code;
    }
  }

  function onSignal(): void {
    void stop();
  }

  try {
    const options = parseOptionsFromArgs(process.argv.slice(2));
    loopback = await startLoopback({
      ...options,
      onMessage,
      onDisconnect() {
        if (!closing) void stop(1);
      },
      onError(error) {
        failure = getSessionErrorText(error);
        void stop(1);
      },
    });
    if (closing) throw new Error('Game session closed during startup');
    started = true;
    process.stdout.write(`\x1b[?1049h\x1b[?25l\x1b[?1000h\x1b[?1006h${TERMINAL_POINTER}`);
    process.stdin.setRawMode(true);
    process.stdin.on('data', onInput);
    process.stdin.resume();
    process.stdout.on('resize', onResize);
    process.on('SIGINT', onSignal);
    process.on('SIGTERM', onSignal);
    onResize();
    process.stdout.write(latestFrame || 'Waiting for game frame…');
  } catch (error) {
    restoreTerminal();
    console.error(error);
    process.exitCode = 1;
  }
}
