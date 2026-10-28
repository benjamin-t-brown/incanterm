import { parseServerMessage } from '../protocol/messages.js';

const screen = requiredElement('#screen');
const status = requiredElement('#status');
const audio = requiredElement('#audio');

let socket: WebSocket | null = null;
let retry: ReturnType<typeof setTimeout> | undefined;

window.addEventListener('keydown', (event) => {
  if (!socket || socket.readyState !== WebSocket.OPEN) return;
  const data = keyToInput(event);
  if (data === null) return;
  event.preventDefault();
  socket.send(JSON.stringify({ type: 'input', data }));
});

connect();

function requiredElement(selector: string): HTMLElement {
  const element = document.querySelector(selector);
  if (!(element instanceof HTMLElement)) {
    throw new Error(`Missing ${selector}`);
  }
  return element;
}

function connect(): void {
  status.textContent = 'Connecting…';
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const next = new WebSocket(`${protocol}//${location.host}/ws`);
  socket = next;

  next.addEventListener('open', () => {
    status.textContent = 'Connected';
    next.send(JSON.stringify({ type: 'resize', cols: 80, rows: 24 }));
  });

  next.addEventListener('message', (event) => {
    const message = parseServerMessage(String(event.data));
    if (!message) return;
    if (message.type === 'terminal-data') {
      screen.textContent += message.data.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
      screen.scrollTop = screen.scrollHeight;
      return;
    }
    if (message.type === 'session-status') {
      status.textContent = `Connected · ${message.sessionId}`;
      return;
    }
    const verb = message.type === 'play-sound' ? 'Playing' : 'Stopped';
    audio.textContent = `${verb} ${message.assetId}`;
  });

  next.addEventListener('close', () => {
    if (socket !== next) return;
    socket = null;
    scheduleReconnect();
  });
}

function scheduleReconnect(): void {
  if (retry !== undefined) return;
  status.textContent = 'Disconnected. Retrying…';
  retry = setTimeout(() => {
    retry = undefined;
    connect();
  }, 1000);
}

function keyToInput(event: KeyboardEvent): string | null {
  if (event.ctrlKey || event.metaKey || event.altKey) return null;
  if (event.key === 'Enter') return '\r';
  if (event.key === 'Backspace') return '\x7f';
  if (event.key === 'Tab') return '\t';
  if (event.key === 'ArrowUp') return '\x1b[A';
  if (event.key === 'ArrowDown') return '\x1b[B';
  if (event.key === 'ArrowRight') return '\x1b[C';
  if (event.key === 'ArrowLeft') return '\x1b[D';
  if (event.key.length === 1) return event.key;
  return null;
}
