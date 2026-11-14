import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createScene } from '../../editor/schema.js';
import { Prop, Scene } from '../scene.js';
import { Sprite } from '../sprite.js';

// A small, test-owned drawing target shared by loader, layout and transport tests.
export function createSceneFixtureDocuments() {
  const glyphs = ['+', '-', '|', ' ', '#'];
  const sprite = {
    format: 'incanterm-sprite',
    version: 1,
    id: 'target',
    width: 5,
    height: 3,
    originX: 2,
    originY: 2,
    cellPalette: glyphs.map((ch) => [ch, '#c8141e', '#141ec8']),
    cells: { indices: [...'+---+| # |+---+'].map((ch) => glyphs.indexOf(ch) + 1) },
  };
  const scene = createScene('fixture-room', undefined, 32, 10);
  scene.triggers = ['entry'];
  scene.entities = [
    { id: 'target', type: 'Prop', sprite: sprite.id, x: 16, y: 6, depthOffset: 0, z: 0 },
  ];
  return { scene, sprite };
}

export function createSceneFixture(): Scene {
  const { scene, sprite } = createSceneFixtureDocuments();
  const ink = { ch: ' ', fg: { r: 200, g: 20, b: 30 }, bg: { r: 20, g: 30, b: 200 } };
  const target = new Sprite(
    sprite.id,
    sprite.width,
    sprite.height,
    sprite.originX,
    sprite.originY,
    sprite.cells.indices.map((index) => ({ ...ink, ch: sprite.cellPalette[index - 1][0] })),
  );
  return new Scene(
    scene.id,
    scene.width,
    scene.height,
    scene.depthMode,
    ink,
    [new Prop('target', 16, 6, 0, 0, target)],
    scene.triggers.filter((trigger) => typeof trigger === 'string'),
  );
}

export async function createSceneFixtureAssets(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'incanterm-scene-fixture-'));
  try {
    const { scene, sprite } = createSceneFixtureDocuments();
    for (const folder of ['scenes', 'sprites', 'scripts']) await fs.mkdir(path.join(root, folder));
    await fs.writeFile(path.join(root, 'scenes', `${scene.id}.json`), JSON.stringify(scene));
    await fs.writeFile(path.join(root, 'sprites', `${sprite.id}.json`), JSON.stringify(sprite));
    await fs.writeFile(
      path.join(root, 'scripts', 'entry.rpgscript'),
      '#entry\nload,start\n@start\nGuide: "First fixture line."\nGuide: "Second fixture line."\n+:finish()\n@finish\nGuide: "Last fixture line."',
    );
    return root;
  } catch (error) {
    await fs.rm(root, { recursive: true, force: true });
    throw error;
  }
}
