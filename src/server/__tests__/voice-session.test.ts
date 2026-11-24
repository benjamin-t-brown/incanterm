import { expect, it, vi } from 'vitest';
import { createSceneFixture } from '../../game/__tests__/scene-fixture.js';
import { Character } from '../../game/character.js';
import { parseRpgScript } from '../../game/rpgscript/__tests__/test-support.js';
import { Scene } from '../../game/scene.js';
import { Sprite } from '../../game/sprite.js';
import { CANCEL_UI_AND_OPEN_LOG_INPUT } from '../../protocol/input.js';
import type { VoiceMessage } from '../../protocol/messages.js';
import { createGameSession } from '../game-session.js';

it('starts on dialogue, ignores redraw and reveal, stops on advance or cancellation', () => {
  vi.useFakeTimers();
  const scripts = parseRpgScript([
    '#entry', 'load,start', '@start',
    '+:repeat()', '+:repeat()',
    '+playDialogue(Guide, "No request.", "", "v_old", "no-voice")',
    'Guide: "Text only."',
    '+playDialogue(Guide, "Last message.", "", "v_last")',
    '@repeat', '+playDialogue(Guide, "Repeated message.", "", "v_repeat")',
  ].join('\n'), 'voice.rpgscript');
  const cues: VoiceMessage[] = [];
  const getChecksum = vi.fn(() => 'a'.repeat(64));
  const session = createGameSession(createSceneFixture(), () => {}, scripts, undefined,
    undefined, undefined, undefined, undefined, undefined, undefined, false, [], undefined,
    undefined, undefined, undefined, { getChecksum, send: (cue) => cues.push(cue) });
  const start = { type: 'voice-start', checksum: 'a'.repeat(64) };
  const stop = { type: 'voice-stop' };
  try {
    session.open();
    session.resize(82, 24);
    session.input(' '); // reveal
    expect(cues).toEqual([start]);
    session.input(' '); // advance
    session.input(' '); // reveal
    expect(cues).toEqual([start, stop, start]);
    session.input(' ');
    expect(cues).toEqual([start, stop, start, stop]);
    for (let i = 0; i < 4; i++) session.input(' ');
    expect(cues).toEqual([start, stop, start, stop, start]);
    expect(getChecksum.mock.calls.length).toBe(3);
    session.input(CANCEL_UI_AND_OPEN_LOG_INPUT);
    expect(cues).toEqual([start, stop, start, stop, start, stop]);
  } finally {
    session.close();
    vi.useRealTimers();
  }
});

it.each(['endConv()', 'changeScene(next)'])('stops voice when a background script runs %s mid-line', async (command) => {
  vi.useFakeTimers();
  const ink = { ch: '@', fg: { r: 255, g: 255, b: 255 }, bg: { r: 0, g: 0, b: 0 } };
  const sprite = new Sprite('actor', 1, 1, 0, 0, [ink]);
  const hero = new Character('hero', 0, 0, 0, sprite, 'actor', 'Hero', 'idle', 'right', 100);
  const scene = new Scene('first', 4, 4, 'bottom-up', ink, [hero], ['entry', 'clock']);
  const next = new Scene('next', 4, 4, 'bottom-up', ink, [], []);
  const scripts = parseRpgScript([
    '#entry', 'load,start', '#clock', 'timer,finish,Hero,100', '@start', '+setPlayerWalkCh(hero)',
    '+setConv()', '+playDialogue(Guide, "A long line.", "", "v_first")', '@finish(ch)', `+${command}`,
  ].join('\n'), 'voice.rpgscript');
  const cues: VoiceMessage[] = [];
  const session = createGameSession(scene, () => {}, scripts, undefined, undefined, undefined, undefined,
    async () => next, undefined, undefined, false, [], undefined, undefined, undefined, undefined,
    { getChecksum: () => 'a'.repeat(64), send: (cue) => cues.push(cue) });
  try {
    session.open();
    expect(cues.map((cue) => cue.type)).toEqual(['voice-start']);
    await vi.advanceTimersByTimeAsync(204);
    expect(cues.map((cue) => cue.type)).toEqual(['voice-start', 'voice-stop']);
  } finally {
    session.close();
    vi.useRealTimers();
  }
});
