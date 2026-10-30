import { exportTruecolor } from './schema.js';
import { AssetError, AssetStore } from './store.js';
import { SaveConflict } from './safe-save.js';

export type AssetResponse = {
  status: number;
  headers: Record<string, string>;
  body: string | Buffer;
};

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
};

export async function dispatchAssetRequest(
  store: AssetStore,
  method: string,
  url: string,
  rawBody: string | Buffer,
  contentType = '',
): Promise<AssetResponse> {
  const request = new URL(url, 'http://editor.local');
  const parts = request.pathname.split('/').filter(Boolean);
  try {
    if (parts[0] !== 'api') return json(404, { error: 'Not found' });
    if (parts[1] === 'palette') return await palette(store, method, rawBody);
    if (parts[1] === 'sprites') return await sprites(store, method, parts.slice(2), rawBody);
    if (parts[1] === 'animations') return await animations(store, method, parts.slice(2), rawBody);
    if (parts[1] === 'scripts') return await scripts(store, method, parts.slice(2), rawBody);
    if (parts[1] === 'audio') return await audio(store, method, parts.slice(2));
    if (parts[1] === 'references') {
      return await references(store, method, parts.slice(2), rawBody, contentType);
    }
    if (parts[1] === 'duplicate' && method === 'POST') return await duplicate(store, rawBody);
    if (parts[1] === 'import' && parts[2] === 'ed-ascii' && method === 'POST') {
      return await importAscii(store, rawBody);
    }
    return json(404, { error: 'Not found' });
  } catch (error) {
    if (error instanceof AssetError || error instanceof SaveConflict) {
      return json(error.status, { error: error.message });
    }
    if (error instanceof SyntaxError) return json(400, { error: 'Invalid JSON' });
    console.error(error);
    return json(500, { error: 'Asset request failed' });
  }
}

async function palette(
  store: AssetStore,
  method: string,
  rawBody: string | Buffer,
): Promise<AssetResponse> {
  if (method === 'GET') return json(200, await store.palette());
  if (method === 'PUT') {
    const { base, doc } = draftBody(rawBody);
    return json(200, await store.savePaletteDraft(doc, base));
  }
  return json(405, { error: 'Method not allowed' });
}

async function sprites(
  store: AssetStore,
  method: string,
  parts: string[],
  rawBody: string | Buffer,
): Promise<AssetResponse> {
  if (parts.length === 0 && method === 'GET')
    return json(200, { files: await store.listSprites() });
  if (parts.length === 1 && method === 'GET')
    return json(200, await store.readSprite(decode(parts[0])));
  if (parts.length === 1 && method === 'PUT') {
    const body = draftBody(rawBody);
    return json(200, await store.saveSpriteDraft(decode(parts[0]), body.doc, body.base));
  }
  if (parts.length === 1 && method === 'DELETE') {
    await store.deleteSprite(decode(parts[0]));
    return json(200, { ok: true });
  }
  if (parts.length === 2 && parts[1] === 'export' && method === 'GET') {
    const sprite = await store.readSprite(decode(parts[0]));
    const exported = exportTruecolor(sprite, await store.palette());
    if (!exported.ok) return json(422, { error: exported.error });
    return {
      status: 200,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
      body: exported.value,
    };
  }
  return json(404, { error: 'Not found' });
}

async function animations(
  store: AssetStore,
  method: string,
  parts: string[],
  rawBody: string | Buffer,
): Promise<AssetResponse> {
  if (parts.length === 0 && method === 'GET') {
    return json(200, { files: await store.listAnimations() });
  }
  if (parts.length === 1 && method === 'GET') {
    return json(200, await store.readAnimation(decode(parts[0])));
  }
  if (parts.length === 1 && method === 'PUT') {
    const { base, doc } = draftBody(rawBody);
    return json(200, await store.saveAnimationDraft(decode(parts[0]), doc, base));
  }
  if (parts.length === 1 && method === 'DELETE') {
    await store.deleteAnimation(decode(parts[0]));
    return json(200, { ok: true });
  }
  return json(404, { error: 'Not found' });
}

