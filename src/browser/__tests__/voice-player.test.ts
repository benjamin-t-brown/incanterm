import { expect, it, vi } from 'vitest';
import { getVoiceClipUrl, VoicePlayer } from '../voice-player.js';

it('resolves clips on the dev proxy, the project preview port, and the deployed TLS origin', () => {
  const checksum = '0'.repeat(64);
  for (const [socket, origin] of [
    ['ws://localhost:7103/ws', 'http://localhost:7103'],
    ['ws://127.0.0.1:51722/ws', 'http://127.0.0.1:51722'],
    ['wss://play.example/ws', 'https://play.example'],
  ]) expect(getVoiceClipUrl(socket, checksum)).toBe(`${origin}/voice/${checksum}.mp3`);
});

function createAudio() {
  let finish!: () => void;
  let fail!: () => void;
  return {
    play: () => new Promise<void>((resolve, reject) => { finish = resolve; fail = reject; }),
    pause: vi.fn(), removeAttribute: vi.fn(), load: vi.fn(),
    finish: () => finish(), fail: () => fail(),
  };
}

it('detaches skipped audio before replacing it; late completion cannot resume the old cue', async () => {
  const first = createAudio();
  const second = createAudio();
  const clips = [first, second];
  let next = 0;
  const player = new VoicePlayer(() => clips[next++]);
  player.play('same-clip');
  player.play('same-clip');
  expect(first.removeAttribute).toHaveBeenCalledWith('src');
  expect(first.load).toHaveBeenCalledOnce();
  const pauses = first.pause.mock.calls.length;
  first.finish();
  await Promise.resolve();
  expect(first.pause.mock.calls.length).toBeGreaterThan(pauses);
  expect(second.pause).not.toHaveBeenCalled();
  player.stop();
  expect(second.pause).toHaveBeenCalledOnce();
});

it('stops on mute, skips muted cues, and handles rejected autoplay without blocking another line', async () => {
  const clips = [createAudio(), createAudio(), createAudio()];
  let next = 0;
  const createClip = vi.fn(() => clips[next++]);
  const player = new VoicePlayer(createClip);
  const [first, blocked] = clips;
  player.play('first');
  player.setEnabled(false);
  player.play('muted');
  expect(first.pause).toHaveBeenCalledOnce();
  expect(createClip).toHaveBeenCalledTimes(1);
  player.setEnabled(true);
  player.play('blocked');
  blocked.fail();
  await Promise.resolve();
  await Promise.resolve();
  expect(blocked.pause).toHaveBeenCalledOnce();
  player.play('next');
  expect(createClip).toHaveBeenCalledTimes(3);
});

it('ignores a canceled load rejecting after the same line starts again', async () => {
  const clips = [createAudio(), createAudio()];
  let next = 0;
  const player = new VoicePlayer(() => clips[next++]);
  player.play('same');
  player.stop();
  player.play('same');
  clips[0].fail();
  await Promise.resolve();
  await Promise.resolve();
  expect(clips[1].pause).not.toHaveBeenCalled();
  player.stop();
  expect(clips[1].pause).toHaveBeenCalledOnce();
});
