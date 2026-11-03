import { afterEach, describe, expect, it, vi } from 'vitest';
import { TerminalScreen } from '../../client/terminal-screen.js';
import type { Cell } from '../../game/cell-buffer.js';
import { Character } from '../../game/character.js';
import { parseRpgScript } from '../../game/rpgscript/__tests__/test-support.js';
import { Scene, type StepTrigger } from '../../game/scene.js';
import { Sprite } from '../../game/sprite.js';
import { getPlainText } from '../../game/terminal.js';
import { createGameSession } from '../game-session.js';

const ink: Cell = { ch: '@', fg: { r: 255, g: 255, b: 255 }, bg: { r: 0, g: 0, b: 0 } };
const clear: Cell = { ...ink, ch: ' ' };
const sprite = new Sprite('hero', 1, 1, 0, 0, [ink]);

function createWalker(id: string, x: number, y: number): Character {
  return new Character(id, x, y, 0, sprite, 'actor', id, 'idle', 'right', 100);
}

function createRegion(id: string, x: number, y: number): StepTrigger {
  return { id, trigger: id, x, y, width: 1, height: 1 };
}

function getWalkerColumn(screen: TerminalScreen): number {
  return getPlainText(screen.buffer).split('\n').find((row) => row.includes('@'))?.indexOf('@') ?? -1;
}

describe('game session step triggers', () => {
  afterEach(() => vi.useRealTimers());

  it('stops at the first successful step and runs its script before another step', () => {
    vi.useFakeTimers();
    const screen = new TerminalScreen();
    const scene = new Scene('room', 7, 7, 'bottom-up', clear, [createWalker('hero', 1, 1)], ['entry'], new Set(), [], [createRegion('floor', 2, 1)]);
    const scripts = parseRpgScript(
      '#entry\nload,start\n#floor\nstep,enter\n@start\n+setPlayerWalkCh(hero)\n+chWalkToCoord(hero, 5, 1)\n@enter\n+log("Stepped on floor")',
      'steps.rpgscript',
    );
    const session = createGameSession(scene, (text, cols, rows) => screen.apply(text, cols, rows), scripts);
    try {
      session.open();
      const initial = getWalkerColumn(screen);
      vi.advanceTimersByTime(1000);
      const text = getPlainText(screen.buffer);
      expect(text).toContain('Stepped on floor');
      expect(getWalkerColumn(screen)).toBe(initial + 1);
    } finally {
      session.close();
    }
  });

  it('walks through a step region whose condition cannot run', () => {
    vi.useFakeTimers();
    const screen = new TerminalScreen();
    const scene = new Scene('room', 7, 7, 'bottom-up', clear, [createWalker('hero', 1, 1)], ['entry'], new Set(), [], [createRegion('floor', 2, 1)]);
    const scripts = parseRpgScript(
      '#entry\nload,start\n#floor\nstep,?is(flag):enter\n@start\n+setPlayerWalkCh(hero)\n+chWalkToCoord(hero, 5, 1)\n@enter\n+log("Should not run")',
      'steps.rpgscript',
    );
    const session = createGameSession(scene, (text, cols, rows) => screen.apply(text, cols, rows), scripts);
    try {
      session.open();
      const initial = getWalkerColumn(screen);
      vi.advanceTimersByTime(1000);
      expect(getWalkerColumn(screen)).toBe(initial + 4);
      expect(getPlainText(screen.buffer)).not.toContain('Should not run');
    } finally {
      session.close();
    }
  });

  it('does not activate step regions for an NPC walking through them', () => {
    vi.useFakeTimers();
    const screen = new TerminalScreen();
    const scene = new Scene('room', 7, 7, 'bottom-up', clear, [createWalker('hero', 1, 1), createWalker('npc', 1, 3)], ['entry'], new Set(), [], [createRegion('floor', 2, 3)]);
    const scripts = parseRpgScript(
      '#entry\nload,start\n#floor\nstep,enter\n@start\n+setPlayerWalkCh(hero)\n+chWalkToCoord(npc, 5, 3)\n@enter\n+log("NPC triggered")',
      'steps.rpgscript',
    );
    const session = createGameSession(scene, (text, cols, rows) => screen.apply(text, cols, rows), scripts);
    try {
      session.open();
      vi.advanceTimersByTime(1000);
      expect(getPlainText(screen.buffer)).not.toContain('NPC triggered');
    } finally {
      session.close();
    }
  });
});
