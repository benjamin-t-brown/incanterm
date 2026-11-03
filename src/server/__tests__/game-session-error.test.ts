import { afterEach, expect, it, vi } from 'vitest';
import { Character } from '../../game/character.js';
import { parseRpgScript } from '../../game/rpgscript/__tests__/test-support.js';
import { Scene } from '../../game/scene.js';
import { Sprite } from '../../game/sprite.js';
import { TerminalScreen } from '../../client/terminal-screen.js';
import { getPlainText } from '../../game/terminal.js';
import { ERROR_LOG_FG } from '../../renderer/ui/layout-standard-scene.js';
import { createGameSession } from '../game-session.js';

afterEach(() => vi.useRealTimers());

it('logs an interrupted scene command and keeps the game session running', () => {
  vi.useFakeTimers();
  const ink = { ch: '@', fg: { r: 255, g: 255, b: 255 }, bg: { r: 0, g: 0, b: 0 } };
  const sprite = new Sprite('actor', 1, 1, 0, 0, [ink]);
  const hero = new Character('hero', 0, 1, 0, sprite, 'actor', 'Player', 'idle', 'right', 100);
  const blocked = new Set<number>();
  const scene = new Scene('room', 7, 4, 'regular-z', ink, [hero], ['entry'], blocked, [], [], [
    { id: 'marker-1', name: 'Exit', x: 4, y: 1 },
  ]);
  const scripts = parseRpgScript(
    '#entry\nload,start\n@start\n+walkToMarker(hero, Exit)\n+log("arrived")',
    'marker.rpgscript',
  );
  const onError = vi.fn();
  const screen = new TerminalScreen();
  const session = createGameSession(scene, (text, cols, rows) => { screen.apply(text, cols, rows); }, scripts, undefined, undefined, undefined, onError);
  session.open();
  // The path was reachable at command start, but the destination becomes blocked.
  blocked.add(1 * scene.width + 4);
  vi.advanceTimersByTime(500);
  expect(onError).not.toHaveBeenCalled();
  expect(getPlainText(screen.buffer)).toContain('interrupted before arrival');
  expect(getPlainText(screen.buffer)).toContain('(+walkToMarker)');
  expect(getPlainText(screen.buffer)).toContain('arrived');
  const rows = getPlainText(screen.buffer).split('\n');
  const errorRow = rows.findIndex((row) => row.includes('[RPGSCRIPT ERROR]'));
  expect(errorRow).toBeGreaterThanOrEqual(0);
  expect(screen.buffer.get(rows[errorRow].indexOf('['), errorRow).fg).toEqual(ERROR_LOG_FG);
  vi.advanceTimersByTime(500);
  expect(onError).not.toHaveBeenCalled();
  session.close();
});
