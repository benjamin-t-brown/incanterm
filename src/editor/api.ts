import { exportTruecolor } from './schema.js';
import { AssetError, AssetStore, getImageRevision } from './store.js';
import { SaveConflict } from './safe-save.js';
import { openScriptWithDefaultApp } from './open-script.js';

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
  expectedRevision?: string | null,
): Promise<AssetResponse> {
  const request = new URL(url, 'http://editor.local');
  const parts = request.pathname.split('/').filter(Boolean);
  try {
    if (parts[0] !== 'api') return getJson(404, { error: 'Not found' });
    if (parts[1] === 'palette') return await handlePaletteRequest(store, method, rawBody);
    if (parts[1] === 'sprites')
      return await handleSpritesRequest(store, method, parts.slice(2), rawBody);
    if (parts[1] === 'animation-folders' && parts.length === 2)
      return await handleAnimationFoldersRequest(store, method, rawBody);
    if (parts[1] === 'scene-folders' && parts.length === 2)
      return await handleSceneFoldersRequest(store, method, rawBody, 'scenes');
    if (parts[1] === 'sprite-folders' && parts.length === 2)
      return await handleSceneFoldersRequest(store, method, rawBody, 'sprites');
    if (parts[1] === 'animations')
      return await handleAnimationsRequest(store, method, parts.slice(2), rawBody);
    if (parts[1] === 'props')
      return await handlePropsRequest(store, method, parts.slice(2), rawBody);
    if (parts[1] === 'characters')
      return await handleCharactersRequest(store, method, parts.slice(2), rawBody);
    if (parts[1] === 'scenes')
      return await handleScenesRequest(store, method, parts.slice(2), rawBody);
    if (parts[1] === 'rpg-triggers' && parts.length === 2 && method === 'GET') {
      const sources = await store.getRpgTriggerSources();
      return getJson(200, { names: Object.keys(sources).sort(), sources });
    }
    if (parts[1] === 'scripts')
      return await handleScriptsRequest(store, method, parts.slice(2), rawBody);
    if (parts[1] === 'audio') return await handleAudioRequest(store, method, parts.slice(2));
    if (parts[1] === 'references') {
      return await handleReferencesRequest(
        store,
        method,
        parts.slice(2),
        rawBody,
        contentType,
        expectedRevision,
      );
    }
    if (parts[1] === 'duplicate' && method === 'POST') return await duplicate(store, rawBody);
    if (parts[1] === 'import' && parts[2] === 'ed-ascii' && method === 'POST') {
      return await importAscii(store, rawBody);
    }
    return getJson(404, { error: 'Not found' });
  } catch (error) {
    if (error instanceof AssetError || error instanceof SaveConflict) {
      return getJson(error.status, { error: error.message });
    }
    if (error instanceof SyntaxError) return getJson(400, { error: 'Invalid JSON' });
    console.error(error);
    return getJson(500, { error: 'Asset request failed' });
  }
}

async function handlePaletteRequest(
  store: AssetStore,
  method: string,
  rawBody: string | Buffer,
): Promise<AssetResponse> {
  if (method === 'GET') return getJson(200, await store.getPalette());
  if (method === 'PUT') {
    const { base, doc } = getDraftBody(rawBody);
    return getJson(200, await store.savePaletteDraft(doc, base));
  }
  return getJson(405, { error: 'Method not allowed' });
}

async function handleSpritesRequest(
  store: AssetStore,
  method: string,
  parts: string[],
  rawBody: string | Buffer,
): Promise<AssetResponse> {
  if (parts.length === 0 && method === 'GET') {
    const labels = await store.getSpriteLabels();
    return getJson(200, { files: Object.keys(labels), labels });
  }
  if (parts.length === 1 && method === 'GET')
    return getJson(200, await store.readSprite(decode(parts[0])));
  if (parts.length === 1 && method === 'PUT') {
    const body = getDraftBody(rawBody);
    return getJson(200, await store.saveSpriteDraft(decode(parts[0]), body.doc, body.base));
  }
  if (parts.length === 1 && method === 'DELETE') {
    await store.deleteSprite(decode(parts[0]));
    return getJson(200, { ok: true });
  }
  if (parts.length === 2 && parts[1] === 'export' && method === 'GET') {
    const sprite = await store.readSprite(decode(parts[0]));
    const exported = exportTruecolor(sprite, await store.getPalette());
    if (!exported.ok) return getJson(422, { error: exported.error });
    return {
      status: 200,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
      body: exported.value,
    };
  }
  return getJson(404, { error: 'Not found' });
}

