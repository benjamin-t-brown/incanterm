import { afterEach, expect, it, vi } from 'vitest';
import { TerminalScreen } from '../../client/terminal-screen.js';
import { Character } from '../../game/character.js';
import type { PropSlideArea } from '../../game/prop-slide.js';
import { parseRpgScript } from '../../game/rpgscript/__tests__/test-support.js';
import { Prop, Scene, type ActionTrigger } from '../../game/scene.js';
import { Sprite } from '../../game/sprite.js';
import { getPlainText } from '../../game/terminal.js';
import { createGameSession, type GameSession } from '../game-session.js';

const ink = { ch: ' ', fg: { r: 255, g: 255, b: 255 }, bg: { r: 0, g: 0, b: 0 } };
const script = `
#entry
load,enterRoom
#exit
action,goNext
#return
action,goBack
#undo
action,pushBack
#reset
action,resetRoom
#resetUnsafe
action,tryUnsafeReset
@enterRoom
  +setPlayerWalkCh(hero)
  +[pos] = getPropPos(crate)
  +?eq([pos]->0, 7):{
    +log("Entered with moved crate")
  }
@goNext
  +changeScene(atrium)
@goBack
  +changeScene(studio)
@pushProp(id)
  +[moved] = slideProp([id], right)
@pushBack
  +returning=true
  +[moved] = slideProp(crate, left)
  +?is([moved]):{
    +log("Return push settled")
  }
@resetRoom
  +[reset] = resetPropSlides(safe)
  +?is([reset]):{
    +[pos] = getPropPos(crate)
    +?eq([pos]->0, 1):{
      +log("Reset script sees authored props")
    }
  }
@tryUnsafeReset
  +resetPropSlides(unsafe)
`;

function createActionTrigger(trigger: string, x: number): ActionTrigger {
  return { id: trigger, trigger, x, y: 0, width: 1, height: 1 };
}

function createSlideRoom(id: string, { edited = false, interrupt = false } = {}): Scene {
  const area: PropSlideArea = {
    travelCells: [2, 4].flatMap((y) => Array.from({ length: y === 2 && edited ? 6 : 7 }, (_, x) => y * 12 + x + 1)),
    directions: { left: { x: -1, y: 0 }, right: { x: 1, y: 0 }, up: { x: 0, y: -1 }, down: { x: 0, y: 1 } },
  };
  const slidable = { footprint: [{ x: 0, y: 0 }], actionScript: 'pushProp' };
  const crate = new Prop('crate', 1, 2, 0, 0, new Sprite('crate-art', 1, 1, 0, 0, [{ ...ink, ch: 'C' }]),
    false, 'Crate', [{ x: 0, y: 0 }], { ...slidable, standOffsets: { right: { x: -1, y: 1 } } });
  const statue = new Prop('statue', 1, 4, 0, 0, new Sprite('statue-art', 1, 1, 0, 0, [{ ...ink, ch: 'S' }]),
    false, 'Statue', [], slidable);
  const player = new Character('hero', 0, 0, 0, new Sprite('hero-art', 2, 2, 0, 0, [
    ink, ink, { ...ink, ch: '@' }, ink,
  ]), 'hero', undefined, 'idle', 'down', 50);
  const guard = new Character('guard', 10, 5, 0, new Sprite('guard-art', 1, 1, 0, 0, [{ ...ink, ch: 'G' }]),
    'guard', undefined, 'idle', 'down');
  return new Scene(id, 12, 6, 'bottom-up', ink, [crate, statue, player, guard],
    ['entry', ...(interrupt ? ['interrupt'] : [])], undefined,
    [
      createActionTrigger(id === 'studio' ? 'exit' : 'return', 11),
      createActionTrigger('reset', 10), createActionTrigger('undo', 9), createActionTrigger('resetUnsafe', 8),
    ], [],
    [
      { id: 'entry-marker', name: 'mPlayer', x: 0, y: 1 },
      { id: 'safe-marker', name: 'safe', x: 4, y: 0 },
      { id: 'unsafe-marker', name: 'unsafe', x: 1, y: 2 },
    ], undefined, undefined, area);
}

