import { expect, it } from 'vitest';
import { createProp, parseProp } from '../../editor/schema.js';
import { Character } from '../character.js';
import { findExactPath } from '../character-movement.js';
import { PlayerControl } from '../player-control.js';
import { getPropClimbPath } from '../prop-climb.js';
import type { SlideCell } from '../prop-slide.js';
import { parseRpgScript, ScriptRunner } from '../rpgscript/runtime.js';
import { commands } from '../scene-commands.js';
import { Prop, Scene } from '../scene.js';
import { Sprite } from '../sprite.js';

const ink = { ch: '_', fg: { r: 255, g: 255, b: 255 }, bg: { r: 0, g: 0, b: 0 } };
const art = new Sprite('test-shelf', 1, 1, 0, 0, [ink]);
const landing = { x: 2, y: 0 };

function createShelf(
  id: string,
  x: number,
  y: number,
  base: SlideCell[],
  roof: SlideCell[],
  climbHeight?: number,
): Prop {
  return new Prop(id, x, y, 0, 0, art, false, undefined, [], { footprint: base, actionScript: 'push' }, roof, climbHeight);
}

function createStaircase({
  moved = false,
  detached = false,
  blocked = new Set(Array.from({ length: 192 }, (_, i) => i)),
} = {}): Scene {
  const low = createShelf('low', moved ? 9 : 7, 6,
    [{ x: 0, y: 2 }, { x: 1, y: 2 }, { x: 2, y: 2 }], [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }], 2);
  const angled = createShelf('angled', 4, 2,
    [{ x: 0, y: 6 }, { x: detached ? 1 : 2, y: 7 }], [{ x: 0, y: 1 }, { x: 1, y: 2 }, { x: 2, y: 3 }], 4);
  const tall = createShelf('tall', 3, 0, [{ x: 0, y: 7 }], [{ x: 0, y: 1 }], 6);
  return new Scene('test', 16, 12, 'bottom-up', ink, [low, angled, tall], [],
    blocked, [], [], [{ id: 'landing', name: 'Landing', ...landing }]);
}

it('finds a route up an angled roof from its lowest edge, ignoring walking blockers', () => {
  const path = getPropClimbPath(createStaircase(), landing);
  expect(path).toEqual([
    { kind: 'floor', x: 6, y: 8 },
    { kind: 'roof', instanceId: 'low', x: 7, y: 6 },
    { kind: 'roof', instanceId: 'angled', x: 6, y: 5 },
    { kind: 'roof', instanceId: 'angled', x: 5, y: 4 },
    { kind: 'roof', instanceId: 'angled', x: 4, y: 3 },
    { kind: 'roof', instanceId: 'tall', x: 3, y: 1 },
    { kind: 'landing', ...landing },
  ]);
});

it('rejects a moved shelf, bases that do not touch, and a landing beyond reach', () => {
  expect(getPropClimbPath(createStaircase({ moved: true }), landing)).toEqual([]);
  expect(getPropClimbPath(createStaircase({ detached: true }), landing)).toEqual([]);
  expect(getPropClimbPath(createStaircase(), { x: 1, y: 0 })).toEqual([]);
});

it('allows a two-row rise between shelves, but not three', () => {
  for (const rise of [2, 3]) {
    const first = createShelf('first', 5, 8, [{ x: 0, y: 0 }], [], 2);
    const second = createShelf('second', 4, 8, [{ x: 0, y: 0 }], [], 2 + rise);
    const scene = new Scene('rise', 10, 12, 'bottom-up', ink, [first, second]);
    const path = getPropClimbPath(scene, { x: 3, y: 3 });
    expect(path.length > 0).toBe(rise === 2);
  }
});

it('limits floor entry and the final landing to a rise of two rows', () => {
  const low = createShelf('low', 5, 8, [{ x: 0, y: 0 }], [], 2);
  const tall = createShelf('tall', 5, 8, [{ x: 0, y: 0 }], [], 3);
  const room = new Scene('entry', 10, 12, 'bottom-up', ink, [low]);
  expect(getPropClimbPath(room, { x: 6, y: 5 })).not.toEqual([]);
  expect(getPropClimbPath(room, { x: 6, y: 4 })).toEqual([]);
  expect(getPropClimbPath(new Scene('tall', 10, 12, 'bottom-up', ink, [tall]), { x: 6, y: 4 })).toEqual([]);
});

