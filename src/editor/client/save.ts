import { jsonRequest, requestJson } from './api.js';

// Every editor sends the snapshot it loaded, not just its current document.
// The server rereads disk under a per-file lock before accepting this request.
export function saveDraft<T>(url: string, doc: T, base: T | null): Promise<T> {
  return requestJson<T>(url, jsonRequest('PUT', { base, doc }));
}
