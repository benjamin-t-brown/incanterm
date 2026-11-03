import { expect, it } from 'vitest';
import { createScene, parseScene } from '../../schema.js';
import { copySceneObjects, pasteSceneObjects } from '../scene-clipboard.js';
import { addSceneMarker, getMarkerNameError } from '../scene-markers.js';

it('creates, validates, and copies uniquely named markers', () => {
  const scene = createScene('room', undefined, 8, 6);
  const marker = addSceneMarker(scene, 'Entrance', 3, 4);
  expect(marker).toMatchObject({ type: 'Marker', name: 'Entrance', x: 3, y: 4 });
  expect(getMarkerNameError(scene, 'Entrance')).toContain('already in use');
  expect(getMarkerNameError(scene, 'Entrance', marker.id)).toBeNull();
  expect(parseScene(scene)).toEqual({ ok: true, value: scene });

  const clipboard = copySceneObjects(scene, [{ kind: 'entity', id: marker.id }]);
  const selected = pasteSceneObjects(scene, clipboard, { x: 5, y: 2 }, () => 'marker-copy');
  expect(selected).toEqual([{ kind: 'entity', id: 'marker-copy' }]);
  expect(scene.entities[1]).toMatchObject({ type: 'Marker', name: 'Entrance-2', x: 5, y: 2 });
  expect(parseScene(scene).ok).toBe(true);
  expect(parseScene({ ...scene, entities: [...scene.entities, { ...marker, id: 'third' }] })).toMatchObject({ ok: false });
});
