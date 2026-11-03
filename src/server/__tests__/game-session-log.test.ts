import { describe, expect, it } from 'vitest';
import { TerminalScreen } from '../../client/terminal-screen.js';
import type { Cell } from '../../game/cell-buffer.js';
import { parseRpgScript } from '../../game/rpgscript/__tests__/test-support.js';
import { Scene } from '../../game/scene.js';
import { getPlainText } from '../../game/terminal.js';
import { createGameSession } from '../game-session.js';

const clear: Cell = { ch: ' ', fg: { r: 255, g: 255, b: 255 }, bg: { r: 0, g: 0, b: 0 } };

describe('game session script log', () => {
  it('shows load and resumed +log commands in the Log tab', () => {
    const scripts = parseRpgScript(
      '#entry\nload,start\n@start\n+log("Started")\nGuide: "Hello"\n+log("Finished")',
      'session.rpgscript',
    );
    const screen = new TerminalScreen();
    const session = createGameSession(
      new Scene('room', 1, 1, 'regular-z', clear, [], ['entry']),
      (text, cols, rows) => screen.apply(text, cols, rows),
      scripts,
    );
    try {
      session.open();
      session.input(' ');
      expect(getPlainText(screen.buffer)).toContain('Started');
      expect(getPlainText(screen.buffer)).toContain('Finished');
    } finally {
      session.close();
    }
  });
});
