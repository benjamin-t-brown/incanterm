import { expect, it } from 'vitest';
import { encodeMessage, parseServerMessage } from '../messages.js';

it('accepts a voice checksum but never a URL or file path from a message', () => {
  const checksum = 'abc12345'.repeat(8);
  const play = { type: 'voice-start', checksum } as const;
  const stop = { type: 'voice-stop' } as const;
  expect(parseServerMessage(encodeMessage(play))).toEqual(play);
  expect(parseServerMessage(encodeMessage(stop))).toEqual(stop);
  for (const invalid of [undefined, '', checksum.slice(1), '/voice/test.mp3', 'https://example.org/sound.mp3']) {
    expect(parseServerMessage(JSON.stringify({ type: 'voice-start', checksum: invalid }))).toBeNull();
  }
});
