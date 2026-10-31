import { WebSocket } from 'ws';
import { encodeMessage, parseServerMessage, type ServerMessage } from '../protocol/messages.js';

export type GameClient = {
  sendInput: (data: string) => void;
  resize: (cols: number, rows: number) => void;
  close: () => void;
};

export function connectGameClient(
  url: string,
  handlers: {
    onOpen?: () => void;
    onMessage: (message: ServerMessage) => void;
    onError?: (error: Error) => void;
    onClose?: () => void;
  },
): GameClient {
  const socket = new WebSocket(url);
  socket.on('open', () => handlers.onOpen?.());
  socket.on('message', (data, isBinary) => {
    if (isBinary) return;
    const message = parseServerMessage(data.toString());
    if (message) handlers.onMessage(message);
  });
  socket.on('error', (error) => handlers.onError?.(error));
  socket.on('close', () => handlers.onClose?.());

  return {
    sendInput(data) {
      if (socket.readyState === WebSocket.OPEN) socket.send(encodeMessage({ type: 'input', data }));
    },
    resize(cols, rows) {
      if (socket.readyState === WebSocket.OPEN)
        socket.send(encodeMessage({ type: 'resize', cols, rows }));
    },
    close() {
      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)
        socket.close();
    },
  };
}
