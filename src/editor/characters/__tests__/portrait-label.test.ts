import { expect, it } from 'vitest';
import { getPortraitAssetLabel } from '../portrait-label.js';

it('shows spritesheet labels and frame numbers instead of stored asset IDs', () => {
  expect(getPortraitAssetLabel('sheet_with_underscores_2',
    { sheet_with_underscores: 'Eva Portraits' }, {})).toBe('Eva Portraits · Frame 3');
  expect(getPortraitAssetLabel('clip-id', {}, { 'clip-id': 'Eva Talking' })).toBe('Eva Talking');
  expect(getPortraitAssetLabel('deleted-id', {}, {})).toBe('Missing portrait asset');
});
