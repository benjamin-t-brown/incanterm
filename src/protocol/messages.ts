export type ClientMessage =
  { type: 'input'; data: string } | { type: 'resize'; cols: number; rows: number };

export type ServerMessage =
  | { type: 'terminal-data'; data: string }
  | { type: 'session-status'; status: 'connected'; sessionId: string }
  | { type: 'play-sound'; assetId: string }
  | { type: 'stop-sound'; assetId: string };

const MAX_INPUT_CHARS = 8192;
const MAX_TERMINAL_CHARS = 1_000_000;
const MAX_ID_CHARS = 256;
const MAX_AXIS_CELLS = 1000;

export function parseClientMessage(raw: string): ClientMessage | null {
  const value = decode(raw);
  if (!value) return null;
  if (value.type === 'input' && isBoundedString(value.data, MAX_INPUT_CHARS)) {
    return { type: 'input', data: value.data };
  }
  if (value.type === 'resize' && isCellCount(value.cols) && isCellCount(value.rows)) {
    return { type: 'resize', cols: value.cols, rows: value.rows };
  }
  return null;
}

export function parseServerMessage(raw: string): ServerMessage | null {
  const value = decode(raw);
  if (!value) return null;
  if (value.type === 'terminal-data' && isBoundedString(value.data, MAX_TERMINAL_CHARS)) {
    return { type: 'terminal-data', data: value.data };
  }
  if (
    value.type === 'session-status' &&
    value.status === 'connected' &&
    isBoundedString(value.sessionId, MAX_ID_CHARS) &&
    value.sessionId.length > 0
  ) {
    return { type: 'session-status', status: 'connected', sessionId: value.sessionId };
  }
  if (
    (value.type === 'play-sound' || value.type === 'stop-sound') &&
    isBoundedString(value.assetId, MAX_ID_CHARS) &&
    value.assetId.length > 0
  ) {
    return { type: value.type, assetId: value.assetId };
  }
  return null;
}

export function encodeMessage(message: ClientMessage | ServerMessage): string {
  return JSON.stringify(message);
}

function decode(raw: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
  } catch {
    return null;
  }
  return null;
}

function isBoundedString(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.length <= maxLength;
}

function isCellCount(value: unknown): value is number {
  return (
    typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= MAX_AXIS_CELLS
  );
}
