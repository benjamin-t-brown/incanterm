import { expect, it } from 'vitest';
import { Character, type CharacterClip } from '../character.js';
import { PlayerControl } from '../player-control.js';
import { parseRpgScript, ScriptRunner } from '../rpgscript/runtime.js';
import { commands } from '../scene-commands.js';
import { Scene } from '../scene.js';
import { Sprite } from '../sprite.js';

function createDialogueRunner(source: string) {
  const ink = { ch: '.', fg: { r: 255, g: 255, b: 255 }, bg: { r: 0, g: 0, b: 0 } };
  const sprite = new Sprite('body', 1, 1, 0, 0, [ink]);
  const clips = new Map<string, CharacterClip>([
    ...(['up', 'down', 'left', 'right'] as const).flatMap((direction): [string, CharacterClip][] =>
      ['idle', 'walk', 'talking'].map((state) =>
        [`${state}-${direction}`, { frames: [{ sprite, durationMs: 50 }], loop: true }])),
    ['dance', { frames: [{ sprite, durationMs: 50 }], loop: true }],
  ]);
  const ada = new Character('ada-instance', 1, 1, 0, sprite, 'ada-asset', 'AdaInstance',
    'idle', 'left', 100, clips, undefined, 'Ada, Professor');
  const skye = new Character('skye-instance', 3, 1, 0, sprite, 'skye-asset', 'Skye',
    'idle', 'right', 100, clips);
  const scene = new Scene('room', 8, 4, 'regular-z', ink, [ada, skye]);
  const playerControl = new PlayerControl(scene);
  playerControl.setPlayerWalkCh('Skye');
  const runner = new ScriptRunner(parseRpgScript(source, 'dialogue.rpgscript', { commands }), {
    commands, context: { scene, playerControl },
  });
  return { ada, skye, scene, runner, clips };
}

it.each(['up', 'down', 'left', 'right'] as const)('animates idle speakers facing %s and idles the previous speaker', (facing) => {
  const { ada, skye, runner } = createDialogueRunner(
    '@start\nAda: "Hello"\nSkye: "Hi"\nAda: "Bye"',
  );
  ada.facing = facing;
  runner.start('start');
  expect(ada.state).toBe('talking');
  expect(ada.getActivity().visualKey).toBe(`talking-${facing}`);
  expect(skye.state).toBe('idle');
  runner.advance();
  expect(ada.state).toBe('idle');
  expect(ada.facing).toBe(facing);
  expect(skye.state).toBe('talking');
  runner.advance();
  expect(ada.state).toBe('talking');
  expect(skye.state).toBe('idle');
  runner.advance();
  expect(ada.state).toBe('idle');
  expect(runner.isIdle()).toBe(true);
});

it.each(['dance', 'talking', 'talking-left'])('preserves an explicitly selected %s state', (state) => {
  const { ada, runner } = createDialogueRunner('@start\nAda: "Hello"');
  ada.state = state;
  runner.start('start');
  expect(ada.state).toBe(state);
  runner.advance();
  expect(ada.state).toBe(state);
});

it('does not interrupt a walking speaker', () => {
  const { ada, scene, runner } = createDialogueRunner('@start\nAda: "Still walking"');
  ada.walkTo(scene, { x: 1, y: 3 });
  runner.start('start');
  expect(ada.state).toBe('walk');
  expect(ada.isWalking()).toBe(true);
  runner.advance();
  expect(ada.state).toBe('walk');
  expect(ada.isWalking()).toBe(true);
});

it('leaves speakers idle when their current facing has no talking clip', () => {
  const { ada, clips, runner } = createDialogueRunner('@start\nAda: "Hello"');
  clips.delete('talking-left');
  runner.start('start');
  expect(ada.state).toBe('idle');
  expect(runner.dialogue?.text).toBe('Hello');
  runner.advance();
  expect(ada.state).toBe('idle');
});

it('cleans up an interrupted line when another script starts', () => {
  const { ada, skye, runner } = createDialogueRunner(
    '@start\nAda: "Hello"\n@other\nSkye: "Excuse me"',
  );
  runner.start('start');
  expect(ada.state).toBe('talking');
  runner.start('other');
  expect(ada.state).toBe('idle');
  expect(skye.state).toBe('talking');
  runner.advance();
  expect(skye.state).toBe('idle');
});

it('cleans up the talking animation when dialogue is cancelled without advancing', () => {
  const { ada, runner } = createDialogueRunner('@start\nAda: "Hello"\n+continued=true');
  runner.start('start');
  expect(ada.state).toBe('talking');
  runner.cancel();
  expect(ada.state).toBe('idle');
  expect(runner.isIdle()).toBe(true);
  expect(runner.getGlobal('continued')).toBeUndefined();
});

it('returns to idle before choices and supports consecutive lines from the same speaker', () => {
  const { ada, runner } = createDialogueRunner(
    '@start\nAda: "First"\nAda: "Second"\n+awaitChoice("Ready?", "Continue")',
  );
  runner.start('start');
  runner.advance();
  expect(ada.state).toBe('talking');
  expect(runner.dialogue?.text).toBe('Second');
  runner.advance();
  expect(ada.state).toBe('idle');
  expect(runner.choice?.options).toEqual(['Continue']);
});

it('does not reset a new custom state or walk applied while a line is displayed', () => {
  const { ada, scene, runner } = createDialogueRunner('@start\nAda: "Hello"');
  runner.start('start');
  ada.setAnimationState('dance');
  runner.advance();
  expect(ada.state).toBe('dance');
  ada.setAnimationState('idle');
  runner.start('start');
  ada.walkTo(scene, { x: 1, y: 3 });
  runner.advance();
  expect(ada.state).toBe('walk');
  expect(ada.isWalking()).toBe(true);
});

it('resolves interpolated speaker aliases and explicit dialogue commands', () => {
  const { ada, skye, runner } = createDialogueRunner(
    '@start(who)\n+playDialogue("[who]", "Hello", happy)\nplayer: "Hi"',
  );
  runner.start('start', ['Professor']);
  expect(ada.state).toBe('talking');
  expect(runner.dialogue).toEqual({ actor: 'Professor', text: 'Hello', emotion: 'happy' });
  runner.advance();
  expect(ada.state).toBe('idle');
  expect(skye.state).toBe('talking');
});

it('allows off-scene and ambiguous speakers without animating unrelated instances', () => {
  const { ada, skye, scene, runner } = createDialogueRunner(
    '@start\nNarrator: "Elsewhere"\nAda: "Hello"',
  );
  const duplicate = ada.clone();
  scene.entities.push(duplicate);
  runner.start('start');
  expect(runner.dialogue?.actor).toBe('Narrator');
  expect(ada.state).toBe('idle');
  expect(skye.state).toBe('idle');
  runner.advance();
  expect(runner.dialogue?.actor).toBe('Ada');
  expect(ada.state).toBe('idle');
  expect(duplicate.state).toBe('idle');
  expect(skye.state).toBe('idle');
});
