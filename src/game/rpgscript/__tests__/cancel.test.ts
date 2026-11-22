import { expect, it } from 'vitest';
import { PlayerControl } from '../../player-control.js';
import { commands } from '../../scene-commands.js';
import { Scene } from '../../scene.js';
import { parseRpgScript, ScriptRunner } from '../runtime.js';

it.each([
  'Guide: "Interrupted line"',
  '+showCenterToast("Interrupted toast")',
  '+awaitChoice("Which one?", "First", "Second")',
  '+waitMs(1000)',
])('cancels %s without continuing and allows a new script', (command) => {
  const ink = { ch: ' ', fg: { r: 255, g: 255, b: 255 }, bg: { r: 0, g: 0, b: 0 } };
  const scene = new Scene('room', 1, 1, 'regular-z', ink, []);
  const runner = new ScriptRunner(parseRpgScript(
    `@start\n+saved=42\n+:child()\n+parentContinued=true\n@child\n${command}\n+childContinued=true\n@next\n+nextRan=true`,
    'cancel.rpgscript',
    { commands },
  ), { commands, context: { scene, playerControl: new PlayerControl(scene) } });
  runner.start('start');
  expect(runner.isIdle()).toBe(false);
  runner.cancel();
  runner.cancel();
  runner.update();
  runner.advance();
  runner.dismissCenterToast();
  expect(runner.isIdle()).toBe(true);
  expect(runner.dialogue).toBeUndefined();
  expect(runner.choice).toBeUndefined();
  expect(runner.centerToast).toBeUndefined();
  expect(runner.getGlobal('parentContinued')).toBeUndefined();
  expect(runner.getGlobal('childContinued')).toBeUndefined();
  expect(runner.getGlobal('lastChoiceIndex')).toBeUndefined();
  expect(runner.getGlobal('saved')).toBe(42);
  runner.start('next');
  expect(runner.getGlobal('nextRan')).toBe(true);
});
