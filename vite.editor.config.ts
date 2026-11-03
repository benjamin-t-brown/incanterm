import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { defineConfig, type Connect, type Plugin } from 'vite';
import { dispatchAssetRequest } from './src/editor/api.js';
import { AssetStore } from './src/editor/store.js';

const rootDir = path.dirname(fileURLToPath(import.meta.url));

function readBody(request: IncomingMessage): Promise<Buffer> {
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
    request.on('end', () => resolve(Buffer.concat(chunks)));
    request.on('error', reject);
  });
}

function createAssetApi(): Plugin {
  const store = new AssetStore(path.join(rootDir, 'assets'));
  const handle: Connect.NextHandleFunction = (request, response, next) => {
    const url = request.url ?? '';
    const pathOnly = url.split('?')[0] ?? '';
    if (pathOnly !== '/api' && !pathOnly.startsWith('/api/')) {
      next();
      return;
    }
    void respondToAssetRequest(store, request, response);
  };
  return {
    name: 'incanterm-asset-api',
    configureServer(server) {
      server.middlewares.use(handle);
    },
  };
}

async function respondToAssetRequest(
  store: AssetStore,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  try {
    const method = request.method ?? 'GET';
    if (method === 'POST' && /^\/api\/scripts\/[^/]+\/open(?:\?|$)/.test(request.url ?? '')) {
      const origin = request.headers.origin;
      const host = request.headers.host;
      let originHost: string | undefined;
      try {
        if (origin) originHost = new URL(origin).host;
      } catch {
        // A malformed Origin is not an editor request.
      }
      if (!host || originHost !== host) {
        response.statusCode = 403;
        response.setHeader('content-type', 'application/json; charset=utf-8');
        response.end(JSON.stringify({ error: 'Open script requires a same-origin request' }));
        return;
      }
    }
    const body =
      method === 'GET' || method === 'HEAD' || method === 'DELETE'
        ? Buffer.alloc(0)
        : await readBody(request);
    const result = await dispatchAssetRequest(
      store,
      method,
      request.url ?? '/api',
      body,
      String(request.headers['content-type'] ?? ''),
      request.headers['x-asset-base-revision'] === 'new'
        ? null
        : typeof request.headers['x-asset-base-revision'] === 'string'
          ? request.headers['x-asset-base-revision']
          : undefined,
    );
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
  plugins: [createAssetApi()],
  server: {
    host: '127.0.0.1',
    port: 7104,
    strictPort: true,
    fs: { allow: [rootDir] },
  },
});
