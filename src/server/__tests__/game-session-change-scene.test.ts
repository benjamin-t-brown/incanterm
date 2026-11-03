import { afterEach, expect, it, vi } from 'vitest';
import { TerminalScreen } from '../../client/terminal-screen.js';
import { Character } from '../../game/character.js';
import { parseRpgScript } from '../../game/rpgscript/__tests__/test-support.js';
import { Scene, type SceneMarker } from '../../game/scene.js';
import { Sprite } from '../../game/sprite.js';
import { getPlainText } from '../../game/terminal.js';
import { createGameSession } from '../game-session.js';

const ink = { ch: '@', fg: { r: 255, g: 255, b: 255 }, bg: { r: 0, g: 0, b: 0 } };
const clear = { ...ink, ch: ' ' };

function createTransitionScenes(markers: SceneMarker[]) {
  const sprite = new Sprite('hero', 1, 1, 0, 0, [ink]);
  const hero = new Character('hero', 1, 1, 0, sprite, 'actor', 'Hero', 'idle', 'down', 100);
  return {
    first: new Scene('first', 7, 7, 'bottom-up', clear, [hero], ['entry']),
    next: new Scene('next', 7, 7, 'bottom-up', clear, [], ['arrival'], new Set(), [], [], markers),
  };
}

afterEach(() => vi.useRealTimers());

it.each([
  { reference: 'next', argument: '', markers: [{ id: 'default', name: 'mPlayer', x: 4, y: 3 }], x: 4, y: 3, missing: false },
  { reference: 'Next Scene', argument: ', doorway', markers: [{ id: 'door', name: 'doorway', x: 2, y: 4 }], x: 2, y: 4, missing: false },
  { reference: 'next', argument: '', markers: [], x: 0, y: 0, missing: true },
  { reference: 'next', argument: ', absent', markers: [], x: 0, y: 0, missing: true },
])('changes scenes using "$reference" and marker argument "$argument"', async ({ reference, argument, markers, x, y, missing }) => {
  vi.useFakeTimers();
  const { first, next } = createTransitionScenes(markers);
  const screen = new TerminalScreen();
  const scripts = parseRpgScript(
    `#entry\nload,start\n#arrival\nload,arrived\n@start\n+setPlayerWalkCh(hero)\n+changeScene("${reference}"${argument})\n+log("Transition complete")\n@arrived\n+log("New scene loaded")`,
    'transition.rpgscript',
  );
  const session = createGameSession(first, (text, cols, rows) => screen.apply(text, cols, rows),
    scripts, undefined, undefined, undefined, undefined, async (sceneId) => {
      expect(sceneId).toBe(reference);
      return next;
    });
  try {
    session.open();
    const before = getPlainText(screen.buffer).split('\n');
    const beforeRow = before.findIndex((row) => row.includes('@'));
    const beforeColumn = before[beforeRow].indexOf('@');
    await vi.advanceTimersByTimeAsync(100);
    const text = getPlainText(screen.buffer);
    const rows = text.split('\n');
    const heroRow = rows.findIndex((row) => row.includes('@'));
    expect(heroRow).toBeGreaterThanOrEqual(0);
    expect(heroRow).toBe(beforeRow + y - 1);
    expect(rows[heroRow].indexOf('@')).toBe(beforeColumn + x - 1);
    expect(text).toContain('Transition complete');
    expect(text).toContain('New scene loaded');
    expect(text.includes('placing player at 0,0')).toBe(missing);
  } finally {
    session.close();
  }
});

it('logs a failed scene load and continues the script in the original scene', async () => {
  vi.useFakeTimers();
  const { first } = createTransitionScenes([]);
  const screen = new TerminalScreen();
  const scripts = parseRpgScript(
    '#entry\nload,start\n@start\n+setPlayerWalkCh(hero)\n+changeScene(missing)\n+log("Still in first")',
    'transition.rpgscript',
  );
  const session = createGameSession(first, (text, cols, rows) => screen.apply(text, cols, rows),
    scripts, undefined, undefined, undefined, undefined, async () => {
      throw new Error('Scene not found');
    });
  try {
    session.open();
    await vi.advanceTimersByTimeAsync(100);
    const text = getPlainText(screen.buffer);
    expect(text).toContain('Scene not found');
    expect(text).toContain('Still in first');
  } finally {
    session.close();
  }
});
