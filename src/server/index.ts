import fs from 'node:fs';
import path from 'node:path';
import { loadOrCreateHostKey } from './host-key.js';
import { startServer } from './start.js';

const host = process.env.INCANTERM_HOST || '127.0.0.1';
const httpPort = readPort('INCANTERM_HTTP_PORT', 7101);
const sshPort = readPort('INCANTERM_SSH_PORT', 7102);
const staticRoot = path.join(process.cwd(), 'dist', 'browser');

const server = await startServer({
  host,
  httpPort,
  sshPort,
  hostKey: loadOrCreateHostKey(path.join(process.cwd(), '.data', 'ssh_host_key')),
  staticRoot: fs.existsSync(path.join(staticRoot, 'index.html')) ? staticRoot : undefined,
});

console.log(`Incanterm HTTP/WebSocket  http://${host}:${server.httpPort}`);
console.log(`Incanterm SSH             ssh -p ${server.sshPort} player@${host}`);

let closing = false;
async function shutdown(): Promise<void> {
  if (closing) return;
  closing = true;
  await server.close();
  process.exit(0);
}

process.on('SIGINT', () => {
  void shutdown();
});
process.on('SIGTERM', () => {
  void shutdown();
});

function readPort(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    console.error(`${name} must be an integer from 0 to 65535`);
    process.exit(1);
  }
  return port;
}
