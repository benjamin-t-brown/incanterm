import { expect, it } from 'vitest';
import { TerminalScreen } from '../../client/terminal-screen.js';
import { Character } from '../../game/character.js';
import { parseRpgScript } from '../../game/rpgscript/__tests__/test-support.js';
import { Scene } from '../../game/scene.js';
import { Sprite } from '../../game/sprite.js';
import { getPlainText } from '../../game/terminal.js';
import { createGameSession } from '../game-session.js';

it('shows the first script alias for dialogue and two-speaker conversations', () => {
  const clear = { ch: ' ', fg: { r: 255, g: 255, b: 255 }, bg: { r: 0, g: 0, b: 0 } };
  const sprite = new Sprite('ralgo', 1, 1, 0, 0, [clear]);
  const ralgo = new Character('ralgo', 0, 0, 0, sprite, 'ralgo', undefined, 'idle', 'down', 150, new Map(), undefined, 'Mr. Ralgo/Mr Ralgo/Ralgo');
  const scene = new Scene('room', 5, 5, 'regular-z', clear, [ralgo], ['entry']);
  const scripts = parseRpgScript(
    '#entry\nload,start\n@start\n+setConv()\nRalgo: "First"\n+setConv2(Mr Ralgo, Johnathan)\nMr Ralgo: "Second"',
    'room.rpgscript',
  );
  const screen = new TerminalScreen();
  const session = createGameSession(scene, (text, cols, rows) => screen.apply(text, cols, rows), scripts);
  session.resize(120, 40);
  try {
    session.open();
    expect(getPlainText(screen.buffer)).toContain('Mr. Ralgo');
    expect(getPlainText(screen.buffer)).not.toContain('Mr Ralgo');
    session.input(' ');
    expect(getPlainText(screen.buffer)).toContain('Second');
    expect(getPlainText(screen.buffer)).toContain('Mr. Ralgo');
    expect(getPlainText(screen.buffer)).not.toContain('Mr Ralgo');
  } finally {
    session.close();
  }
});
