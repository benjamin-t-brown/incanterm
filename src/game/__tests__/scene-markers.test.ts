import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { createScene } from '../../editor/schema.js';
import { loadScene } from '../load-scene.js';
import { CellBuffer } from '../cell-buffer.js';

it('loads marker positions without drawing or blocking them', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'incanterm-marker-'));
  try {
    const scene = createScene('room', undefined, 4, 3);
    scene.entities.push({ id: 'marker-1', type: 'Marker', name: 'Entrance', x: 2, y: 1 });
    await fs.mkdir(path.join(root, 'scenes'));
    await fs.writeFile(path.join(root, 'scenes', 'room.json'), JSON.stringify(scene));
    const loaded = await loadScene(root, 'room');
    expect(loaded.getMarker('Entrance')).toEqual({ id: 'marker-1', name: 'Entrance', x: 2, y: 1 });
    expect(loaded.entities).toEqual([]);
    expect(loaded.blockedCells.size).toBe(0);
    const buffer = new CellBuffer(4, 3, { ch: ' ', fg: { r: 0, g: 0, b: 0 }, bg: { r: 0, g: 0, b: 0 } });
    loaded.draw(buffer, 0, 0);
    expect(buffer.get(2, 1).ch).toBe(' ');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
