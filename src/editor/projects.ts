import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createProject, loadProject, type LoadedProject } from '../project/project.js';
import { startHttpServer, type HttpListener } from '../server/http.js';
import { loadGame } from '../server/load-game.js';
import { dispatchAssetRequest, type AssetResponse } from './api.js';
import { AssetStore } from './store.js';
import { dispatchVoiceRequest } from './voice/api.js';

export type EditorProject = {
  key: string;
  id: string;
  name: string;
  root: string;
  manifestPath: string;
  entryScene: string;
};

type RegisteredProject = { project: LoadedProject; store: AssetStore; info: EditorProject };

export class ProjectRegistry {
  private readonly projects = new Map<string, RegisteredProject>();
  private readonly previews = new Map<string, Promise<HttpListener>>();

  constructor(private readonly workspaceRoot: string) {}

  private addProject(project: LoadedProject): EditorProject {
    const key = createHash('sha256').update(project.manifestPath).digest('hex').slice(0, 24);
    const info: EditorProject = {
      key,
      id: project.manifest.id,
      name: project.manifest.name,
      root: project.root,
      manifestPath: project.manifestPath,
      entryScene: project.manifest.entryScene,
    };
    const existing = this.projects.get(key);
    this.projects.set(key, {
      project,
      info,
      store:
        existing?.store.root === project.assetsRoot
          ? existing.store
          : new AssetStore(project.assetsRoot),
    });
    return info;
  }

  async openProject(location: string): Promise<EditorProject> {
    return this.addProject(await loadProject(path.resolve(this.workspaceRoot, location)));
  }

  async createProject(location: string, name: string): Promise<EditorProject> {
    return this.addProject(await createProject(path.resolve(this.workspaceRoot, location), name));
  }

  async listProjects(): Promise<EditorProject[]> {
    const directory = path.join(this.workspaceRoot, 'projects');
    let entries: import('node:fs').Dirent[];
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      entries = [];
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      try {
        await this.openProject(path.join(directory, entry.name));
      } catch {
        /* Incomplete or non-project directories are not openable projects. */
      }
    }
    return [...this.projects.values()]
      .map(({ info }) => info)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  getProject(key: string): RegisteredProject {
    const project = this.projects.get(key);
    if (!project) throw new Error('Project is not open. Open its folder again.');
    return project;
  }

  async startPreview(key: string): Promise<HttpListener> {
    const existing = this.previews.get(key);
    if (existing) return existing;
    const { project } = this.getProject(key);
    const pending = (async () => {
      const current = await loadProject(project.manifestPath);
      return startHttpServer({
        host: '127.0.0.1',
        port: 0,
        ...(await loadGame({ project: current })),
      });
    })();
    this.previews.set(key, pending);
    try {
      return await pending;
    } catch (error) {
      if (this.previews.get(key) === pending) this.previews.delete(key);
      throw error;
    }
  }

  async stopPreview(key: string): Promise<void> {
    const pending = this.previews.get(key);
    this.previews.delete(key);
    if (pending) await (await pending).close();
  }

  async getPreview(key: string): Promise<HttpListener> {
    this.getProject(key);
    const pending = this.previews.get(key);
    if (!pending) throw new Error('Start Play from the opened project first');
    return pending;
  }

  async close(): Promise<void> {
    await Promise.all([...this.previews.keys()].map((key) => this.stopPreview(key)));
  }
}

function getJson(status: number, value: unknown): AssetResponse {
  return {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    body: JSON.stringify(value),
  };
}

export async function dispatchProjectRequest(
  registry: ProjectRegistry,
  method: string,
  url: string,
  rawBody: string | Buffer,
  contentType = '',
  expectedRevision?: string | null,
): Promise<AssetResponse> {
  const request = new URL(url, 'http://editor.local');
  const parts = request.pathname.split('/').filter(Boolean);
  try {
    if (parts[0] !== 'api' || parts[1] !== 'projects')
      return getJson(409, { error: 'Open a project before accessing assets' });
    if (parts.length === 2 && method === 'GET')
      return getJson(200, { projects: await registry.listProjects() });
    if (parts.length === 3 && method === 'POST' && ['open', 'create'].includes(parts[2])) {
      const body = JSON.parse(String(rawBody)) as Record<string, unknown>;
      if (!body || typeof body.path !== 'string' || !body.path.trim())
        return getJson(400, { error: 'A local project folder or manifest path is required' });
      if (parts[2] === 'create' && typeof body.name !== 'string')
        return getJson(400, { error: 'A project name is required' });
      const project =
        parts[2] === 'open'
          ? await registry.openProject(body.path)
          : await registry.createProject(body.path, body.name as string);
      return getJson(200, project);
    }
    const key = parts[2];
    if (!key) return getJson(404, { error: 'Not found' });
    const registered = registry.getProject(key);
    if (parts.length === 3 && method === 'GET') return getJson(200, registered.info);
    if (parts[3] === 'play' && parts.length === 4) {
      if (method === 'DELETE') {
        await registry.stopPreview(key);
        return getJson(200, { ok: true });
      }
      if (method === 'POST') {
        await registry.startPreview(key);
        return getJson(200, { url: `/game-preview?project=${key}` });
      }
    }
    if (parts[3] === 'voice')
      return await dispatchVoiceRequest(
        registered.project,
        method,
        parts.slice(4),
        rawBody,
        contentType,
        request.searchParams,
      );
    if (parts[3] === 'assets') {
      // The store is captured per request. Switching a different tab/project can never retarget a save.
      const assetUrl = `/api/${parts.slice(4).join('/')}${request.search}`;
      return dispatchAssetRequest(
        registered.store,
        method,
        assetUrl,
        rawBody,
        contentType,
        expectedRevision,
      );
    }
    return getJson(404, { error: 'Not found' });
  } catch (error) {
    return getJson(error instanceof SyntaxError ? 400 : 422, {
      error: error instanceof Error ? error.message : 'Project request failed',
    });
  }
}
