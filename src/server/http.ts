import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { WebSocket, WebSocketServer } from 'ws';
import type { Scene } from '../game/scene.js';
import { encodeMessage, parseClientMessage, type ServerMessage } from '../protocol/messages.js';
import { createGameSession } from './game-session.js';
import { closeServer, listen } from './listen.js';

const MIME: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2',
};

export type HttpListener = {
  port: number;
  close: () => Promise<void>;
};

export async function startHttpServer(options: {
  host: string;
  port: number;
  staticRoot?: string;
  scene: Scene;
}): Promise<HttpListener> {
  const httpServer = http.createServer((req, res) => {
    void handleRequest(req, res, options.staticRoot).catch((error: unknown) => {
      console.error(error);
      if (!res.headersSent) sendText(res, 500, 'Internal error\n');
      else res.end();
    });
  });
  const webSocketServer = new WebSocketServer({
    server: httpServer,
    path: '/ws',
    maxPayload: 1024 * 1024,
  });

  webSocketServer.on('connection', (socket) => {
    attachSocket(socket, options.scene);
  });

  const port = await listen(httpServer, options.port, options.host);
  httpServer.on('error', (error) => {
    console.error(error);
  });

  return {
    port,
    async close() {
      for (const client of webSocketServer.clients) client.close();
      await new Promise<void>((resolve) => {
        webSocketServer.close(() => resolve());
      });
      httpServer.closeAllConnections();
      await closeServer(httpServer);
    },
  };
}

function attachSocket(socket: WebSocket, scene: Scene): void {
  const session = createGameSession(scene, (text) => {
    send(socket, { type: 'terminal-data', data: text });
  });
  send(socket, { type: 'session-status', status: 'connected', sessionId: session.id });
  session.open();

  socket.on('message', (data, isBinary) => {
    if (isBinary) return;
    const message = parseClientMessage(data.toString());
    if (!message) return;
    if (message.type === 'input') session.input(message.data);
    else session.resize(message.cols, message.rows);
  });
}

function send(socket: WebSocket, message: ServerMessage): void {
  if (socket.readyState === WebSocket.OPEN) socket.send(encodeMessage(message));
}

async function handleRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  staticRoot: string | undefined,
): Promise<void> {
  const pathname = new URL(req.url ?? '/', 'http://127.0.0.1').pathname;
  if (req.method === 'GET' && pathname === '/health') {
    sendJson(res, 200, { ok: true });
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    sendText(res, 405, 'Method not allowed\n');
    return;
  }
  if (staticRoot && (await tryStatic(staticRoot, pathname, req.method, res))) return;
  if (pathname === '/' || pathname === '/play' || pathname === '/play/') {
    sendText(
      res,
      200,
      'Incanterm browser client is not built. Use npm run dev, or npm run build before npm start.\n',
    );
    return;
  }
  sendText(res, 404, 'Not found\n');
}

async function tryStatic(
  root: string,
  pathname: string,
  method: string,
  res: http.ServerResponse,
): Promise<boolean> {
  const filePath =
    pathname === '/' || pathname === '/play' || pathname === '/play/'
      ? path.join(root, 'index.html')
      : safePath(root, pathname);
  if (!filePath) {
    sendText(res, 400, 'Bad request\n');
    return true;
  }
  let body: Buffer;
  try {
    const stat = await fs.stat(filePath);
    if (!stat.isFile()) return false;
    body = await fs.readFile(filePath);
  } catch (error) {
    if (isNotFound(error)) return false;
    throw error;
  }
  const type = MIME[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream';
  res.writeHead(200, { 'content-type': type, 'content-length': body.length });
  res.end(method === 'HEAD' ? undefined : body);
  return true;
}

function safePath(root: string, pathname: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  const relative = decoded.replace(/^[/\\]+/, '');
  const rootResolved = path.resolve(root);
  const full = path.resolve(rootResolved, relative);
  const rel = path.relative(rootResolved, full);
  if (rel.startsWith(`..${path.sep}`) || rel === '..' || path.isAbsolute(rel)) return null;
  return full;
}

function isNotFound(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

function sendText(res: http.ServerResponse, status: number, body: string): void {
  res.writeHead(status, {
    'content-type': 'text/plain; charset=utf-8',
    'content-length': Buffer.byteLength(body),
  });
  res.end(body);
}
