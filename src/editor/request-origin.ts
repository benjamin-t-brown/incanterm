export function isLocalEditorRequest(method: string, host?: string, origin?: string): boolean {
  if (!host) return false;
  try {
    const server = new URL(`http://${host}`);
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(server.hostname)) return false;
    if (method === 'GET' || method === 'HEAD') return true;
    return !!origin && new URL(origin).origin === server.origin;
  } catch {
    return false;
  }
}
