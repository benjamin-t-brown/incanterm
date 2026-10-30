export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export async function requestJson<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options);
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

export async function putBytes<T>(url: string, body: Blob): Promise<T> {
  const response = await fetch(url, {
    method: 'PUT',
    headers: { 'content-type': body.type || 'application/octet-stream' },
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
  const response = await fetch(url);
  if (!response.ok) {
    let value: { error?: string };
    try {
      value = (await response.json()) as { error?: string };
    } catch {
      throw new ApiError('The editor API did not respond', response.status);
    }
    throw new ApiError(value.error || 'Request failed', response.status);
  }
  return response.blob();
}