async function handleAnimationsRequest(
  store: AssetStore,
  method: string,
  parts: string[],
  rawBody: string | Buffer,
): Promise<AssetResponse> {
  if (parts.length === 0 && method === 'GET') {
    const labels = await store.getAnimationLabels();
    return getJson(200, { files: Object.keys(labels), labels });
  }
  if (parts.length === 1 && method === 'GET') {
    return getJson(200, await store.readAnimation(decode(parts[0])));
  }
  if (parts.length === 1 && method === 'PUT') {
    const { base, doc } = getDraftBody(rawBody);
    return getJson(200, await store.saveAnimationDraft(decode(parts[0]), doc, base));
  }
  if (parts.length === 1 && method === 'DELETE') {
    await store.deleteAnimation(decode(parts[0]));
    return getJson(200, { ok: true });
  }
  if (parts.length === 2 && parts[1] === 'copy' && method === 'POST') {
    const body = getRecord(parseJson(rawBody));
    if (typeof body.id !== 'string') return getJson(400, { error: 'Copy needs an id' });
    return getJson(200, await store.copyAnimation(decode(parts[0]), body.id, body.doc));
  }
  if (parts.length === 2 && parts[1] === 'rename' && method === 'POST') {
    const body = getRecord(parseJson(rawBody));
    if (typeof body.id !== 'string') return getJson(400, { error: 'Rename needs an id' });
    return getJson(200, await store.renameAnimation(decode(parts[0]), body.id, body.base));
  }
  return getJson(404, { error: 'Not found' });
}

async function handleAnimationFoldersRequest(
  store: AssetStore,
  method: string,
  rawBody: string | Buffer,
): Promise<AssetResponse> {
  if (method === 'GET') return getJson(200, await store.getAnimationFolders());
  if (method === 'POST') {
    const body = getRecord(parseJson(rawBody));
    if (
      body.action === 'create-character-animations' &&
      typeof body.folder === 'string' &&
      typeof body.name === 'string' &&
      typeof body.sprite === 'string'
    )
      return getJson(
        200,
        await store.createCharacterAnimations(body.folder, body.name, body.sprite),
      );
    if (body.action === 'move' && typeof body.id === 'string' && typeof body.folder === 'string')
      return getJson(
        200,
        await store.changeAnimationFolders({ action: 'move', id: body.id, folder: body.folder }),
      );
    if (
      (body.action === 'create' || body.action === 'rename') &&
      typeof body.folder === 'string' &&
      typeof body.name === 'string'
    )
      return getJson(
        200,
        await store.changeAnimationFolders({
          action: body.action,
          folder: body.folder,
          name: body.name,
        }),
      );
    if (
      body.action === 'delete' &&
      typeof body.folder === 'string' &&
      Array.isArray(body.expectedIds) &&
      body.expectedIds.every((id) => typeof id === 'string') &&
      Array.isArray(body.expectedFolders) &&
      body.expectedFolders.every((folder) => typeof folder === 'string')
    )
      return getJson(
        200,
        await store.changeAnimationFolders({
          action: 'delete',
          folder: body.folder,
          expectedIds: body.expectedIds,
          expectedFolders: body.expectedFolders,
        }),
      );
    return getJson(400, { error: 'Invalid folder operation' });
  }
  return getJson(405, { error: 'Method not allowed' });
}

async function handleSceneFoldersRequest(
  store: AssetStore,
  method: string,
  rawBody: string | Buffer,
  kind: 'scenes' | 'sprites',
): Promise<AssetResponse> {
  const getFolders = () => kind === 'scenes' ? store.getSceneFolders() : store.getSpriteFolders();
  const changeFolders = (change: Parameters<AssetStore['changeSceneFolders']>[0]) =>
    kind === 'scenes' ? store.changeSceneFolders(change) : store.changeSpriteFolders(change);
  if (method === 'GET') return getJson(200, await getFolders());
  if (method !== 'POST') return getJson(405, { error: 'Method not allowed' });
  const body = getRecord(parseJson(rawBody));
  if (body.action === 'move' && typeof body.id === 'string' && typeof body.folder === 'string')
    return getJson(200, await changeFolders({ action: 'move', id: body.id, folder: body.folder }));
  if (
    (body.action === 'create' || body.action === 'rename') &&
    typeof body.folder === 'string' && typeof body.name === 'string'
  )
    return getJson(200, await changeFolders({ action: body.action, folder: body.folder, name: body.name }));
  if (
    body.action === 'delete' && typeof body.folder === 'string' &&
    Array.isArray(body.expectedIds) && body.expectedIds.every((id) => typeof id === 'string') &&
    Array.isArray(body.expectedFolders) && body.expectedFolders.every((folder) => typeof folder === 'string')
  )
    return getJson(200, await changeFolders({
      action: 'delete', folder: body.folder,
      expectedIds: body.expectedIds, expectedFolders: body.expectedFolders,
    }));
  return getJson(400, { error: 'Invalid folder operation' });
}

