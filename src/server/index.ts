import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from './start.js';
import { parseProjectArguments, loadProjectFromArguments } from '../project/cli.js';

const host = process.env.INCANTERM_HOST || '127.0.0.1';
const httpPort = readPort(
  process.env.INCANTERM_HTTP_PORT === undefined ? 'PORT' : 'INCANTERM_HTTP_PORT',
  7101,
);
const cli = parseProjectArguments(process.argv.slice(2));
if (cli.remaining.some((argument) => argument !== '--no-ssh'))
  throw new Error(`Unknown arguments: ${cli.remaining.join(' ')}`);
const sshEnabled = !cli.remaining.includes('--no-ssh');
const sshPort = sshEnabled ? readPort('INCANTERM_SSH_PORT', 7102) : undefined;
const project = await loadProjectFromArguments(cli);
const moduleRoot = path.dirname(fileURLToPath(import.meta.url));
const staticRoot = [
  path.join(moduleRoot, 'browser'),
  path.resolve(moduleRoot, '../../dist/browser'),
].find((directory) => fs.existsSync(path.join(directory, 'index.html')));

const server = await startServer({
  host,
  project,
  assetsRoot: cli.assetsRoot,
  sceneId: cli.sceneId,
  httpPort,
  sshPort,
  sshEnabled,
  staticRoot,
});

console.log(`Incanterm HTTP/WebSocket  http://${host}:${server.httpPort}`);
if (server.sshPort !== undefined)
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
