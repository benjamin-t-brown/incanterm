import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { defineConfig, type Connect, type Plugin } from 'vite';
import { dispatchProjectRequest, ProjectRegistry } from './src/editor/projects.js';
import { isLocalEditorRequest } from './src/editor/request-origin.js';
import { getEditorUploadLimit } from './src/editor/voice/api.js';
import { privateDevFiles } from './src/editor/voice/dev-fs.js';

const rootDir = path.dirname(fileURLToPath(import.meta.url));

function readBody(request: IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    request.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        // Drain without buffering. Destroying the socket here drops the 413
        // response and looks like an unexplained network failure to the actor.
        chunks.length = 0;
        reject(new Error('too large'));
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => resolve(Buffer.concat(chunks)));
    request.on('error', reject);
  });
}

function createAssetApi(): Plugin {
  const projects = new ProjectRegistry(rootDir);
  const handle: Connect.NextHandleFunction = (request, response, next) => {
    const url = request.url ?? '';
    const pathOnly = url.split('?')[0] ?? '';
    if (pathOnly !== '/api' && !pathOnly.startsWith('/api/')) {
      next();
      return;
    }
    void respondToAssetRequest(projects, request, response);
  };
  return {
    name: 'incanterm-asset-api',
    configureServer(server) {
      server.httpServer?.once('close', () => {
        void projects.close().catch((error: unknown) => {
          console.error('Could not close project previews:', error);
        });
      });
      server.middlewares.use((request, response, next) => {
        if (request.url?.split('?')[0] !== '/game-preview') {
          next();
          return;
        }
        if (
          !isLocalEditorRequest(
            request.method ?? 'GET',
            request.headers.host,
            request.headers.origin,
          )
        ) {
          response.statusCode = 403;
          response.end('Local editor access required');
          return;
        }
        void (async () => {
          try {
            const key =
              new URL(request.url ?? '/', 'http://editor.local').searchParams.get('project') ?? '';
            const preview = await projects.getPreview(key);
            const browserRoot = path.join(rootDir, 'src/browser').replaceAll('\\', '/');
            const source = await fs.readFile(path.join(browserRoot, 'index.html'), 'utf8');
            const html = source
              .replace('./main.ts', `/@fs/${browserRoot}/main.ts`)
              .replace('./style.css', `/@fs/${browserRoot}/style.css`)
              .replace(
                '</head>',
                `<meta name="incanterm-websocket" content="ws://127.0.0.1:${preview.port}/ws"></head>`,
              );
            response.setHeader('content-type', 'text/html; charset=utf-8');
            response.setHeader('cache-control', 'no-store');
            response.end(await server.transformIndexHtml('/game-preview', html));
          } catch (error) {
            response.statusCode = 422;
            response.setHeader('content-type', 'text/plain; charset=utf-8');
            response.end(
              error instanceof Error ? error.message : 'Could not start project preview',
            );
          }
        })();
      });
      server.middlewares.use(handle);
    },
  };
}

async function respondToAssetRequest(
  projects: ProjectRegistry,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  try {
    const method = request.method ?? 'GET';
    if (!isLocalEditorRequest(method, request.headers.host, request.headers.origin)) {
      response.statusCode = 403;
      response.setHeader('content-type', 'application/json; charset=utf-8');
      response.end(JSON.stringify({ error: 'Editor changes require a same-origin local request' }));
      return;
    }
    const body =
      method === 'GET' || method === 'HEAD' || method === 'DELETE'
        ? Buffer.alloc(0)
        : await readBody(request, getEditorUploadLimit(method, request.url ?? '/api'));
    const result = await dispatchProjectRequest(
      projects,
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
    fs: { allow: [rootDir], deny: privateDevFiles },
  },
});
