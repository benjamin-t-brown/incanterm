import { expect, it } from 'vitest';
import { createPropSlideScene } from '../../../game/__tests__/prop-slide-fixture.js';
import { createCharacter, type SceneDocument } from '../../schema.js';
import { addSceneCharacter } from '../scene-characters.js';
import { getSceneProblems } from '../scene-problems.js';
import { createNewSceneTrigger } from '../scene-triggers.js';

it('reports invalid and missing scene references without requiring a selected object', () => {
  const puzzle = createPropSlideScene();
  puzzle.entities[0].slidable = { actionScript: 'not a script' };
  puzzle.entities[1].prop = 'missing-shelf';
  const scene: SceneDocument = puzzle;
  const character = addSceneCharacter(scene, createCharacter('guide', 'idle'), 0, 0);
  character.talkScript = 'missingTalk';
  scene.triggers = ['missingLoad'];
  const region = createNewSceneTrigger(scene, { x: 0, y: 0, width: 1, height: 1 });

  expect(
    getSceneProblems(scene, {
      propIds: new Set(['shelf']),
      scripts: {},
      triggers: {},
      footprints: new Map(),
    }),
  ).toEqual([
    {
      target: { kind: 'entity', id: 'first', label: 'Shelf' },
      message: 'Enter a valid slide action script name before saving.',
    },
    {
      target: { kind: 'entity', id: 'second', label: 'Shelf' },
      message: 'Prop asset "missing-shelf" not found.',
    },
    {
      target: { kind: 'entity', id: 'second', label: 'Shelf' },
      message: 'Slide action script @pushShelf not found.',
    },
    {
      target: { kind: 'entity', id: character.id, label: character.name },
      message: 'Talk script @missingTalk not found.',
    },
    { message: 'RPGTrigger #missingLoad not found.' },
    {
      target: { kind: 'trigger', id: region.id, label: 'Region' },
      message: 'Select an RPGTrigger.',
    },
  ]);
});

it('checks shared slide footprints after loading and drops problems when placement is fixed', () => {
  const scene = createPropSlideScene();
  const [first, second] = scene.entities;
  first.x = 4;
  first.y = 1;
  second.x = first.x;
  second.y = first.y;
  scene.triggers.push('onLoad');
  const sources = {
    propIds: new Set(['shelf']),
    scripts: { pushShelf: ['puzzle'] },
    triggers: { onLoad: ['puzzle'] },
    footprints: new Map<string, { x: number; y: number }[]>(),
  };
  expect(getSceneProblems(scene, sources)).toEqual([]);
  sources.footprints.set('shelf', [{ x: 0, y: 0 }]);
  expect(getSceneProblems(scene, sources).map(({ target, message }) => [target?.id, message])).toEqual([
    ['first', 'Starts outside prop travel at (4, 1).'],
    ['first', 'Overlaps second at (4, 1).'],
    ['second', 'Starts outside prop travel at (4, 1).'],
    ['second', 'Overlaps first at (4, 1).'],
  ]);
  first.x = 2;
  second.x = 3;
  expect(getSceneProblems(scene, sources)).toEqual([]);
});
