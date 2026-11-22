import { afterEach, expect, it, vi } from 'vitest';
import { TerminalScreen } from '../../client/terminal-screen.js';
import { AnimatedProp } from '../../game/animated-prop.js';
import { Character } from '../../game/character.js';
import { parseRpgScript } from '../../game/rpgscript/__tests__/test-support.js';
import { Prop, Scene } from '../../game/scene.js';
import { Sprite } from '../../game/sprite.js';
import { getPlainText } from '../../game/terminal.js';
import { createGameSession } from '../game-session.js';

const black = { r: 0, g: 0, b: 0 };
const ink = { ch: '@', fg: { r: 255, g: 255, b: 255 }, bg: black };
const blank = { ch: ' ', fg: black, bg: black };
const art = new Sprite('sign', 1, 3, 0, 1, [ink, ink, blank]);

function createSessionFixture({
  animated = false, blocked = false, step = false, otherProp = false, walkCommand, actionTrigger = false,
  enableUnreachableHook = true,
}: {
  animated?: boolean; blocked?: boolean; step?: boolean; otherProp?: boolean;
  walkCommand?: string; actionTrigger?: boolean; enableUnreachableHook?: boolean;
} = {}) {
  vi.useFakeTimers();
  const scripts = parseRpgScript(`
#entry
load,start
@start
  +setPlayerWalkCh(hero)
@inspect(instance)
  +log("Activated [instance]")
#scriptedSign
action,read
@read
  ${walkCommand ? `+${walkCommand}` : ''}
  +log("Read the sign")
@readOther
  +log("Read the other sign")
@reactToBlockedProp(instance)
  +setConv()
  player: "No path to [instance]."
  +endConv()
#interrupt
step,interruptWalk
@interruptWalk
  +log("Step interrupted approach")
`, 'prop-action.rpgscript');
  const hero = new Character('hero', 1, 3, 0, new Sprite('hero', 1, 1, 0, 0, [ink]), 'hero',
    undefined, 'idle', 'down', 100, new Map(), undefined, 'Explorer');
  const sign = animated
    ? new AnimatedProp('sign-instance', 7, 3, 0, 0, art, new Map(), 'default', 'Sign', 'sign-asset', false,
      [{ x: -1, y: 0 }], undefined, [], undefined, 'inspect')
    : new Prop('sign-instance', 7, 3, 0, 0, art, false, 'Sign', [], undefined, [], undefined,
      actionTrigger ? undefined : 'read');
  const blockers = new Set(blocked ? Array.from({ length: 6 }, (_, y) => y * 10 + 4) : []);
  const steps = step ? [{ id: 'interrupt-region', trigger: 'interrupt', x: 6, y: 3, width: 1, height: 1 }] : [];
  const actions = actionTrigger
    ? [{ id: 'sign-region', trigger: 'scriptedSign', x: 7, y: 3, width: 1, height: 1 }] : [];
  const entities = [hero, sign];
  if (otherProp)
    entities.push(new Prop('other-instance', 0, 1, 0, 0, art, false, 'Other sign', [], undefined, [], undefined, 'readOther'));
  const room = new Scene('room', 10, 6, 'regular-z', blank, entities, ['entry'], blockers, actions, steps, [
    { id: 'marker', name: 'BeyondSign', x: 9, y: 3 },
  ]);
  const screen = new TerminalScreen();
  const session = createGameSession(room, (text, cols, rows) => screen.apply(text, cols, rows), scripts,
    undefined, undefined, undefined, undefined, undefined, { enabled: false },
    undefined, false, [], undefined, undefined, undefined,
    enableUnreachableHook ? { propUnreachable: 'reactToBlockedProp' } : undefined);
  const update = vi.spyOn(Scene.prototype, 'update');
  session.resize(80, 35);
  session.open();
  const current = update.mock.contexts.at(-1);
  if (!(current instanceof Scene)) throw new Error('Expected the session-owned scene');
  const player = current.entities.find((entity) => entity.id === hero.id);
  if (!(player instanceof Character)) throw new Error('Expected the session-owned player');
  return { hero: player, current, session, screen };
}

function clickScene(session: ReturnType<typeof createGameSession>, x: number, y: number): void {
  const view = session.getSceneScreenRect();
  if (!view) throw new Error('Expected a visible scene');
  session.input(`\x1b[<0;${view.x + x + 1};${view.y + y + 1}M`);
}

