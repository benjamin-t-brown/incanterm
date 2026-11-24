import { parseServerMessage, type SelectionRect } from '../protocol/messages.js';
import { TerminalScreen } from '../client/terminal-screen.js';
import { getKeyboardInput } from './keyboard-input.js';
import { getVoiceClipUrl, VoicePlayer } from './voice-player.js';

const screen = getRequiredElement('#screen');
const status = getRequiredElement('#status');
const audio = getRequiredElement('#audio');
const voiceToggle = getRequiredElement('#voice') as HTMLInputElement;
const voice = new VoicePlayer((url) => new Audio(url));
try {
  voiceToggle.checked = localStorage.getItem('incanterm.voice') !== 'off';
} catch { /* Preference storage is optional. */ }
voice.setEnabled(voiceToggle.checked);
voiceToggle.addEventListener('change', () => {
  voice.setEnabled(voiceToggle.checked);
  try {
    localStorage.setItem('incanterm.voice', voiceToggle.checked ? 'on' : 'off');
  } catch { /* The toggle still works for this session. */ }
});

let socket: WebSocket | null = null;
let retry: ReturnType<typeof setTimeout> | undefined;
let viewport = { cols: 80, rows: 24 };
let logSelection: SelectionRect | undefined;
let selectingLog = false;
let deferredFrame = false;
let gameControlsActive = false;
const terminal = new TerminalScreen();

screen.addEventListener('pointerdown', (event) => {
  if (event.button !== 0 && event.button !== 2) return;
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
  if (event.button === 0 && logSelection && x >= logSelection.x && x < logSelection.x + logSelection.width &&
    y >= logSelection.y && y < logSelection.y + logSelection.height) {
    selectingLog = true;
    return;
  }
  window.getSelection()?.removeAllRanges();
  if (socket?.readyState !== WebSocket.OPEN) return;
  event.preventDefault();
  screen.focus({ preventScroll: true });
  gameControlsActive = true;
  socket.send(JSON.stringify({ type: 'input', data: `\x1b[<${event.button};${x + 1};${y + 1}M` }));
});
screen.addEventListener('contextmenu', (event) => event.preventDefault());
screen.addEventListener('blur', () => { gameControlsActive = false; });

window.addEventListener('pointerup', () => {
  selectingLog = false;
  if (!hasLogSelection()) renderDeferredFrame();
});

document.addEventListener('selectionchange', () => {
  if (!selectingLog && !hasLogSelection()) renderDeferredFrame();
});

function hasLogSelection(): boolean {
  const selection = window.getSelection();
  return !!selection && !selection.isCollapsed && screen.contains(selection.anchorNode);
}

function renderDeferredFrame(): void {
  if (!deferredFrame) return;
  deferredFrame = false;
  renderRows(new Set(Array.from({ length: viewport.rows }, (_, y) => y)));
}

// Keep the screen between updates; deltas only replace rows containing changed cells.
function renderFrame(data: string): void {
  const dirty = terminal.apply(data, viewport.cols, viewport.rows);
  if (selectingLog || hasLogSelection()) {
    deferredFrame = true;
    return;
  }
  renderRows(dirty);
}

function renderRows(dirty: Set<number>): void {
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

document.body.addEventListener('keydown', (event) => {
  const inScreen = event.target === screen;
  if (!inScreen && event.target !== document.body) return;
  if (event.key === 'Escape') {
    gameControlsActive = false;
    return;
  }
  if (event.key === 'Tab' && !(inScreen && gameControlsActive)) return;
  if (!socket || socket.readyState !== WebSocket.OPEN) return;
  const data = getKeyboardInput(event);
  if (data === null) return;
  if (inScreen && event.key === 'Enter') gameControlsActive = true;
  window.getSelection()?.removeAllRanges();
  renderDeferredFrame();
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
  const previewEndpoint = document.querySelector<HTMLMetaElement>('meta[name="incanterm-websocket"]')?.content;
  const next = new WebSocket(previewEndpoint || `${protocol}//${location.host}/ws`);
  socket = next;

  next.addEventListener('open', () => {
    status.textContent = 'Connected';
    next.send(JSON.stringify({ type: 'resize', cols: 80, rows: 24 }));
  });

  next.addEventListener('message', (event) => {
    if (socket !== next) return;
    const message = parseServerMessage(String(event.data));
    if (!message) return;
    if (message.type === 'terminal-data') {
      viewport = { cols: message.cols ?? viewport.cols, rows: message.rows ?? viewport.rows };
      logSelection = message.logSelection;
      renderFrame(message.data);
      return;
    }
    if (message.type === 'session-status') {
      status.textContent = `Connected · ${message.sessionId}`;
      return;
    }
    if (message.type === 'session-error') {
      voice.stop();
      status.textContent = 'Game session failed';
      console.error(message.details);
      return;
    }
    if (message.type === 'voice-start') {
      voice.play(getVoiceClipUrl(next.url, message.checksum));
      return;
    }
    if (message.type === 'voice-stop') {
      voice.stop();
      return;
    }
    const verb = message.type === 'play-sound' ? 'Playing' : 'Stopped';
    audio.textContent = `${verb} ${message.assetId}`;
  });

  next.addEventListener('close', () => {
    if (socket !== next) return;
    voice.stop();
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
