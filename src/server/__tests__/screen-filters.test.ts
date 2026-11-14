import { expect, it } from 'vitest';
import { TerminalScreen } from '../../client/terminal-screen.js';
import { Scene } from '../../game/scene.js';
import { createGameSession } from '../game-session.js';

it('runs filters after rendering and before encoding the frame', () => {
  const clear = { ch: '.', fg: { r: 1, g: 2, b: 3 }, bg: { r: 4, g: 5, b: 6 } };
  const screen = new TerminalScreen();
  const session = createGameSession(new Scene('room', 1, 1, 'regular-z', clear, []),
    (data, cols, rows) => screen.apply(data, cols, rows));
  session.resize(80, 24);
  const remove = session.filters.addFilter((ctx) => {
    ctx.setCell(ctx.region.x, ctx.region.y, { ...clear, ch: 'Z' });
  }, { x: 0, y: 0, width: 1, height: 1 });
  try {
    session.open();
    expect(screen.buffer.get(0, 0).ch).toBe('Z');
    remove();
    session.resize(81, 24);
    expect(screen.buffer.get(0, 0).ch).toBe(' ');
  } finally {
    session.close();
  }
});
