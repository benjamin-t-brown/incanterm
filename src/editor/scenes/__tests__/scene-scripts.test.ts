import { expect, it } from 'vitest';
import { createScene } from '../../schema.js';
import { getSceneScriptReferences } from '../scene-scripts.js';

it('lists scene triggers and every script that declares them', () => {
  const scene = createScene('room');
  scene.triggers = [
    'entry',
    { id: 'door-region', trigger: 'door', event: 'action', x: 0, y: 0, width: 1, height: 1 },
    { id: 'unbound', trigger: '', event: 'load', x: 0, y: 0, width: 1, height: 1 },
    'missing',
  ];
  expect(getSceneScriptReferences(scene, { entry: ['room'], door: ['first', 'second'] })).toEqual([
    { trigger: 'entry', script: 'room' },
    { trigger: 'door', script: 'first' },
    { trigger: 'door', script: 'second' },
    { trigger: 'missing', script: null },
  ]);
});
