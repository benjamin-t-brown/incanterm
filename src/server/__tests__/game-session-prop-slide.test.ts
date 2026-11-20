import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { TerminalScreen } from '../../client/terminal-screen.js';
import { createSprite, type SceneEntity } from '../../editor/schema.js';
import { AssetStore } from '../../editor/store.js';
import { createPropSlideFixtureDocuments } from '../../game/__tests__/prop-slide-fixture.js';
import { AnimatedProp } from '../../game/animated-prop.js';
import { Character } from '../../game/character.js';
import { loadScene } from '../../game/load-scene.js';
import { PROP_SLIDE_STEP_MS } from '../../game/prop-slide-control.js';
import { parseRpgScript } from '../../game/rpgscript/__tests__/test-support.js';
import { Prop, Scene } from '../../game/scene.js';
import { getSceneSlideSetup, getSlidePath } from '../../game/prop-slide.js';
import { Sprite } from '../../game/sprite.js';
import { getPlainText } from '../../game/terminal.js';
import { CANCEL_UI_AND_OPEN_LOG_INPUT } from '../../protocol/input.js';
import { createGameSession } from '../game-session.js';

const pushScript = `
#entry
load,start
@start
  +setPlayerWalkCh(hero)
@pushShelf(instance)
  +log("Action [instance]")
  +setConv()
  +[reached] = approachSlideProp([instance])
  +?isnot([reached]):{
    hero: "I can't reach that."
    +endConv()
    <
  }
  +[available] = getPropPushes([instance])
  +[direction] = choosePropPush([instance])
  +?eq([direction], cancel):{
    +log("Push canceled")
    +endConv()
    <
  }
  +[settled] = slideProp([instance], [direction])
  +?is([settled]):{
    +log("Push completed")
  }
  +?isnot([settled]):{
    +log("Push failed")
  }
  +endConv()
`;
const ink = { ch: '@', fg: { r: 255, g: 255, b: 255 }, bg: { r: 0, g: 0, b: 0 } };
const keys = /(\d)\.\s(Left|Right|Up|Down|Cancel)/g;

async function createPropSlideFixture({
  player = { x: 2, y: 0 }, inaccessible = false, extraScript = '',
}: { player?: { x: number; y: number }; inaccessible?: boolean; extraScript?: string } = {}) {
  const { scene, sprite, prop } = createPropSlideFixtureDocuments();
  const [first, second] = scene.entities;
  if (!first.slidable || !second.slidable) throw new Error('Expected two slidable fixture instances');
  first.slidable = {
    ...first.slidable,
    standOffsets: { right: { x: -2, y: 0 }, up: { x: 1, y: 2 } },
  };
  const crateSprite = createSprite('crate-art', 1, 1);
  crateSprite.sprites[0].layers[0].cells[0] = { ch: 'C', fg: 'white', bg: 'black' };
  const crate: SceneEntity = {
    id: second.id, type: 'Prop', sprite: crateSprite.id, x: second.x, y: second.y, z: second.z,
    name: 'Crate', depthOffset: 0, slidable: second.slidable,
  };
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'incanterm-play-prop-slide-'));
  let template: Scene;
  try {
    const store = new AssetStore(root);
    await store.saveSprite(sprite.id, sprite);
    await store.saveSprite(crateSprite.id, crateSprite);
    await store.savePropDraft(prop.id, prop, null);
    await store.saveSceneDraft(scene.id, {
      ...scene, triggers: ['entry', ...(extraScript ? ['interrupt'] : [])], entities: [first, crate],
      blockedCells: [
        ...scene.blockedCells,
        ...(inaccessible ? Array.from({ length: scene.width }, (_, x) => 4 * scene.width + x) : []),
      ],
    }, null);
    template = await loadScene(root, scene.id);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
  const hero = new Character('hero', player.x, player.y, 0, new Sprite('hero', 1, 1, 0, 0, [ink]),
    'hero', undefined, 'idle', 'down', 100);
  template.entities.push(hero);
  if (extraScript) template.entities.push(new Character('guard', 7, 0, 0, hero.sprite,
    'guard', undefined, 'idle', 'down'));
  const setup = getSceneSlideSetup(template);
  if (!setup) throw new Error('Missing fixture slide board');
  const scripts = parseRpgScript(`${pushScript}\n${extraScript}`, 'prop-slide.rpgscript');
  const screen = new TerminalScreen();
  const settle = vi.fn();
  const missed = vi.fn();
  const load = vi.fn(async () => new Scene('next', 8, 6, 'bottom-up', template.clear, [], [], undefined, [], [],
    [{ id: 'entry', name: 'mPlayer', x: 0, y: 0 }]));
  const update = vi.spyOn(Scene.prototype, 'update');
  const session = createGameSession(template, (text, cols, rows) => screen.apply(text, cols, rows),
    scripts, undefined, undefined, undefined, missed, load, undefined, undefined, false, [], settle);
  session.resize(80, 40);
  session.open();
  const current = update.mock.contexts.at(-1);
  if (!(current instanceof Scene)) throw new Error('Expected session-owned scene');
  const playerEntity = current.entities.find((entity) => entity instanceof Character);
  const shelf = current.entities.find((entity) => entity.id === first.id);
  const box = current.entities.find((entity) => entity.id === crate.id);
  if (!(playerEntity instanceof Character) || !(shelf instanceof AnimatedProp) || !(box instanceof Prop) ||
    box instanceof AnimatedProp) throw new Error('Expected player, reusable shelf, and sprite-backed crate');
  return { session, screen, template, current, player: playerEntity, shelf, box, setup, settle, load, missed };
}