function clickSign(session: ReturnType<typeof createGameSession>): void {
  clickScene(session, 7, 3);
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it('walks to a reusable prop’s walking boundary before invoking its script with the instance ID', () => {
  const { hero, session, screen } = createSessionFixture({ animated: true });
  try {
    clickSign(session);
    expect(hero.isWalking()).toBe(true);
    vi.advanceTimersByTime(100);
    expect(getPlainText(screen.buffer)).not.toContain('Activated');
    clickSign(session);
    vi.advanceTimersByTime(400);
    expect(hero).toMatchObject({ x: 5, bottomY: 3, facing: 'right' });
    expect(getPlainText(screen.buffer).match(/Activated sign-instance/g)).toHaveLength(1);
  } finally {
    session.close();
  }
});

it('uses the sprite’s lowest visible row for Enter and runs a zero-argument action', () => {
  const { hero, session, screen } = createSessionFixture();
  try {
    session.input('\r');
    expect(hero.isWalking()).toBe(true);
    expect(getPlainText(screen.buffer)).not.toContain('Read the sign');
    vi.advanceTimersByTime(500);
    expect(hero).toMatchObject({ x: 6, bottomY: 3, facing: 'right' });
    expect(getPlainText(screen.buffer)).toContain('Read the sign');
  } finally {
    session.close();
  }
});

it.each(['click', 'enter'] as const)('runs the configured hook with the prop ID on blocked %s activation', (input) => {
  const { hero, session, screen } = createSessionFixture({ blocked: true });
  try {
    if (input === 'click') clickSign(session);
    else session.input('\r');
    expect(hero).toMatchObject({ x: 1, bottomY: 3, state: 'idle' });
    const dialogue = getPlainText(screen.buffer);
    expect(dialogue).toContain('Explorer');
    expect(dialogue).toContain('No path to sign-instance.');
    expect(dialogue).not.toContain('Read the sign');

    session.input('\r');
    expect(getPlainText(screen.buffer)).not.toContain('No path to sign-instance.');
    clickScene(session, 0, 4);
    vi.advanceTimersByTime(400);
    expect(hero).toMatchObject({ x: 0, bottomY: 4 });
  } finally {
    session.close();
  }
});

it('runs the hook if a path becomes blocked during the approach', () => {
  const { hero, current, session, screen } = createSessionFixture();
  try {
    clickSign(session);
    vi.advanceTimersByTime(100);
    expect(hero.isWalking()).toBe(true);
    current.entities.push(new Prop('wall', 4, 0, 0, 0, art, false, undefined,
      Array.from({ length: current.height }, (_, y) => ({ x: 0, y }))));
    vi.advanceTimersByTime(400);
    expect(hero.isWalking()).toBe(false);
    expect(getPlainText(screen.buffer)).toContain('No path to sign-instance.');
    expect(getPlainText(screen.buffer)).not.toContain('Read the sign');
  } finally {
    session.close();
  }
});

it('does nothing when the prop is unreachable and the project has no hook configured', () => {
  const { hero, session, screen } = createSessionFixture({ blocked: true, enableUnreachableHook: false });
  try {
    clickSign(session);
    const text = getPlainText(screen.buffer);
    expect(text).not.toContain('No path to sign-instance.');
    expect(text).not.toContain("I can't reach that.");
    expect(text).not.toContain('Read the sign');
    clickScene(session, 0, 4);
    vi.advanceTimersByTime(400);
    expect(hero).toMatchObject({ x: 0, bottomY: 4 });
  } finally {
    session.close();
  }
});

it.each(['escape', 'step', 'removed'] as const)('does not run the action or hook when interrupted by %s', (reason) => {
  const { hero, current, session, screen } = createSessionFixture({ step: reason === 'step' });
  try {
    clickSign(session);
    if (reason === 'escape') {
      expect(hero.isWalking()).toBe(true);
      session.input('\x1b');
    } else if (reason === 'removed') {
      const sign = current.entities.find((entity) => entity.id === 'sign-instance');
      if (!sign) throw new Error('Expected the scripted prop');
      current.removeEntity(sign);
    }
    vi.advanceTimersByTime(500);
    expect(hero.isWalking()).toBe(false);
    expect(getPlainText(screen.buffer)).not.toContain('Read the sign');
    expect(getPlainText(screen.buffer)).not.toContain('No path to sign-instance.');
    if (reason === 'step') expect(getPlainText(screen.buffer)).toContain('Step interrupted approach');
  } finally {
    session.close();
  }
});

it('cancels the automatic approach on a new move and allows the prop to be clicked again', () => {
  const { hero, session, screen } = createSessionFixture();
  try {
    clickSign(session);
    vi.advanceTimersByTime(100);
    expect(hero.isWalking()).toBe(true);
    clickScene(session, 0, 4);
    vi.advanceTimersByTime(600);
    expect(hero).toMatchObject({ x: 0, bottomY: 4, state: 'idle' });
    expect(getPlainText(screen.buffer)).not.toContain('Read the sign');
    expect(getPlainText(screen.buffer)).not.toContain('No path to sign-instance.');

    clickSign(session);
    vi.advanceTimersByTime(600);
    expect(getPlainText(screen.buffer)).toContain('Read the sign');
  } finally {
    session.close();
  }
});

it('replaces an automatic approach when a different scripted prop is clicked', () => {
  const { session, screen } = createSessionFixture({ otherProp: true });
  try {
    clickSign(session);
    vi.advanceTimersByTime(100);
    clickScene(session, 0, 1);
    vi.advanceTimersByTime(600);
    expect(getPlainText(screen.buffer)).not.toContain('Read the sign');
    expect(getPlainText(screen.buffer)).toContain('Read the other sign');
  } finally {
    session.close();
  }
});

it.each([
  { walkCommand: 'walkToMarker(player, BeyondSign)', actionTrigger: true, elapsed: 100, skipWait: false },
  { walkCommand: 'walkToOffset(player, 3, 0)', actionTrigger: false, elapsed: 300, skipWait: false },
  { walkCommand: 'walkToMarker(player, BeyondSign, true)', actionTrigger: true, elapsed: 100, skipWait: true },
])('does not interrupt explicit $walkCommand', ({ walkCommand, actionTrigger, elapsed, skipWait }) => {
  const { hero, session, screen } = createSessionFixture({ walkCommand, actionTrigger });
  try {
    clickSign(session);
    vi.advanceTimersByTime(elapsed);
    expect(hero.isWalking()).toBe(true);
    expect(getPlainText(screen.buffer).includes('Read the sign')).toBe(skipWait);
    clickScene(session, 0, 4);
    vi.advanceTimersByTime(800);
    expect(hero).toMatchObject({ x: 9, bottomY: 3, state: 'idle' });
    expect(getPlainText(screen.buffer)).toContain('Read the sign');
  } finally {
    session.close();
  }
});