async function handleScriptsRequest(
  store: AssetStore,
  method: string,
  parts: string[],
  rawBody: string | Buffer,
): Promise<AssetResponse> {
  if (parts.length === 1 && parts[0] === 'diagnose' && method === 'POST') {
    const body = getRecord(parseJson(rawBody));
    if (typeof body.id !== 'string' || typeof body.source !== 'string') {
      return getJson(400, { error: 'Diagnose needs an id and source' });
    }
    return getJson(200, { diagnostics: await store.diagnose(body.id, body.source) });
  }
  if (parts.length === 0 && method === 'GET')
    return getJson(200, { files: await store.listScripts() });
  if (parts.length === 1 && parts[0] === 'names' && method === 'GET')
    return getJson(200, { sources: await store.getRpgScriptSources() });
  if (parts.length === 2 && parts[1] === 'open' && method === 'POST') {
    await openScriptWithDefaultApp(store, decode(parts[0]));
    return getJson(200, { ok: true });
  }
  if (parts.length === 1 && method === 'GET')
    return getJson(200, await store.readScript(decode(parts[0])));
  if (parts.length === 1 && method === 'PUT') {
    const { base, doc } = getDraftBody(rawBody);
    return getJson(200, await store.saveScriptDraft(decode(parts[0]), doc, base));
  }
  if (parts.length === 1 && method === 'DELETE') {
    await store.deleteScript(decode(parts[0]));
    return getJson(200, { ok: true });
  }
  return getJson(404, { error: 'Not found' });
}

async function handlePropsRequest(
  store: AssetStore,
  method: string,
  parts: string[],
  rawBody: string | Buffer,
): Promise<AssetResponse> {
  if (parts.length === 0 && method === 'GET')
    return getJson(200, { files: await store.listProps() });
  if (parts.length === 1 && method === 'GET')
    return getJson(200, await store.readProp(decode(parts[0])));
  if (parts.length === 1 && method === 'PUT') {
    const { base, doc } = getDraftBody(rawBody);
    return getJson(200, await store.savePropDraft(decode(parts[0]), doc, base));
  }
  if (parts.length === 1 && method === 'DELETE') {
    await store.deleteProp(decode(parts[0]));
    return getJson(200, { ok: true });
  }
  return getJson(404, { error: 'Not found' });
}

async function handleCharactersRequest(
  store: AssetStore,
  method: string,
  parts: string[],
  rawBody: string | Buffer,
): Promise<AssetResponse> {
  if (parts.length === 0 && method === 'GET')
    return getJson(200, {
      files: await store.listCharacters(),
      labels: await store.getCharacterLabels(),
    });
  if (parts.length === 1 && method === 'GET')
    return getJson(200, await store.readCharacter(decode(parts[0])));
  if (parts.length === 1 && method === 'PUT') {
    const { base, doc } = getDraftBody(rawBody);
    return getJson(200, await store.saveCharacterDraft(decode(parts[0]), doc, base));
  }
  if (parts.length === 1 && method === 'DELETE') {
    await store.deleteCharacter(decode(parts[0]));
    return getJson(200, { ok: true });
  }
  return getJson(404, { error: 'Not found' });
}

