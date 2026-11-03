import { parseServerMessage } from '../protocol/messages.js';
import { TerminalScreen } from '../client/terminal-screen.js';

const screen = getRequiredElement('#screen');
const status = getRequiredElement('#status');
const audio = getRequiredElement('#audio');

let socket: WebSocket | null = null;
let retry: ReturnType<typeof setTimeout> | undefined;
let viewport = { cols: 80, rows: 24 };
const terminal = new TerminalScreen();

screen.addEventListener('pointerdown', (event) => {
  if (event.button !== 0 || socket?.readyState !== WebSocket.OPEN) return;
  const bounds = screen.getBoundingClientRect();
  const style = getComputedStyle(screen);
  const probe = document.createElement('span');
  probe.textContent = 'M';
  screen.append(probe);
  const cellWidth = probe.getBoundingClientRect().width;
  probe.remove();
  const x = Math.floor(
    (event.clientX - bounds.left - parseFloat(style.paddingLeft) + screen.scrollLeft) / cellWidth,
  );
  const y = Math.floor(
    (event.clientY - bounds.top - parseFloat(style.paddingTop) + screen.scrollTop) /
      parseFloat(style.lineHeight),
  );
  if (x < 0 || y < 0 || x >= viewport.cols || y >= viewport.rows) return;
  event.preventDefault();
  socket.send(JSON.stringify({ type: 'input', data: `\x1b[<0;${x + 1};${y + 1}M` }));
});

// Keep the screen between updates; deltas only replace rows containing changed cells.
function renderFrame(data: string): void {
  const dirty = terminal.apply(data, viewport.cols, viewport.rows);
  if (screen.children.length !== viewport.rows) {
    screen.replaceChildren(
      ...Array.from({ length: viewport.rows }, () => document.createElement('span')),
    );
    for (let y = 0; y < viewport.rows; y++) dirty.add(y);
  }
  for (const y of dirty) {
    const row = document.createElement('span');
    let run: HTMLSpanElement | undefined;
    let previousColor = '';
    for (let x = 0; x < viewport.cols; x++) {
      const cell = terminal.buffer.get(x, y);
      const fg = `rgb(${cell.fg.r},${cell.fg.g},${cell.fg.b})`;
      const bg = `rgb(${cell.bg.r},${cell.bg.g},${cell.bg.b})`;
      if (!run || previousColor !== `${fg}/${bg}`) {
        run = document.createElement('span');
        run.style.color = fg;
        run.style.backgroundColor = bg;
        row.append(run);
        previousColor = `${fg}/${bg}`;
      }
      run.textContent += cell.ch;
    }
    if (y < viewport.rows - 1) row.append('\n');
    screen.children[y].replaceWith(row);
  }
}

window.addEventListener('keydown', (event) => {
  if (!socket || socket.readyState !== WebSocket.OPEN) return;
  const data = keyToInput(event);
  if (data === null) return;
  event.preventDefault();
  socket.send(JSON.stringify({ type: 'input', data }));
});

connect();

function getRequiredElement(selector: string): HTMLElement {
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
      viewport = { cols: message.cols ?? viewport.cols, rows: message.rows ?? viewport.rows };
      renderFrame(message.data);
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
