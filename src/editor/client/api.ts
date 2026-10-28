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
