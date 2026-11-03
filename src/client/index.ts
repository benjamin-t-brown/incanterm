import { connectGameClient } from './connection.js';
import { matchesViewport, type TerminalViewport } from './viewport.js';
import { formatTerminalError, installTerminalCleanup } from './terminal-cleanup.js';
import { writeSync } from 'node:fs';
import { getSessionErrorText } from '../protocol/session-error.js';

const url = process.argv[2] ?? process.env.INCANTERM_WS_URL ?? 'ws://127.0.0.1:7101/ws';
let stopped = false;
let alternateScreen = false;
let viewport: TerminalViewport | undefined;
let failure: string | undefined;
const restoreTerminal = installTerminalCleanup();

const client = connectGameClient(url, {
  onMessage(message) {
    if (message.type === 'terminal-data') {
      if (!matchesViewport(message, viewport)) return;
      process.stdout.write(message.data);
      return;
    }
    if (message.type === 'session-status') {
      process.stderr.write(`session ${message.sessionId}\n`);
      return;
    }
    if (message.type === 'session-error') {
      failure = getSessionErrorText(message.details);
      return;
    }
    process.stderr.write(`audio ${message.type} ${message.assetId}\n`);
  },
  onOpen() {
    if (process.stdin.isTTY) process.stdin.setRawMode(true);
    if (process.stdout.isTTY) {
      alternateScreen = true;
      process.stdout.write('\x1b[?1049h\x1b[?25l\x1b[?1000h\x1b[?1006h');
    }
    process.stderr.write('Incanterm client. Ctrl-C exits.\n');
    sendResize();
    process.stdin.on('data', onInput);
    process.stdin.resume();
  },
  onError(error) {
    failure = getSessionErrorText(error);
    stop(1);
  },
  onClose() {
    if (stopped) return;
    stop(failure ? 1 : 0);
  },
});

process.stdout.on('resize', sendResize);
process.on('SIGINT', () => stop(130));
process.on('SIGTERM', () => stop(143));

function onInput(chunk: Buffer): void {
  const data = chunk.toString('utf8');
  if (data.includes('\u0003')) {
    stop(0);
    return;
  }
  client.sendInput(data);
}

function sendResize(): void {
  const cols = process.stdout.columns;
  const rows = process.stdout.rows;
  if (!cols || !rows) return;
  viewport = { cols, rows };
  client.resize(cols, rows);
}

function stop(code: number): void {
  if (stopped) return;
  stopped = true;
  if (alternateScreen || process.stdin.isRaw) restoreTerminal();
  if (failure) writeSync(2, `\n${formatTerminalError(`Game session failed:\n${failure}`)}\n`);
  else if (code === 0) writeSync(2, '\nDisconnected.\n');
  process.stdin.pause();
  client.close();
  process.exit(code);
}
