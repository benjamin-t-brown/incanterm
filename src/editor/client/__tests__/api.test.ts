import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const project = {
  key: 'first',
  id: 'test-project',
  name: 'First',
  root: '/games/first',
  manifestPath: '/games/first/incanterm.json',
  entryScene: 'start',
};

beforeEach(() => vi.resetModules());
afterEach(() => vi.unstubAllGlobals());

function createJsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function createClosedProjectResponse(): Response {
  return createJsonResponse({ error: 'Project is not open. Open its folder again.' }, 422);
}

async function openTestProject() {
  const { setOpenedProject } = await import('../project.js');
  setOpenedProject(project);
  return import('../api.js');
}

it('reopens the exact project after a server restart and retries the unchanged save', async () => {
  const { requestJson, jsonRequest } = await openTestProject();
  const saved = { id: 'room', width: 17 };
  const options = jsonRequest('PUT', { doc: saved, base: { id: 'room', width: 120 } });
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(createClosedProjectResponse())
    .mockResolvedValueOnce(createJsonResponse(project))
    .mockResolvedValueOnce(createJsonResponse(saved));
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('localStorage', { getItem: () => '/games/other/incanterm.json' });

  expect(await requestJson('/api/scenes/room', options)).toEqual(saved);
  expect(fetchMock.mock.calls).toEqual([
    ['/api/projects/first/assets/scenes/room', options],
    ['/api/projects/open', jsonRequest('POST', { path: project.manifestPath })],
    ['/api/projects/first/assets/scenes/room', options],
  ]);
});

it('does not retry validation or revision-conflict failures', async () => {
  const { requestJson } = await openTestProject();
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(createJsonResponse({ error: 'Invalid scene' }, 422))
    .mockResolvedValueOnce(createJsonResponse({ error: 'Changed on disk' }, 409));
  vi.stubGlobal('fetch', fetchMock);

  await expect(requestJson('/api/scenes/room')).rejects.toThrow('Invalid scene');
  await expect(requestJson('/api/scenes/room')).rejects.toThrow('Changed on disk');
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

it('preserves a non-JSON error response without attempting recovery', async () => {
  const { requestJson } = await openTestProject();
  const fetchMock = vi.fn().mockResolvedValue(new Response('Bad response', { status: 422 }));
  vi.stubGlobal('fetch', fetchMock);

  await expect(requestJson('/api/scenes/room')).rejects.toThrow('The editor API did not respond');
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it('does not retry project-open requests or requests pinned to another project', async () => {
  const { requestJson } = await openTestProject();
  const fetchMock = vi.fn().mockImplementation(async () => createClosedProjectResponse());
  vi.stubGlobal('fetch', fetchMock);

  await expect(requestJson('/api/projects/open')).rejects.toThrow('Project is not open');
  await expect(requestJson('/api/projects/other/assets/scenes/room')).rejects.toThrow(
    'Project is not open',
  );
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

it('keeps the save unsent if reopening fails or returns a different project key', async () => {
  const { requestJson } = await openTestProject();
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(createClosedProjectResponse())
    .mockResolvedValueOnce(createJsonResponse({ error: 'Manifest missing' }, 422))
    .mockResolvedValueOnce(createClosedProjectResponse())
    .mockResolvedValueOnce(createJsonResponse({ ...project, key: 'other' }));
  vi.stubGlobal('fetch', fetchMock);

  await expect(requestJson('/api/scenes/room')).rejects.toThrow('Manifest missing');
  await expect(requestJson('/api/scenes/room')).rejects.toThrow('The project location changed');
  expect(fetchMock).toHaveBeenCalledTimes(4);
});

it('only retries once if the project is still unavailable', async () => {
  const { requestJson } = await openTestProject();
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(createClosedProjectResponse())
    .mockResolvedValueOnce(createJsonResponse(project))
    .mockResolvedValueOnce(createClosedProjectResponse());
  vi.stubGlobal('fetch', fetchMock);

  await expect(requestJson('/api/scenes/room')).rejects.toThrow('Project is not open');
  expect(fetchMock).toHaveBeenCalledTimes(3);
});

it('recovers binary reads and saves without changing their revision headers or payload', async () => {
  const { getBytesWithRevision, putBytes } = await openTestProject();
  const blob = new Blob(['image'], { type: 'image/png' });
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(createClosedProjectResponse())
    .mockResolvedValueOnce(createJsonResponse(project))
    .mockResolvedValueOnce(new Response(blob, { headers: { 'x-asset-revision': 'rev-1' } }))
    .mockResolvedValueOnce(createClosedProjectResponse())
    .mockResolvedValueOnce(createJsonResponse(project))
    .mockResolvedValueOnce(createJsonResponse({ revision: 'rev-2' }));
  vi.stubGlobal('fetch', fetchMock);

  const result = await getBytesWithRevision('/api/references/picture/image');
  expect(result.revision).toBe('rev-1');
  expect(await result.blob.text()).toBe('image');
  expect(await putBytes('/api/references/picture/image', blob, 'rev-1')).toEqual({
    revision: 'rev-2',
  });
  expect(fetchMock.mock.calls[3]).toEqual(fetchMock.mock.calls[5]);
  expect(fetchMock.mock.calls[5][1]).toMatchObject({
    method: 'PUT',
    body: blob,
    headers: { 'x-asset-base-revision': 'rev-1' },
  });
});

it('shares one reopen operation across concurrent requests', async () => {
  const { requestJson } = await openTestProject();
  let finishReopen!: (response: Response) => void;
  let notifyReopen!: () => void;
  const started = new Promise<void>((resolve) => {
    notifyReopen = resolve;
  });
  const pending = new Promise<Response>((resolve) => {
    finishReopen = resolve;
  });
  let isOpen = false;
  const fetchMock = vi.fn().mockImplementation(async (url: string) => {
    if (url === '/api/projects/open') {
      notifyReopen();
      return pending;
    }
    return isOpen ? createJsonResponse({ ok: true }) : createClosedProjectResponse();
  });
  vi.stubGlobal('fetch', fetchMock);

  const first = requestJson('/api/scenes/first');
  await started;
  // The second request reaches recovery while the first reopen is still pending.
  const second = requestJson('/api/scenes/second');
  await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
  isOpen = true;
  finishReopen(createJsonResponse(project));
  expect(await Promise.all([first, second])).toEqual([{ ok: true }, { ok: true }]);
  expect(fetchMock.mock.calls.filter(([url]) => url === '/api/projects/open')).toHaveLength(1);
});
