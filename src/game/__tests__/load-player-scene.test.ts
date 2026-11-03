import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import {
  createAnimation,
  createCharacter,
  createProp,
  createScene,
  parseCharacter,
  parseScene,
} from '../../editor/schema.js';
import { loadScene } from '../load-scene.js';
import { Character } from '../character.js';
import { findCharacter } from '../character-movement.js';
import { CellBuffer } from '../cell-buffer.js';

it('loads movement metadata, prop blocking, trigger instances and directional animation frames', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'incanterm-player-'));
  try {
    const write = async (folder: string, id: string, value: unknown) => {
      await fs.mkdir(path.join(root, folder), { recursive: true });
      await fs.writeFile(path.join(root, folder, `${id}.json`), JSON.stringify(value));
    };
    await write('sprites', 'body', {
      format: 'incanterm-sprite',
      version: 1,
      id: 'body',
      width: 2,
      height: 1,
      originX: 1,
      originY: 0,
      cells: [
        { ch: 'A', fg: '#ffffff', bg: '#000000' },
        { ch: 'B', fg: '#ffffff', bg: '#000000' },
      ],
    });
    const animation = createAnimation('idle');
    animation.frames = [{ sprite: 'body', index: 0, durationMs: 50 }];
    await write('animations', 'idle', animation);
    await write('animations', 'walking', {
      ...animation,
      id: 'walking',
      flipH: true,
      frames: [...animation.frames, { invisible: true, durationMs: 50 }],
    });
    const character = { ...createCharacter('actor', 'idle'), speed: 90, scriptName: 'SceneActor' };
    character.animations['walk-right'] = 'walking';
    await write('characters', 'actor', character);
    const prop = createProp('wall', { type: 'sprite', id: 'body', index: 0 });
    prop.width = 2;
    prop.blockedCells = [0];
    await write('props', 'wall', prop);
    const scene = createScene('room', undefined, 8, 6);
    scene.blockedCells = [0];
    scene.entities = [
      {
        id: 'hero',
        type: 'Character',
        character: 'actor',
        name: 'Player',
        talkScript: 'classroom1_EvaTalk',
        x: 2,
        y: 2,
        z: 0,
        state: 'idle',
        facing: 'down',
        speed: 120,
      },
      { id: 'wall', type: 'Prop', prop: 'wall', x: 5, y: 3, z: 0 },
    ];
    scene.triggers = [
      'entry',
      { id: 'clock', trigger: 'classroom1Updater', event: 'timer', x: 0, y: 0, width: 1, height: 1 },
      { id: 'door-1', trigger: 'door', event: 'action', x: 1, y: 1, width: 1, height: 1 },
      { id: 'door-2', trigger: 'door', event: 'action', x: 4, y: 1, width: 1, height: 1 },
      {
        id: 'step',
        trigger: 'step',
        event: 'action',
        x: 6,
        y: 1,
        width: 1,
        height: 1,
        actionEnabled: false,
        stepEnabled: true,
      },
    ];
    await write('scenes', 'room', scene);
    const loaded = await loadScene(root, 'room');
    expect(loaded.blockedCells).toEqual(new Set([0, 3 * 8 + 4]));
    expect(loaded.triggers).toEqual(['entry', 'classroom1Updater']);
    expect(loaded.actionTriggers.map((trigger) => trigger.id)).toEqual(['door-1', 'door-2']);
    expect(loaded.stepTriggers.map((trigger) => trigger.id)).toEqual(['step']);
    const hero = loaded.entities[0];
    expect(hero).toBeInstanceOf(Character);
    if (!(hero instanceof Character)) throw new Error('Missing character');
    expect(hero).toMatchObject({ speed: 120, instanceName: 'Player', characterId: 'actor', scriptName: 'SceneActor', talkScript: 'classroom1_EvaTalk' });
    for (const reference of ['hero', 'Player', 'actor', 'SceneActor']) {
      expect(findCharacter(loaded, reference)).toBe(hero);
    }
    expect(hero.clone().scriptName).toBe('SceneActor');
    hero.state = 'walk';
    hero.facing = 'right';
    hero.animate(0);
    const clear = { ch: ' ', fg: { r: 0, g: 0, b: 0 }, bg: { r: 0, g: 0, b: 0 } };
    const buffer = new CellBuffer(8, 6, clear);
    hero.draw(buffer, 0, 0);
    expect(buffer.get(1, 2).ch).toBe('B');
    hero.animate(50);
    const invisible = new CellBuffer(8, 6, clear);
    hero.draw(invisible, 0, 0);
    expect(invisible.get(1, 2).ch).toBe(' ');
    expect(parseCharacter(character)).toMatchObject({ ok: true, value: { speed: 90 } });
    expect(parseScene(scene)).toMatchObject({
      ok: true,
      value: { entities: [{ speed: 120, talkScript: 'classroom1_EvaTalk' }, {}] },
    });
    expect(parseCharacter({ ...character, speed: 0 }).ok).toBe(false);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
