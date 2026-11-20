import { getOpenedProject, getProjectApiUrl, type EditorProject } from './project.js';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

let reopeningProject: { key: string; pending: Promise<void> } | null = null;

async function openProjectAgain(project: EditorProject): Promise<void> {
  if (reopeningProject?.key === project.key) return reopeningProject.pending;
  const pending = (async () => {
    const response = await fetch(
      '/api/projects/open',
      jsonRequest('POST', {
        path: project.manifestPath,
      }),
    );
    const value = (await response.json()) as EditorProject & { error?: string };
    if (!response.ok)
      throw new ApiError(value.error || 'Could not reopen the project', response.status);
    if (value.key !== project.key)
      throw new ApiError('The project location changed. Reopen it before saving.', 409);
  })();
  reopeningProject = { key: project.key, pending };
  try {
    await pending;
  } finally {
    if (reopeningProject?.pending === pending) reopeningProject = null;
  }
}

async function fetchProjectRequest(url: string, options?: RequestInit): Promise<Response> {
  const project = getOpenedProject();
  const scopedUrl = getProjectApiUrl(url);
  const response = await fetch(scopedUrl, options);
  if (!project || !scopedUrl.startsWith(`/api/projects/${project.key}/`) || response.status !== 422)
    return response;
  let value: { error?: string };
  try {
    value = (await response.clone().json()) as { error?: string };
  } catch {
    return response;
  }
  // Only this failure happens before dispatching the asset operation, so retrying is safe.
  if (value.error !== 'Project is not open. Open its folder again.') return response;
  await openProjectAgain(project);
  return fetch(scopedUrl, options);
}

export async function requestJson<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetchProjectRequest(url, options);
  let value: { error?: string };
  try {
    value = (await response.json()) as { error?: string };
  } catch {
    throw new ApiError('The editor API did not respond', response.status);
  }
  if (!response.ok) throw new ApiError(value.error || 'Request failed', response.status);
  return value as T;
}

export function jsonRequest(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  };
}

export async function putBytes<T>(
  url: string,
  body: Blob,
  baseRevision: string | null,
): Promise<T> {
  const response = await fetchProjectRequest(url, {
    method: 'PUT',
    headers: {
      'content-type': body.type || 'application/octet-stream',
      'x-asset-base-revision': baseRevision ?? 'new',
    },
    body,
  });
  let value: { error?: string };
  try {
    value = (await response.json()) as { error?: string };
  } catch {
    throw new ApiError('The editor API did not respond', response.status);
  }
  if (!response.ok) throw new ApiError(value.error || 'Request failed', response.status);
  return value as T;
}

export async function getBytes(url: string): Promise<Blob> {
  return (await getBytesWithRevision(url)).blob;
}

export async function getBytesWithRevision(url: string): Promise<{ blob: Blob; revision: string }> {
  const response = await fetchProjectRequest(url);
  if (!response.ok) {
    let value: { error?: string };
    try {
      value = (await response.json()) as { error?: string };
    } catch {
      throw new ApiError('The editor API did not respond', response.status);
    }
    throw new ApiError(value.error || 'Request failed', response.status);
  }
  const revision = response.headers.get('x-asset-revision');
  if (!revision) throw new ApiError('Image revision missing from the editor API', response.status);
  return { blob: await response.blob(), revision };
}
