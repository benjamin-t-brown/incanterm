import { expect, it } from 'vitest';
import { getEditorAssetUrl } from '../asset-url.js';

it('links selected props and preserves unrelated URL state', () => {
  expect(getEditorAssetUrl('http://localhost:7104/props?view=grid#details', 'brass-door')).toBe(
    '/props?view=grid&id=brass-door#details',
  );
  expect(getEditorAssetUrl('http://localhost:7104/props?view=grid&id=old#details', 'new')).toBe(
    '/props?view=grid&id=new#details',
  );
  expect(getEditorAssetUrl('http://localhost:7104/props?view=grid&id=old#details', null)).toBe(
    '/props?view=grid#details',
  );
  expect(getEditorAssetUrl('http://localhost:7104/art', 'sprite-one')).toBe('/art?id=sprite-one');
  expect(getEditorAssetUrl('http://localhost:7104/animation', 'walk')).toBe('/animation?id=walk');
});