function openSlideSession(
  studio: Scene, atrium: Scene, { initialState, interruption }: { initialState?: unknown; interruption?: 'reset' | 'leave' } = {},
) {
  const scripts = parseRpgScript(`${script}${interruption ? `
#interrupt
timer,interruptPush,guard,34
@interruptPush(owner)
  +[pos] = getPropPos(crate)
  +?all(eq([pos]->0, 6), is({returning})): {
    +waitMs(34)
    ${interruption === 'leave' ? '+changeScene(atrium)' : '+resetPropSlides(safe)\n    +log("Reset interrupted push")'}
  }
` : ''}`, 'prop-slide-state.rpgscript');
  const screen = new TerminalScreen();
  const onSettle = vi.fn();
  const load = vi.fn(async (id: string) => id === 'studio' ? studio : atrium);
  const update = vi.spyOn(Scene.prototype, 'update');
  const session = createGameSession(studio, (text, cols, rows) => screen.apply(text, cols, rows),
    scripts, undefined, undefined, undefined, undefined, load, undefined, undefined, false, [], onSettle, initialState);
  session.resize(80, 40);
  session.open();
  const getLiveRoom = (): Scene => {
    const room = update.mock.contexts.at(-1);
    if (!(room instanceof Scene)) throw new Error('Expected a live scene');
    return room;
  };
  return { session, screen, onSettle, getLiveRoom, initialRoom: getLiveRoom() };
}

function clickScene(session: GameSession, x: number, y: number): void {
  const rect = session.getSceneScreenRect();
  if (!rect) throw new Error('Expected a visible scene');
  session.input(`\x1b[<0;${rect.x + x + 1};${rect.y + y + 1}M`);
}

function getAnchor(scene: Scene, id: string) {
  const entity = scene.entities.find((entry) => entry.id === id);
  return { x: entity?.x, y: entity instanceof Character ? entity.bottomY : entity?.y };
}

