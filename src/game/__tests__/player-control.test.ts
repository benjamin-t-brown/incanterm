import { afterEach, describe, expect, it, vi } from 'vitest';
import { Character } from '../character.js';
import { PlayerControl } from '../player-control.js';
import { findPath } from '../character-movement.js';
import { Scene, type ActionTrigger } from '../scene.js';
import { Sprite } from '../sprite.js';
import { ScriptRunner, TriggerType } from '../rpgscript/index.js';
import { parseRpgScript } from '../rpgscript/__tests__/test-support.js';
import { commands } from '../scene-commands.js';
import { createGameSession } from '../../server/game-session.js';
import { LayoutStandardScene } from '../../renderer/ui/layout-standard-scene.js';
import { CellBuffer } from '../cell-buffer.js';

const ink = { ch: '@', fg: { r: 255, g: 255, b: 255 }, bg: { r: 0, g: 0, b: 0 } };
const sprite = new Sprite('hero', 1, 1, 0, 0, [ink]);
const createHero = (id = 'hero', x = 1, y = 1) =>
  new Character(id, x, y, 0, sprite, 'actor', 'Player', 'idle', 'down', 100);
const createRoom = (characters: Character[], blocked: number[] = [], triggers: ActionTrigger[] = []) =>
  new Scene('room', 7, 7, 'bottom-up', ink, characters, [], new Set(blocked), triggers);