async function scripts(
  store: AssetStore,
  method: string,
  parts: string[],
  rawBody: string | Buffer,
): Promise<AssetResponse> {
  if (parts.length === 1 && parts[0] === 'diagnose' && method === 'POST') {
    const body = asRecord(parseJson(rawBody));
    if (typeof body.id !== 'string' || typeof body.source !== 'string') {
      return json(400, { error: 'Diagnose needs an id and source' });
    }
    return json(200, { diagnostics: await store.diagnose(body.id, body.source) });
  }
  if (parts.length === 0 && method === 'GET')
    return json(200, { files: await store.listScripts() });
  if (parts.length === 1 && method === 'GET')
    return json(200, await store.readScript(decode(parts[0])));
  if (parts.length === 1 && method === 'PUT') {
    const { base, doc } = draftBody(rawBody);
    return json(200, await store.saveScriptDraft(decode(parts[0]), doc, base));
  }
  if (parts.length === 1 && method === 'DELETE') {
    await store.deleteScript(decode(parts[0]));
    return json(200, { ok: true });
  }
  return json(404, { error: 'Not found' });
}

async function audio(store: AssetStore, method: string, parts: string[]): Promise<AssetResponse> {
  if (method !== 'GET') return json(405, { error: 'Method not allowed' });
  if (parts.length === 0) return json(200, { files: await store.listAudio() });
  if (parts.length === 1) {
    const audioFile = await store.readAudio(decode(parts[0]));
    return {
      status: 200,
      headers: { 'content-type': audioFile.type, 'cache-control': 'no-store' },
      body: audioFile.bytes,
    };
  }
  return json(404, { error: 'Not found' });
}

async function references(
  store: AssetStore,
  method: string,
  parts: string[],
  rawBody: string | Buffer,
  contentType: string,
): Promise<AssetResponse> {
  if (parts.length === 1 && method === 'GET') {
    return json(200, await store.readReference(decode(parts[0])));
  }
  if (parts.length === 1 && method === 'PUT') {
    return json(200, await store.saveReference(decode(parts[0]), parseJson(rawBody)));
  }
  if (parts.length === 1 && method === 'DELETE') {
    await store.deleteReference(decode(parts[0]));
    return json(200, { ok: true });
  }
  if (parts.length === 2 && parts[1] === 'image' && method === 'GET') {
    const image = await store.readReferenceImage(decode(parts[0]));
    return {
      status: 200,
      headers: { 'content-type': image.type, 'cache-control': 'no-store' },
      body: image.bytes,
    };
  }
  if (parts.length === 2 && parts[1] === 'image' && method === 'PUT') {
    const bytes = typeof rawBody === 'string' ? Buffer.from(rawBody, 'utf8') : rawBody;
    return json(200, await store.saveReferenceImage(decode(parts[0]), bytes, contentType));
  }
  return json(404, { error: 'Not found' });
}

async function duplicate(store: AssetStore, rawBody: string | Buffer): Promise<AssetResponse> {
  const body = asRecord(parseJson(rawBody));
  if (body.kind !== 'sprite' && body.kind !== 'animation' && body.kind !== 'script') {
    return json(400, { error: 'Unknown asset kind' });
  }
  if (typeof body.from !== 'string' || typeof body.id !== 'string') {
    return json(400, { error: 'Duplicate needs from and id' });
  }
  return json(200, await store.duplicate(body.kind, body.from, body.id));
}

async function importAscii(store: AssetStore, rawBody: string | Buffer): Promise<AssetResponse> {
  const body = asRecord(parseJson(rawBody));
  if (typeof body.id !== 'string') return json(400, { error: 'Import needs an id' });
  return json(200, await store.importEdAscii(body.id, body.document));
}

function parseJson(rawBody: string | Buffer): unknown {
  const text = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8');
  if (text.length > 4_000_000) throw new AssetError('File is too large', 413);
  return JSON.parse(text) as unknown;
}

function draftBody(rawBody: string | Buffer): { base: unknown; doc: unknown } {
  const body = asRecord(parseJson(rawBody));
  if (!('base' in body) || !('doc' in body)) {
    throw new AssetError('Save needs a base snapshot and doc', 400);
  }
  return { base: body.base, doc: body.doc };
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new AssetError('Expected a JSON object', 400);
  }
  return value as Record<string, unknown>;
}

function decode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new AssetError('Invalid id', 400);
  }
}

function json(status: number, value: unknown): AssetResponse {
  return { status, headers: JSON_HEADERS, body: JSON.stringify(value) };
}