function clickScene(session: ReturnType<typeof createGameSession>, x: number, y: number): void {
  const scene = session.getSceneScreenRect();
  if (!scene) throw new Error('Expected visible scene');
  session.input(`\x1b[<0;${scene.x + x + 1};${scene.y + y + 1}M`);
}

function clickChoice(session: ReturnType<typeof createGameSession>, screen: TerminalScreen, label: string): void {
  const rows = getPlainText(screen.buffer).split('\n');
  const y = rows.findIndex((row) => row.match(new RegExp(`[1-9]\\.\\s${label}`)));
  if (y < 0) throw new Error(`Could not find ${label} in visible choices`);
  session.input(`\x1b[<0;${rows[y].indexOf(label) + 1};${y + 1}M`);
}

function getDisplayedChoices(screen: TerminalScreen): string[] {
  return [...getPlainText(screen.buffer).matchAll(keys)].sort((a, b) => Number(a[1]) - Number(b[1])).map(match => match[2]);
}

function advanceUntil(predicate: () => boolean, maximum = 1000): void {
  for (let elapsed = 0; !predicate() && elapsed < maximum; elapsed += 34)
    vi.advanceTimersByTime(34);
  expect(predicate()).toBe(true);
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it('opens the pad when already next to walking paint and settles at the preview anchor', async () => {
  vi.useFakeTimers();
  const { session, screen, current, player, shelf, box, setup, template, settle, missed } = await createPropSlideFixture();
  try {
    session.resize(40, 40);
    const preview = getSlidePath(setup.board, setup.positions, shelf.id, 'right');
    if (!preview.ok) throw new Error(preview.error);
    // The shelf's anchor is transparent. Its active art at (1,1) uses a nonzero origin.
    clickScene(session, 2, 2);
    expect(getDisplayedChoices(screen)).toEqual([]);
    clickScene(session, 1, 1);
    session.resize(40, 16); // The whole pad must fit, and be clickable, at minimum terminal size.
    expect(getDisplayedChoices(screen)).toEqual(['Left', 'Right', 'Up', 'Down', 'Cancel']);
    const rows = getPlainText(screen.buffer).split('\n');
    const middle = rows.findIndex(row => /1\. Left.*5\. Cancel.*2\. Right/.test(row));
    expect(middle).toBeGreaterThan(0);
    expect(rows.slice(0, middle).join('\n')).toContain('3. Up');
    expect(rows.slice(middle + 1).join('\n')).toContain('4. Down');
    expect({ x: player.x, y: player.bottomY }).toEqual({ x: 2, y: 0 });
    expect(current.blockedCells.has(27)).toBe(true);

    clickChoice(session, screen, 'Right');
    session.resize(40, 40);
    expect(shelf.x).toBe(2);
    expect(player.isWalking()).toBe(true);
    advanceUntil(() => shelf.x === 3);
    expect({ x: player.x, y: player.bottomY, facing: player.facing }).toEqual({ x: 0, y: 2, facing: 'right' });
    expect(settle).not.toHaveBeenCalled();
    expect(getPlainText(screen.buffer)).not.toContain('Push completed');
    clickScene(session, box.x, box.y);
    session.input('\r');
    expect(getDisplayedChoices(screen)).toEqual([]);
    vi.advanceTimersByTime(PROP_SLIDE_STEP_MS + 34);
    expect({ x: shelf.x, y: shelf.y }).toEqual(preview.finalAnchor);
    expect(box).toMatchObject({ x: 5, y: 3 });
    expect(settle).toHaveBeenCalledExactlyOnceWith({
      sceneId: current.id, instanceId: shelf.id, from: { x: 2, y: 2 }, to: preview.finalAnchor,
    });
    expect(current.blockedCells.has(27)).toBe(false);
    expect(current.blockedCells.has(29)).toBe(true);
    expect(template.entities[0]).toMatchObject({ x: 2, y: 2 });
    expect(missed).not.toHaveBeenCalled();
    expect(getPlainText(screen.buffer)).toContain('Push completed');

    clickScene(session, 1, 1);
    expect(getDisplayedChoices(screen)).toEqual([]);
    clickScene(session, shelf.x - 1, shelf.y - 1);
    advanceUntil(() => getDisplayedChoices(screen).length > 0);
    expect(getDisplayedChoices(screen)).not.toContain('Right'); // The travel hole blocks the first step now.
    clickChoice(session, screen, 'Cancel');
    expect(settle).toHaveBeenCalledTimes(1);
  } finally {
    session.close();
  }
});

it('activates the same script from Enter for a sprite-backed crate and cancels without moving it', async () => {
  vi.useFakeTimers();
  const { session, screen, box, settle } = await createPropSlideFixture({ player: { x: 6, y: 4 } });
  try {
    session.input('\r');
    advanceUntil(() => getDisplayedChoices(screen).length > 0);
    session.input(String(getDisplayedChoices(screen).indexOf('Cancel') + 1));
    expect(getPlainText(screen.buffer)).toContain('Action second');
    expect(getDisplayedChoices(screen)).toEqual([]);
    expect(box).toMatchObject({ x: 5, y: 3 });
    expect(settle).not.toHaveBeenCalled();
    // A real mouse activation can also move a direct sprite prop with no clips or prop asset ID.
    clickScene(session, 5, 3);
    advanceUntil(() => getDisplayedChoices(screen).length > 0);
    session.input(String(getDisplayedChoices(screen).indexOf('Right') + 1));
    advanceUntil(() => box.x === 7);
    expect(settle).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ instanceId: 'second' }));
  } finally {
    session.close();
  }
});

