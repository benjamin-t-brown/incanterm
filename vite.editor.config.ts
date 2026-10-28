import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { defineConfig, type Connect, type Plugin } from 'vite';
import { dispatchAssetRequest } from './src/editor/api.js';
import { AssetStore } from './src/editor/store.js';

const rootDir = path.dirname(fileURLToPath(import.meta.url));

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    request.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > 4_000_000) {
        reject(new Error('too large'));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    request.on('error', reject);
  });
}

function assetApi(): Plugin {
  const store = new AssetStore(path.join(rootDir, 'assets'));
  const handle: Connect.NextHandleFunction = (request, response, next) => {
    const url = request.url ?? '';
    const pathOnly = url.split('?')[0] ?? '';
    if (pathOnly !== '/api' && !pathOnly.startsWith('/api/')) {
      next();
      return;
    }
    void respond(store, request, response);
  };
  return {
    name: 'incanterm-asset-api',
    configureServer(server) {
      server.middlewares.use(handle);
    },
  };
}

async function respond(
  store: AssetStore,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  try {
    const method = request.method ?? 'GET';
    const body =
      method === 'GET' || method === 'HEAD' || method === 'DELETE' ? '' : await readBody(request);
    const result = await dispatchAssetRequest(store, method, request.url ?? '/api', body);
    response.statusCode = result.status;
    for (const [key, value] of Object.entries(result.headers)) response.setHeader(key, value);
    response.end(result.body);
  } catch (error) {
    const tooLarge = error instanceof Error && error.message === 'too large';
    response.statusCode = tooLarge ? 413 : 500;
    response.setHeader('content-type', 'application/json; charset=utf-8');
    response.end(
      JSON.stringify({ error: tooLarge ? 'File is too large' : 'Asset request failed' }),
    );
  }
}

export default defineConfig({
  root: path.join(rootDir, 'src/editor/client'),
  appType: 'spa',
  plugins: [assetApi()],
  server: {
    host: '127.0.0.1',
    port: 7104,
    strictPort: true,
    fs: { allow: [rootDir] },
  },
});
