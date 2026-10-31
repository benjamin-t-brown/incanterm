import type { ServerMessage } from '../protocol/messages.js';

export type TerminalViewport = { cols: number; rows: number };

export function matchesViewport(
  frame: Extract<ServerMessage, { type: 'terminal-data' }>,
  viewport: TerminalViewport | undefined,
): boolean {
  return (
    !viewport ||
    frame.cols === undefined ||
    frame.rows === undefined ||
    (frame.cols === viewport.cols && frame.rows === viewport.rows)
  );
}