async function advanceUntil(predicate: () => boolean): Promise<void> {
  for (let tick = 0; !predicate() && tick < 90; tick++) await vi.advanceTimersByTimeAsync(34);
  expect(predicate()).toBe(true);
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it('preserves settled anchors across room changes, restores before entry scripts, and resets just the current room', async () => {
  vi.useFakeTimers();
  const studio = createSlideRoom('studio');
  const atrium = createSlideRoom('atrium');
  const { session, screen, getLiveRoom, onSettle, initialRoom } = openSlideSession(studio, atrium);
  const other = openSlideSession(studio, atrium);
  try {
    clickScene(session, 1, 2);
    await advanceUntil(() => session.getPropSlideState().studio?.crate?.x === 7);
    expect(other.session.getPropSlideState()).toEqual({});
    expect(getAnchor(other.initialRoom, 'crate')).toEqual({ x: 1, y: 2 });
    expect(getAnchor(studio, 'crate')).toEqual({ x: 1, y: 2 });
    other.session.close();

    clickScene(session, 11, 0);
    await advanceUntil(() => getLiveRoom().id === 'atrium');
    expect(getAnchor(getLiveRoom(), 'crate')).toEqual({ x: 1, y: 2 });
    clickScene(session, 1, 4);
    await advanceUntil(() => session.getPropSlideState().atrium?.statue?.x === 7);
    clickScene(session, 11, 0);
    await advanceUntil(() => getLiveRoom().id === 'studio');
    expect(getLiveRoom()).not.toBe(initialRoom);
    expect(getAnchor(getLiveRoom(), 'crate')).toEqual({ x: 7, y: 2 });
    expect(getPlainText(screen.buffer)).toContain('Entered with moved crate');
    expect(getLiveRoom().blockedCells.has(2 * 12 + 7)).toBe(true);
    expect(getLiveRoom().blockedCells.has(2 * 12 + 1)).toBe(false);

    clickScene(session, 0, 2); // Two-cell-wide player covers the crate's authored walking cell.
    await advanceUntil(() => getAnchor(getLiveRoom(), 'hero').y === 2);
    expect(getAnchor(getLiveRoom(), 'hero')).toEqual({ x: 0, y: 2 });
    clickScene(session, 10, 0);
    expect(getPlainText(screen.buffer)).toContain('Reset script sees authored props');
    expect(getAnchor(getLiveRoom(), 'crate')).toEqual({ x: 1, y: 2 });
    expect(getAnchor(getLiveRoom(), 'hero')).toEqual({ x: 3, y: 0 });
    expect(onSettle).toHaveBeenCalledTimes(2); // Applying a room layout or reset doesn't count as a push.
    expect(session.getPropSlideState()).toEqual({ atrium: { statue: { x: 7, y: 4 } } });

    clickScene(session, 11, 0);
    await advanceUntil(() => getLiveRoom().id === 'atrium');
    expect(getAnchor(getLiveRoom(), 'statue')).toEqual({ x: 7, y: 4 });
    clickScene(session, 11, 0);
    await advanceUntil(() => getLiveRoom().id === 'studio');
    expect(getAnchor(getLiveRoom(), 'crate')).toEqual({ x: 1, y: 2 });
  } finally {
    session.close();
    other.session.close();
  }
});

it('round-trips settled anchors through JSON and omits a prop pushed back to its authored anchor', async () => {
  vi.useFakeTimers();
  const studio = createSlideRoom('studio');
  const atrium = createSlideRoom('atrium');
  const { session, getLiveRoom } = openSlideSession(studio, atrium);
  let exported: unknown;
  try {
    clickScene(session, 1, 2);
    await advanceUntil(() => getAnchor(getLiveRoom(), 'crate').x === 2);
    expect(session.getPropSlideState()).toEqual({}); // Intermediate render anchors are not durable.
    await advanceUntil(() => session.getPropSlideState().studio?.crate?.x === 7);
    const detached = session.getPropSlideState();
    exported = JSON.parse(JSON.stringify(detached));
    clickScene(session, 9, 0);
    await advanceUntil(() => !session.getPropSlideState().studio);
    expect(getAnchor(getLiveRoom(), 'crate')).toEqual({ x: 1, y: 2 });
    expect(detached).toEqual(exported);
  } finally {
    session.close();
  }
  const rehydrated = openSlideSession(studio, atrium, { initialState: exported });
  try {
    expect(getAnchor(rehydrated.initialRoom, 'crate')).toEqual({ x: 7, y: 2 });
    expect(rehydrated.session.getPropSlideState()).toEqual(exported);
    expect(getPlainText(rehydrated.screen.buffer)).toContain('Entered with moved crate');
    expect(getAnchor(studio, 'crate')).toEqual({ x: 1, y: 2 });
  } finally {
    rehydrated.session.close();
  }
});

it('validates the final layout as a group, allowing two relocated props to occupy each other’s authored cells', () => {
  vi.useFakeTimers();
  const initialState = { studio: { crate: { x: 1, y: 4 }, statue: { x: 1, y: 2 } } };
  const { session, initialRoom } = openSlideSession(createSlideRoom('studio'), createSlideRoom('atrium'), { initialState });
  try {
    expect(getAnchor(initialRoom, 'crate')).toEqual({ x: 1, y: 4 });
    expect(getAnchor(initialRoom, 'statue')).toEqual({ x: 1, y: 2 });
    expect(session.getPropSlideState()).toEqual(initialState);
  } finally {
    session.close();
  }
});

it.each([
  ['edited travel area', { crate: { x: 7, y: 2 }, statue: { x: 7, y: 4 } }, true],
  ['overlap', { crate: { x: 2, y: 2 }, statue: { x: 2, y: 2 } }, false],
  ['removed instance', { crate: { x: 7, y: 2 }, removed: { x: 7, y: 4 } }, false],
  ['malformed anchor', { crate: { x: 2, y: 2 }, statue: { x: 3.5, y: 4 } }, false],
] as const)('discards the whole saved room layout for %s without touching other rooms', (_reason, studio, edited) => {
  vi.useFakeTimers();
  const atrium = { statue: { x: 7, y: 4 } };
  const { session, initialRoom } = openSlideSession(createSlideRoom('studio', { edited }), createSlideRoom('atrium'), {
    initialState: { studio, atrium },
  });
  try {
    expect(getAnchor(initialRoom, 'crate')).toEqual({ x: 1, y: 2 });
    expect(getAnchor(initialRoom, 'statue')).toEqual({ x: 1, y: 4 });
    expect(session.getPropSlideState()).toEqual({ atrium });
  } finally {
    session.close();
  }
});

it('also validates rooms on entry when their saved stops no longer fit the authored travel area', async () => {
  vi.useFakeTimers();
  const initialState = {
    studio: { statue: { x: 7, y: 4 } },
    atrium: { crate: { x: 7, y: 2 }, statue: { x: 7, y: 4 } },
  };
  const created = openSlideSession(createSlideRoom('studio'), createSlideRoom('atrium', { edited: true }), { initialState });
  const { session, screen, getLiveRoom } = created;
  try {
    clickScene(session, 11, 0);
    await advanceUntil(() => getLiveRoom().id === 'atrium');
    expect(getAnchor(getLiveRoom(), 'crate')).toEqual({ x: 1, y: 2 });
    expect(getAnchor(getLiveRoom(), 'statue')).toEqual({ x: 1, y: 4 });
    expect(session.getPropSlideState()).toEqual({ studio: initialState.studio });
    expect(getPlainText(screen.buffer)).toContain('Discarded saved slide layout for atrium');
    expect(getPlainText(screen.buffer)).not.toContain('Entered with moved crate');
  } finally {
    session.close();
  }
});

it('leaves both the current layout and durable state intact if the required safe marker is obstructed', async () => {
  vi.useFakeTimers();
  const initialState = { studio: { crate: { x: 7, y: 2 } } };
  const { session, screen, getLiveRoom } = openSlideSession(createSlideRoom('studio'), createSlideRoom('atrium'), { initialState });
  try {
    clickScene(session, 0, 2);
    await advanceUntil(() => getAnchor(getLiveRoom(), 'hero').y === 2);
    clickScene(session, 8, 0);
    expect(getPlainText(screen.buffer)).toContain('is not walkable after reset');
    expect(getAnchor(getLiveRoom(), 'hero')).toEqual({ x: 0, y: 2 });
    expect(getAnchor(getLiveRoom(), 'crate')).toEqual({ x: 7, y: 2 });
    expect(session.getPropSlideState()).toEqual(initialState);
  } finally {
    session.close();
  }
});

it.each(['reset', 'leave'] as const)('can %s while reversing a push without recording an intermediate anchor', async (interruption) => {
  vi.useFakeTimers();
  const initialState = { studio: { crate: { x: 7, y: 2 } } };
  const studio = createSlideRoom('studio', { interrupt: true });
  const { session, getLiveRoom, initialRoom, onSettle } = openSlideSession(studio, createSlideRoom('atrium'), {
    initialState, interruption,
  });
  try {
    clickScene(session, 9, 0);
    await advanceUntil(() => getAnchor(initialRoom, 'crate').x === 6);
    expect(session.getPropSlideState()).toEqual(initialState);
    if (interruption === 'reset') {
      await advanceUntil(() => getAnchor(initialRoom, 'crate').x === 1);
      expect(session.getPropSlideState()).toEqual({});
    } else {
      await advanceUntil(() => getLiveRoom().id === 'atrium');
      expect(getAnchor(initialRoom, 'crate')).toEqual({ x: 7, y: 2 });
      clickScene(session, 11, 0);
      await advanceUntil(() => getLiveRoom().id === 'studio');
      expect(getAnchor(getLiveRoom(), 'crate')).toEqual({ x: 7, y: 2 });
      expect(session.getPropSlideState()).toEqual(initialState);
    }
    expect(onSettle).not.toHaveBeenCalled();
  } finally {
    session.close();
  }
});