it('requires a reachable climb entry for the full width of the player’s feet', () => {
  const width = 12;
  const spot = { x: 9, y: 0 };
  const wide = new Sprite('wide-player', 3, 1, 1, 0, [ink, ink, ink]);
  const player = new Character('hero', 8, 8, 0, wide, 'hero', undefined, 'idle', 'up');
  const shelf = createShelf('shelf', 8, 3, [{ x: 0, y: 0 }], [], 2);
  // The two-column opening is too narrow for this player. A separate blocker
  // covers the geometrically closest entry, so the returned entry must differ.
  const wall = Array.from({ length: width }, (_, x) => x)
    .filter((x) => x !== 7 && x !== 8)
    .map((x) => 5 * width + x);
  const blocked = new Set([...wall, 3 * width + 7]);
  const scene = new Scene('walk-to-climb', width, 10, 'bottom-up', ink, [shelf, player], [], blocked);
  const [geometricEntry] = getPropClimbPath(scene, spot);
  expect(geometricEntry).toEqual({ kind: 'floor', x: 7, y: 3 });
  expect(getPropClimbPath(scene, spot, player)).toEqual([]);

  blocked.delete(5 * width + 9);
  const path = getPropClimbPath(scene, spot, player);
  expect(path.at(-1)).toEqual({ kind: 'landing', ...spot });
  expect(path[0]?.kind).toBe('floor');
  expect(findExactPath(scene, player, path[0])).toBeDefined();
  expect(path[0]).not.toEqual(geometricEntry);
  expect([player.x, player.bottomY]).toEqual([8, 8]);
});

it.each([
  { middleHeight: 4, levelHeight: 4, high: 6, valid: true },
  { middleHeight: undefined, levelHeight: 4, high: 6, valid: false },
  { middleHeight: 4, levelHeight: 4, high: 7, valid: false },
  { middleHeight: 4, levelHeight: 3, high: 5, valid: false },
])('uses touching bases and authored heights, not painted roof alignment or presence (%j)',
  ({ middleHeight, levelHeight, high, valid }) => {
    const base = [{ x: 0, y: 0 }];
    const starter = createShelf('start', 2, 8, base, [{ x: -1, y: -2 }], 2);
    const angled = createShelf('angled', 3, 8, base, [{ x: 3, y: -7 }], middleHeight);
    const level = createShelf('level', 4, 8, base, [], levelHeight);
    const tall = createShelf('tall', 5, 8, base, [], high);
    const scene = new Scene('height-route', 10, 12, 'bottom-up', ink, [starter, angled, level, tall]);
    const path = getPropClimbPath(scene, { x: 6, y: 2 });
    expect(path.flatMap(step => step.kind === 'roof' ? [step.instanceId] : [])).toEqual(
      valid ? ['start', 'angled', 'level', 'tall'] : [],
    );
  },
);

it('validates and round-trips roof cells and a climb height independently of other masks', () => {
  const asset = createProp('shelf', { type: 'sprite', id: 'art', index: 0 });
  const draft = { ...asset, width: 3, height: 2, blockedCells: [1], slideCells: [4], climbCells: [2, 0], climbHeight: 4 };
  expect(parseProp(draft)).toEqual({ ok: true, value: { ...draft, climbCells: [0, 2] } });
  expect(parseProp({ ...draft, climbCells: [6] })).toMatchObject({ ok: false });
  expect(parseProp({ ...draft, climbCells: [2, 2] })).toMatchObject({ ok: false });
  expect(parseProp({ ...draft, climbHeight: 0 })).toMatchObject({ ok: false });
  expect(parseProp({ ...draft, climbHeight: 1.5 })).toMatchObject({ ok: false });
});

it('returns floor-to-marker waypoints to RPGScript and recomputes after a shelf moves', () => {
  const scene = createStaircase({ blocked: new Set() });
  const player = new Character('hero', 6, 8, 0, art, 'hero', undefined, 'idle', 'right');
  scene.entities.push(player);
  const playerControl = new PlayerControl(scene);
  const script = parseRpgScript('@check\n+route=getPropClimbPath(Landing)', 'climb.rpgscript', { commands });
  const runner = new ScriptRunner(script, { commands, context: { scene, playerControl } });
  runner.start('check');
  expect(runner.getGlobal('route')).toEqual([]);
  playerControl.setPlayerWalkCh(player.id);
  runner.start('check');
  expect(runner.getGlobal('route')).toEqual([[6, 8], [7, 6], [6, 5], [5, 4], [4, 3], [3, 1], [2, 0]]);
  scene.entities[0].x += 2;
  runner.start('check');
  expect(runner.getGlobal('route')).toEqual([]);
});

it('exposes one centered character anchor per shelf and exact marker coordinates to RPGScript', () => {
  const scene = createStaircase({ blocked: new Set() });
  const wide = new Sprite('wide-player', 3, 1, 0, 0, [ink, ink, ink]);
  const player = new Character('hero', 6, 8, 0, wide, 'hero', undefined, 'idle', 'right');
  scene.entities.push(player);
  const playerControl = new PlayerControl(scene);
  playerControl.setPlayerWalkCh(player.id);
  const script = parseRpgScript(
    '@check\n+route=getPropClimbPath(Landing, shelfCenters)\n+marker=getMarkerPos(Landing)',
    'climb.rpgscript',
    { commands },
  );
  const runner = new ScriptRunner(script, { commands, context: { scene, playerControl } });
  runner.start('check');
  expect(runner.getGlobal('route')).toEqual([[6, 8], [7, 6], [4, 4], [2, 1], [2, 0]]);
  expect(runner.getGlobal('marker')).toEqual([2, 0]);
});
