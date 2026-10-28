import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const proxyHost = process.env.INCANTERM_HOST || '127.0.0.1';
const httpPort = process.env.INCANTERM_HTTP_PORT || '7101';
const gameServer = `http://${proxyHost}:${httpPort}`;

export default defineConfig({
  root: path.join(rootDir, 'src/browser'),
  server: {
    host: '127.0.0.1',
    port: 7103,
    proxy: {
      '/health': gameServer,
      '/ws': {
        target: gameServer,
        ws: true,
      },
    },
  },
  build: {
    outDir: path.join(rootDir, 'dist/browser'),
    emptyOutDir: true,
  },
});