describe('player walking', () => {
  afterEach(() => vi.useRealTimers());

  it.each([
    { playerX: 1, playerY: 3, npcX: 2, npcY: 3, npcFacing: 'left', playerFacing: 'right' },
    { playerX: 3, playerY: 3, npcX: 2, npcY: 3, npcFacing: 'right', playerFacing: 'left' },
    { playerX: 2, playerY: 2, npcX: 2, npcY: 3, npcFacing: 'up', playerFacing: 'down' },
    { playerX: 2, playerY: 4, npcX: 2, npcY: 3, npcFacing: 'down', playerFacing: 'up' },
  ])('faces the clicked character toward the player at ($playerX, $playerY)', (
    { playerX, playerY, npcX, npcY, npcFacing, playerFacing },
  ) => {
    const player = createHero('hero', playerX, playerY);
    const npc = createHero('eva', npcX, npcY);
    const control = new PlayerControl(createRoom([player, npc]));
    control.setPlayerWalkCh('hero');
    const originalFacing = npc.facing;
    control.startConversation(npc);
    expect(npc.facing).toBe(npcFacing);
    expect(player.facing).toBe(playerFacing);
    control.endConversation(true);
    expect(npc.facing).toBe(originalFacing);
  });

  it('pauses an NPC and restores its destination, facing, animation clock and speed on endConv', () => {
    const player = createHero('hero', 0, 0);
    const npc = createHero('npc', 1, 3);
    npc.speed = 200;
    const scene = createRoom([player, npc]);
    const control = new PlayerControl(scene);
    npc.walkTo(scene, { x: 5, y: 3 });
    scene.update(60);
    const before = npc.getActivity();
    control.startConversation(npc);
    expect(npc.isWalking()).toBe(false);
    npc.facing = 'up';
    npc.state = 'talking';
    npc.speed = 500;
    npc.animate(90);
    const runner = new ScriptRunner(parseRpgScript('@start\n+setConv()\n+endConv()', 'conversation.rpgscript'), {
      commands, context: { scene, playerControl: control },
    });
    runner.start('start');
    expect(runner.getStorage('dialogue.active')).toBe(false);
    expect(npc.getActivity()).toEqual(before);
    scene.update(1000);
    expect(npc).toMatchObject({ x: 5, y: 3, state: 'idle' });
  });

  it('leaves an NPC in its scripted state with endConvNR', () => {
    const npc = createHero('npc', 1, 3);
    const scene = createRoom([createHero('hero', 0, 0), npc]);
    const control = new PlayerControl(scene);
    npc.walkTo(scene, { x: 5, y: 3 });
    control.startConversation(npc);
    npc.state = 'talking';
    npc.facing = 'left';
    const runner = new ScriptRunner(parseRpgScript('@start\n+setConv()\n+endConvNR()', 'conversation.rpgscript'), {
      commands, context: { scene, playerControl: control },
    });
    runner.start('start');
    scene.update(1000);
    expect(runner.getStorage('dialogue.active')).toBe(false);
    expect(npc).toMatchObject({ x: 1, y: 3, state: 'talking', facing: 'left' });
    expect(npc.isWalking()).toBe(false);
  });

  it('walks to the nearest reachable adjacent tile before starting the selected character script', () => {
    const player = createHero('hero', 1, 3);
    const npc = new Character('eva', 4, 3, 0, sprite, 'actor', 'Eva', 'idle', 'down', 100, new Map(), 'classroom1_EvaTalk');
    const scene = createRoom([player, npc], [3 * 7 + 3]);
    const control = new PlayerControl(scene);
    control.setPlayerWalkCh('hero');
    const run = vi.fn();
    control.click(4, 3, () => false, run);
    expect(run).not.toHaveBeenCalled();
    scene.update(1000);
    control.update();
    expect(Math.max(Math.abs(player.x - npc.x), Math.abs(player.bottomY - npc.bottomY))).toBe(1);
    expect(run).toHaveBeenCalledOnce();
    expect(run).toHaveBeenCalledWith('classroom1_EvaTalk', npc);
    control.update();
    expect(run).toHaveBeenCalledOnce();
  });

  it('starts immediately when adjacent and cancels dialogue on another click or unreachable character', () => {
    const player = createHero('hero', 1, 1);
    const npc = new Character('eva', 2, 1, 0, sprite, 'actor', 'Eva', 'idle', 'down', 100, new Map(), 'otherTalk');
    const control = new PlayerControl(createRoom([player, npc]));
    const run = vi.fn();
    control.setPlayerWalkCh('hero');
    control.click(2, 1, () => false, run);
    expect(run).toHaveBeenCalledOnce();
    player.x = 0;
    control.click(2, 1, () => false, run);
    control.click(0, 4, () => false, run);
    control.scene.update(1000);
    control.update();
    expect(run).toHaveBeenCalledOnce();
    const trapped = new PlayerControl(createRoom([createHero('hero', 0, 0), npc], [1, 7, 8]));
    trapped.setPlayerWalkCh('hero');
    trapped.click(2, 1, () => false, run);
    trapped.scene.update(1000);
    trapped.update();
    expect(run).toHaveBeenCalledOnce();
  });

  it('replaces a pending talk with a new floor destination', () => {
    const player = createHero('hero', 0, 0);
    const npc = new Character('eva', 5, 0, 0, sprite, 'actor', 'Eva', 'idle', 'left', 100, new Map(), 'evaTalk');
    const control = new PlayerControl(createRoom([player, npc]));
    control.setPlayerWalkCh('hero');
    const run = vi.fn();
    control.click(5, 0, () => false, run);
    control.scene.update(50);
    control.update();
    expect(run).not.toHaveBeenCalled();
    control.click(0, 4, () => false, run);
    control.scene.update(1000);
    control.update();
    expect(player).toMatchObject({ x: 0, y: 4 });
    expect(run).not.toHaveBeenCalled();
  });

  it('stops an approach when a click outside the room cancels pending talk', () => {
    const player = createHero('hero', 0, 0);
    const npc = new Character('eva', 5, 0, 0, sprite, 'actor', 'Eva', 'idle', 'left', 100, new Map(), 'evaTalk');
    const control = new PlayerControl(createRoom([player, npc]));
    control.setPlayerWalkCh('hero');
    const run = vi.fn();
    control.click(5, 0, () => false, run);
    control.scene.update(50);
    control.update();
    control.cancelTalk();
    const stopped = { x: player.x, y: player.y };
    control.scene.update(1000);
    control.update();
    expect(player).toMatchObject(stopped);
    expect(run).not.toHaveBeenCalled();
  });

  it('walks scripted NPCs independently of player selection and input', () => {
    const player = createHero('hero', 0, 0);
    const npc = createHero('npc', 0, 4);
    npc.speed = 200;
    const scene = createRoom([player, npc]);
    const control = new PlayerControl(scene);
    control.setPlayerWalkCh('hero');
    control.click(3, 0, () => false);
    const runner = new ScriptRunner(
      parseRpgScript(
        '@start(who,x,y)\n+chWalkToCoord([who], [x], [y])\n+setStorage(started,true)',
        'walk.rpgscript',
      ),
      { commands, context: { scene, playerControl: control } },
    );
    runner.start('start', ['npc', 3, 4]);
    expect(runner.isIdle()).toBe(true);
    expect(runner.getStorage('started')).toBe(true);
    scene.update(50);
    expect(player.x).toBe(1);
    expect(npc.x).toBe(0);
    control.stop();
    scene.update(50);
    expect(player.x).toBe(1);
    expect(npc).toMatchObject({ x: 1, y: 4, state: 'walk', facing: 'right' });
    scene.update(400);
    expect(npc).toMatchObject({ x: 3, y: 4, state: 'idle' });
    expect(control.playerWalkCh).toBe(player);
  });

  it.each([
    [{ x: 3, y: 1 }, 35],
    [{ x: 1, y: 3 }, 70],
    [{ x: 3, y: 3 }, 70],
  ])('uses directional step timing toward %o', (target, duration) => {
    const character = createHero();
    character.speed = 70;
    const scene = createRoom([character]);
    character.walkTo(scene, target);
    scene.update(duration - 1);
    expect(character).toMatchObject({ x: 1, y: 1, state: 'walk' });
    scene.update(1);
    expect(character.x).toBe(target.x === 1 ? 1 : 2);
    expect(character.y).toBe(target.y === 1 ? 1 : 2);
    scene.update(duration);
    expect(character).toMatchObject({ ...target, state: 'idle' });
  });

  it('keeps simultaneous walkers out of each other’s occupied cells', () => {
    const first = createHero('first', 0, 2),
      second = createHero('second', 4, 2);
    const scene = createRoom([first, second]);
    first.walkTo(scene, { x: 2, y: 2 });
    second.walkTo(scene, { x: 2, y: 2 });
    scene.update(200);
    expect(first).toMatchObject({ x: 2, y: 2, state: 'idle' });
    expect(second.state).toBe('idle');
    expect((second.x - 2) ** 2 + (second.bottomY - 2) ** 2).toBe(1);
  });

  it.each([
    ['chWalkToCoord(missing, 2, 2)', 'no character missing'],
    ['chWalkToCoord(hero, -1, 2)', 'destination is outside the scene'],
    ['chWalkToCoord(hero, 2.5, 2)', 'requires integer coordinates'],
    ['chWalkToCoord(hero, nope, 2)', 'requires integer coordinates'],
  ])('rejects invalid scripted movement: %s', (command, message) => {
    const scene = createRoom([createHero()]);
    const runner = new ScriptRunner(parseRpgScript(`@start\n+${command}`, 'walk.rpgscript'), {
      commands,
      context: { scene, playerControl: new PlayerControl(scene) },
    });
    expect(() => runner.start('start')).toThrow(message);
  });

  it('finds diagonal paths, detours around walls and refuses blocked corners and occupied feet', () => {
    const player = createHero();
    expect(findPath(createRoom([player]), player, { x: 3, y: 3 })).toEqual([
      { x: 2, y: 2 },
      { x: 3, y: 3 },
    ]);
    const scene = createRoom([player, createHero('other', 3, 3)], [2 + 2 * 7]);
    const path = findPath(scene, player, { x: 5, y: 5 });
    expect(path.length).toBeGreaterThan(4);
    expect(path).not.toContainEqual({ x: 2, y: 2 });
    expect(path).not.toContainEqual({ x: 3, y: 3 });
    const occupiedPath = findPath(scene, player, { x: 3, y: 3 });
    const destination = occupiedPath.at(-1);
    expect(destination).toBeDefined();
    if (!destination) throw new Error('Expected a reachable neighbor');
    expect((destination.x - 3) ** 2 + (destination.y - 3) ** 2).toBe(1);
    expect(findPath(createRoom([player], [1, 7, 9, 15]), player, { x: 2, y: 2 })).toEqual([]);
    expect(findPath(scene, player, { x: -1, y: 2 })).toEqual([]);
  });

  it('uses the bottom cell, respects speed, changes facing and returns to idle', () => {
    const tall = new Sprite('tall', 1, 2, 0, 0, [ink, ink]);
    const player = new Character('hero', 1, 0, 0, tall, 'actor', 'Player', 'idle', 'down', 100);
    const control = new PlayerControl(createRoom([player]));
    control.setPlayerWalkCh('Player');
    control.click(3, 3, () => false);
    expect(player.state).toBe('walk');
    control.scene.update(99);
    expect(player.x).toBe(1);
    control.scene.update(1);
    expect(player).toMatchObject({ x: 2, y: 1, facing: 'right', state: 'walk' });
    control.scene.update(100);
    expect(player).toMatchObject({ x: 3, y: 2, state: 'idle' });
    expect(player.bottomY).toBe(3);
  });

  it('rechecks other characters before stepping and approaches newly occupied destinations', () => {
    const player = createHero(),
      other = createHero('other', 5, 5);
    const control = new PlayerControl(createRoom([player, other]));
    control.setPlayerWalkCh('hero');
    control.click(2, 2, () => false);
    other.x = other.y = 2;
    control.scene.update(100);
    expect((player.x - 2) ** 2 + (player.bottomY - 2) ** 2).toBe(1);
    expect(player.state).toBe('idle');
  });

  it('approaches the nearest reachable tile across an impassable wall', () => {
    const player = createHero();
    const scene = createRoom(
      [player],
      Array.from({ length: 7 }, (_, y) => y * 7 + 3),
    );
    expect(findPath(scene, player, { x: 5, y: 4 }).at(-1)).toEqual({ x: 2, y: 4 });
    const control = new PlayerControl(scene);
    control.setPlayerWalkCh('hero');
    control.click(5, 4, () => false);
    control.scene.update(1000);
    expect(player).toMatchObject({ x: 2, y: 4, state: 'idle' });
  });

  it('uses straight-line distance for blocked targets and shorter paths to break ties', () => {
    const player = createHero('hero', 1, 3);
    const scene = createRoom([player], [3 * 7 + 3]);
    expect(findPath(scene, player, { x: 3, y: 3 })).toEqual([{ x: 2, y: 3 }]);
    player.x = 2;
    expect(findPath(scene, player, { x: 3, y: 3 })).toEqual([]);
  });

  it('prefers a diagonally closer tile even when reaching it requires walking farther', () => {
    const player = createHero('hero', 1, 4);
    const open = new Set([4 * 7 + 1, 3 * 7 + 1, 2 * 7 + 1, 2 * 7 + 2]);
    const scene = createRoom(
      [player],
      Array.from({ length: 49 }, (_, cell) => cell).filter((cell) => !open.has(cell)),
    );
    // (2,2) is sqrt(8) away; the starting tile (1,4) is 3 away.
    expect(findPath(scene, player, { x: 4, y: 4 }).at(-1)).toEqual({ x: 2, y: 2 });
  });

  it('uses each game context with one shared command registry and script library', () => {
    const scripts = parseRpgScript('@start\n+setPlayerWalkCh(Player)', 'control.rpgscript');
    const firstCharacter = createHero();
    const secondCharacter = createHero();
    const first = new PlayerControl(createRoom([firstCharacter]));
    const second = new PlayerControl(createRoom([secondCharacter]));
    const firstRunner = new ScriptRunner(scripts, {
      commands,
      context: { scene: first.scene, playerControl: first },
    });
    const secondRunner = new ScriptRunner(scripts, {
      commands,
      context: { scene: second.scene, playerControl: second },
    });
    firstRunner.start('start');
    expect(first.playerWalkCh).toBe(firstCharacter);
    expect(second.playerWalkCh).toBeUndefined();
    secondRunner.start('start');
    expect(second.playerWalkCh).toBe(secondCharacter);
    expect(first.playerWalkCh).toBe(firstCharacter);
  });

  it('runs actions first and walks when a once-per-instance action no longer activates', () => {
    const player = createHero();
    const control = new PlayerControl(
      createRoom(
        [player],
        [],
        [{ id: 'door-instance', trigger: 'door', x: 3, y: 3, width: 1, height: 1 }],
      ),
    );
    const runner = new ScriptRunner(
      parseRpgScript(
        '#door\naction,?oncePerInstance():enter\n@enter\n+setStorage(entered,true)\n@start(who)\n+setPlayerWalkCh([who])',
        'control.rpgscript',
      ),
      { commands, context: { scene: control.scene, playerControl: control }, writeLog: () => {} },
    );
    runner.start('start', ['Player']);
    const activate = (name: string, id: string) =>
      runner.dispatchTrigger(name, TriggerType.ACTION, id);
    control.click(3, 3, activate);
    control.scene.update(100);
    expect(runner.getStorage('entered')).toBe(true);
    expect(player.x).toBe(1);
    control.click(3, 3, activate);
    control.scene.update(100);
    expect(player.x).toBe(2);
    expect(() => control.setPlayerWalkCh('missing')).toThrow('no character missing');
  });

  it('lets a clicked action trigger finish a scripted walk to a marker', () => {
    const player = createHero();
    const scene = new Scene('room', 7, 7, 'bottom-up', ink, [player], [], new Set(), [
      { id: 'poster', trigger: 'poster', x: 5, y: 1, width: 1, height: 1 },
    ], [], [{ id: 'examine', name: 'examine1', x: 4, y: 1 }]);
    const control = new PlayerControl(scene);
    control.setPlayerWalkCh('hero');
    const errors: string[] = [];
    const runner = new ScriptRunner(parseRpgScript(
      '#poster\naction,look\n@look\n+setConv()\n+walkToMarker(player, examine1)\n+setFacing(player, up)\n+setStorage(arrived, true)',
      'poster.rpgscript',
    ), {
      commands, context: { scene, playerControl: control },
      onCommandError: (error) => errors.push(String(error)),
    });
    control.click(5, 1, (name, id) => runner.dispatchTrigger(name, TriggerType.ACTION, id));
    expect(player.isWalking()).toBe(true);
    expect(runner.getStorage('arrived')).toBeUndefined();
    scene.update(150);
    control.update();
    runner.update();
    expect(player).toMatchObject({ x: 4, y: 1, facing: 'up' });
    expect(runner.getStorage('arrived')).toBe(true);
    expect(errors).toEqual([]);
  });

  it('maps terminal clicks after resizing, isolates sessions and cleans up timers', () => {
    vi.useFakeTimers();
    const player = createHero();
    const scene = new Scene('room', 7, 7, 'bottom-up', ink, [player], ['load']);
    const scripts = parseRpgScript(
      '#load\nload,start\n@start\n+setPlayerWalkCh(hero)',
      'session.rpgscript',
    );
    const first: string[] = [],
      second: string[] = [];
    const a = createGameSession(scene, (text) => first.push(text), scripts);
    const b = createGameSession(scene, (text) => second.push(text), scripts);
    a.resize(100, 40);
    b.resize(100, 40);
    a.open();
    b.open();
    const layout = new LayoutStandardScene(scene);
    layout.render(new CellBuffer(100, 40, ink));
    let target: { x: number; y: number } | undefined;
    for (let y = 0; y < 40; y++)
      for (let x = 0; x < 100; x++) {
        const point = layout.getScenePoint(x, y);
        if (point?.x === 3 && point.y === 3) target = { x, y };
      }
    expect(target).toBeDefined();
    if (!target) throw new Error('Scene target is not visible');
    a.input(`\x1b[<0;${target.x + 1};`);
    a.input(`${target.y + 1}M`);
    vi.advanceTimersByTime(240);
    expect(first.at(-1)).not.toBe(second.at(-1));
    expect(player).toMatchObject({ x: 1, y: 1 });
    a.close();
    b.close();
    expect(vi.getTimerCount()).toBe(0);
  });
});
