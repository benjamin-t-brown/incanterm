import { expect, it } from 'vitest';
import {
  createCharacter,
  getPortraitEmotionNames,
  isPortraitEmotionValid,
  parseCharacter,
} from '../../schema.js';
import {
  getDialoguePortrait,
  type PortraitAsset,
  type PortraitAssets,
} from '../../../game/portrait-assets.js';

function createPortraitCharacter() {
  return {
    ...createCharacter('hero', 'idle'),
    scriptName: 'Hero',
    portraits: [
      { facing: 'right' as const, emotion: '', portrait: 'default' },
      { facing: 'right' as const, emotion: 'happy, smile / joy', portrait: 'happy' },
      { facing: 'left' as const, emotion: 'smile', portrait: 'left' },
    ],
  };
}

it('accepts comma and slash aliases without changing the stored emotion text', () => {
  const character = createPortraitCharacter();
  expect(getPortraitEmotionNames('happy, smile / joy')).toEqual(['happy', 'smile', 'joy']);
  expect(parseCharacter(character)).toMatchObject({
    ok: true,
    value: { portraits: character.portraits },
  });
});

it('rejects empty, repeated, and invalid aliases while allowing the blank default', () => {
  expect(isPortraitEmotionValid('')).toBe(true);
  for (const emotion of ['happy,', '/happy', 'happy,,joy', 'happy/happy', 'not happy', 'joy!']) {
    expect(isPortraitEmotionValid(emotion)).toBe(false);
    const character = createPortraitCharacter();
    character.portraits[1].emotion = emotion;
    expect(parseCharacter(character).ok).toBe(false);
  }
});

it('rejects overlapping aliases for the same direction', () => {
  const character = createPortraitCharacter();
  character.portraits.push({ facing: 'right', emotion: 'sad/joy', portrait: 'sad' });
  expect(parseCharacter(character).ok).toBe(false);
});

it('resolves each alias with facing and default fallback preserved', () => {
  const character = createPortraitCharacter();
  const asset: PortraitAsset = { width: 1, height: 1, frames: [], loop: false };
  const assets: PortraitAssets = Object.assign(
    new Map([
      ['default', { ...asset }],
      ['happy', { ...asset }],
      ['left', { ...asset }],
    ]),
    { characters: new Map([['Hero', character]]) },
  );
  for (const emotion of ['happy', 'smile', 'joy'])
    expect(getDialoguePortrait(assets, 'Hero', emotion)?.asset).toBe(assets.get('happy'));
  expect(getDialoguePortrait(assets, 'Hero', 'smile', 'left')?.asset).toBe(assets.get('left'));
  expect(getDialoguePortrait(assets, 'Hero', 'unknown')?.asset).toBe(assets.get('default'));
  expect(getDialoguePortrait(assets, 'Hero')?.asset).toBe(assets.get('default'));
});