it('ignores occluded art and returns control after the player dismisses the unreachable-shelf dialogue', async () => {
  vi.useFakeTimers();
  const { session, current, screen, shelf, player, settle } = await createPropSlideFixture({
    player: { x: 0, y: 5 }, inaccessible: true,
  });
  try {
    const cover = new Prop('cover', 1, 1, 0, 0, new Sprite('cover', 1, 1, 0, 0, [
      { ...ink, ch: ' ', bg: { r: 1, g: 1, b: 1 } },
    ]), true);
    current.entities.push(cover);
    clickScene(session, 1, 1);
    expect(getPlainText(screen.buffer)).not.toContain('Action first');
    current.removeEntity(cover);
    clickScene(session, 1, 1);
    advanceUntil(() => getPlainText(screen.buffer).includes("I can't reach that."));
    expect(getDisplayedChoices(screen)).toEqual([]);
    expect(player.isWalking()).toBe(false);
    expect(shelf).toMatchObject({ x: 2, y: 2 });
    expect({ x: player.x, y: player.bottomY }).toEqual({ x: 0, y: 5 });
    expect(settle).not.toHaveBeenCalled();
    session.input('\r');
    expect(getPlainText(screen.buffer)).not.toContain("I can't reach that.");
    clickScene(session, 1, 5);
    advanceUntil(() => player.x === 1);
  } finally {
    session.close();
  }
});

