import { randomUUID } from 'node:crypto';
import { renderView, type Scene } from '../game/scene.js';
import { encodeTerminal } from '../game/terminal.js';

const MAX_AXIS = 1000;

export type GameSession = {
  id: string;
  cols: number;
  rows: number;
  open: () => void;
  input: (data: string) => void;
  resize: (cols: number, rows: number) => void;
};

export function createGameSession(scene: Scene, send: (text: string) => void): GameSession {
  let opened = false;
  const session: GameSession = {
    id: randomUUID(),
    cols: 80,
    rows: 24,
    open() {
      opened = true;
      paint();
    },
    input(_data: string) {
      // Gameplay input is not handled yet.
    },
    resize(cols, rows) {
      if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols < 1 || rows < 1) return;
      session.cols = Math.min(cols, MAX_AXIS);
      session.rows = Math.min(rows, MAX_AXIS);
      if (opened) paint();
    },
  };

  function paint(): void {
    send(encodeTerminal(renderView(scene, session.cols, session.rows)));
  }

  return session;
}
