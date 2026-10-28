import { WebSocket } from 'ws';
import { parseServerMessage } from '../protocol/messages.js';

const url = process.argv[2] ?? process.env.INCANTERM_WS_URL ?? 'ws://127.0.0.1:7101/ws';
const socket = new WebSocket(url);
let stopped = false;
let alternateScreen = false;

socket.on('message', (data, isBinary) => {
  if (isBinary) return;
  const message = parseServerMessage(data.toString());
  if (!message) return;
  if (message.type === 'terminal-data') {
    process.stdout.write(message.data);
    return;
  }
  if (message.type === 'session-status') {
    process.stderr.write(`session ${message.sessionId}\n`);
    return;
  }
  process.stderr.write(`audio ${message.type} ${message.assetId}\n`);
});

socket.on('open', () => {
  if (process.stdin.isTTY) process.stdin.setRawMode(true);
  if (process.stdout.isTTY) {
    process.stdout.write('\x1b[?1049h\x1b[?25l');
    alternateScreen = true;
  }
  process.stderr.write('Incanterm client. Ctrl-C exits.\n');
  sendResize();
  process.stdin.on('data', onInput);
  process.stdin.resume();
});

socket.on('error', (error) => {
  process.stderr.write(`Connection failed: ${error.message}\n`);
  stop(1);
});

socket.on('close', () => {
  if (stopped) return;
  process.stderr.write('\nDisconnected.\n');
  stop(0);
});

process.stdout.on('resize', sendResize);

function onInput(chunk: Buffer): void {
  const data = chunk.toString('utf8');
  if (data.includes('\u0003')) {
    stop(0);
    return;
  }
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: 'input', data }));
  }
}

function sendResize(): void {
  const cols = process.stdout.columns;
  const rows = process.stdout.rows;
  if (!cols || !rows || socket.readyState !== WebSocket.OPEN) return;
  socket.send(JSON.stringify({ type: 'resize', cols, rows }));
}

function stop(code: number): void {
  if (stopped) return;
  stopped = true;
  if (alternateScreen) process.stdout.write('\x1b[0m\x1b[?25h\x1b[?7h\x1b[?1049l');
  if (process.stdin.isTTY) process.stdin.setRawMode(false);
  process.stdin.pause();
  if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
    socket.close();
  }
  process.exit(code);
}