async function handleScenesRequest(
  store: AssetStore,
  method: string,
  parts: string[],
  rawBody: string | Buffer,
): Promise<AssetResponse> {
  if (parts.length === 0 && method === 'GET') {
    const files = await store.listScenes();
    return getJson(200, { files, labels: await store.getSceneLabels(files) });
  }
  if (parts.length === 1 && method === 'GET')
    return getJson(200, await store.readScene(decode(parts[0])));
  if (parts.length === 1 && method === 'PUT') {
    const { base, doc } = getDraftBody(rawBody);
    return getJson(200, await store.saveSceneDraft(decode(parts[0]), doc, base));
  }
  if (parts.length === 1 && method === 'DELETE') {
    await store.deleteScene(decode(parts[0]));
    return getJson(200, { ok: true });
  }
  return getJson(404, { error: 'Not found' });
}

async function handleAudioRequest(
  store: AssetStore,
  method: string,
  parts: string[],
): Promise<AssetResponse> {
  if (method !== 'GET') return getJson(405, { error: 'Method not allowed' });
  if (parts.length === 0) return getJson(200, { files: await store.listAudio() });
  if (parts.length === 1) {
    const audioFile = await store.readAudio(decode(parts[0]));
    return {
      status: 200,
      headers: { 'content-type': audioFile.type, 'cache-control': 'no-store' },
      body: audioFile.bytes,
    };
  }
  return getJson(404, { error: 'Not found' });
}

async function handleReferencesRequest(
  store: AssetStore,
  method: string,
  parts: string[],
  rawBody: string | Buffer,
  contentType: string,
  expectedRevision?: string | null,
): Promise<AssetResponse> {
  if (parts.length === 1 && method === 'GET') {
    return getJson(200, await store.readReference(decode(parts[0])));
  }
  if (parts.length === 1 && method === 'PUT') {
    const { base, doc } = getDraftBody(rawBody);
    return getJson(200, await store.saveReferenceDraft(decode(parts[0]), doc, base));
  }
  if (parts.length === 1 && method === 'DELETE') {
    await store.deleteReference(decode(parts[0]));
    return getJson(200, { ok: true });
  }
  if (parts.length === 2 && parts[1] === 'image' && method === 'GET') {
    const image = await store.readReferenceImage(decode(parts[0]));
    return {
      status: 200,
      headers: {
        'content-type': image.type,
        'cache-control': 'no-store',
        'x-asset-revision': getImageRevision(image.bytes),
      },
      body: image.bytes,
    };
  }
  if (parts.length === 2 && parts[1] === 'image' && method === 'PUT') {
    const bytes = typeof rawBody === 'string' ? Buffer.from(rawBody, 'utf8') : rawBody;
    return getJson(
      200,
      await store.saveReferenceImage(decode(parts[0]), bytes, contentType, expectedRevision),
    );
  }
  return getJson(404, { error: 'Not found' });
}

async function duplicate(store: AssetStore, rawBody: string | Buffer): Promise<AssetResponse> {
  const body = getRecord(parseJson(rawBody));
  if (body.kind !== 'sprite' && body.kind !== 'animation' && body.kind !== 'script') {
    return getJson(400, { error: 'Unknown asset kind' });
  }
  if (typeof body.from !== 'string' || typeof body.id !== 'string') {
    return getJson(400, { error: 'Duplicate needs from and id' });
  }
  if (body.label !== undefined && typeof body.label !== 'string')
    return getJson(400, { error: 'Label must be text' });
  return getJson(200, await store.duplicate(body.kind, body.from, body.id, body.label));
}

async function importAscii(store: AssetStore, rawBody: string | Buffer): Promise<AssetResponse> {
  const body = getRecord(parseJson(rawBody));
  if (typeof body.id !== 'string') return getJson(400, { error: 'Import needs an id' });
  if (body.label !== undefined && typeof body.label !== 'string')
    return getJson(400, { error: 'Label must be text' });
  return getJson(200, await store.importEdAscii(body.id, body.document, body.label));
}

function parseJson(rawBody: string | Buffer): unknown {
  const text = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8');
  if (text.length > 4_000_000) throw new AssetError('File is too large', 413);
  return JSON.parse(text) as unknown;
}

function getDraftBody(rawBody: string | Buffer): { base: unknown; doc: unknown } {
  const body = getRecord(parseJson(rawBody));
  if (!('base' in body) || !('doc' in body)) {
    throw new AssetError('Save needs a base snapshot and doc', 400);
  }
  return { base: body.base, doc: body.doc };
}

function getRecord(value: unknown): Record<string, unknown> {
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

function getJson(status: number, value: unknown): AssetResponse {
  return { status, headers: JSON_HEADERS, body: JSON.stringify(value) };
}