it.each(['before', 'during'])('still slides safely when a walking obstacle arrives %s the shove walk', async (when) => {
  vi.useFakeTimers();
  const { session, screen, current, player, shelf, settle } = await createPropSlideFixture();
  try {
    clickScene(session, 1, 1);
    advanceUntil(() => getDisplayedChoices(screen).length > 0);
    expect(getDisplayedChoices(screen)).toContain('Right');
    const blocker = new Prop('blocker', 0, 2, 0, 0, new Sprite('blocker', 1, 1, 0, 0, [ink]),
      false, undefined, [{ x: 0, y: 0 }]);
    if (when === 'before') current.entities.push(blocker);
    session.input('2');
    expect(player.isWalking()).toBe(when === 'during'); // Already clear of the slide if the shove walk is blocked.
    expect(shelf.x).toBe(2);
    if (when === 'during') current.entities.push(blocker);
    advanceUntil(() => settle.mock.calls.length > 0);
    expect(shelf).toMatchObject({ x: 4, y: 2 });
    expect({ x: player.x, y: player.bottomY }).not.toEqual({ x: 0, y: 2 });
    if (when === 'before') expect({ x: player.x, y: player.bottomY }).toEqual({ x: 2, y: 0 });
  } finally {
    session.close();
  }
});

it('recomputes the puzzle path on arrival if a prop moves across the selected route', async () => {
  vi.useFakeTimers();
  const { session, screen, player, shelf, box, settle } = await createPropSlideFixture();
  try {
    clickScene(session, 1, 1);
    advanceUntil(() => getDisplayedChoices(screen).length > 0);
    session.input('2'); // Right was available when chosen.
    expect(player.isWalking()).toBe(true);
    box.x = 3;
    box.y = 2;
    advanceUntil(() => getPlainText(screen.buffer).includes('Push failed'));
    expect(player).toMatchObject({ x: 0, bottomY: 2 });
    expect(shelf).toMatchObject({ x: 2, y: 2 });
    expect(settle).not.toHaveBeenCalled();
  } finally {
    session.close();
  }
});

it.each(['emergency', 'API', 'close', 'scene change'] as const)(
  'interrupts via %s, restores both anchor and blockers, and does not settle',
  async (via) => {
    vi.useFakeTimers();
    const extraScript = via === 'scene change' ? `
#interrupt
timer,guardTimer,guard,34
@guardTimer(owner)
  +[position] = getPropPos(first)
  +?eq([position]->0, 3):{
    +waitMs(34)
    +changeScene(next)
  }
` : '';
    const fixture = await createPropSlideFixture({ extraScript });
    const { session, screen, current, shelf, settle, load } = fixture;
    try {
      clickScene(session, 1, 1);
      advanceUntil(() => getDisplayedChoices(screen).length > 0);
      session.input('2');
      advanceUntil(() => shelf.x === 3);
      if (via === 'emergency') session.input(CANCEL_UI_AND_OPEN_LOG_INPUT);
      else if (via === 'API') expect(session.cancelPropSlideInteraction()).toBe(true);
      else if (via === 'close') session.close();
      else await vi.advanceTimersByTimeAsync(34);
      expect(shelf).toMatchObject({ x: 2, y: 2 });
      expect(current.blockedCells.has(27)).toBe(true);
      vi.advanceTimersByTime(500);
      expect(settle).not.toHaveBeenCalled();
      expect(getPlainText(screen.buffer)).not.toContain('Push completed');
      if (via === 'scene change') expect(load).toHaveBeenCalledExactlyOnceWith('next');
      else expect(load).not.toHaveBeenCalled();
      if (via === 'API') {
        clickScene(session, 1, 1);
        advanceUntil(() => getDisplayedChoices(screen).length > 0);
      }
    } finally {
      session.close();
    }
  },
);
