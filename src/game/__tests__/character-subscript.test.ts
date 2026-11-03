import { expect, it } from 'vitest';
import { Character } from '../character.js';
import { findCharacter } from '../character-movement.js';
import { PlayerControl } from '../player-control.js';
import { ScriptRunner, parseRpgScript } from '../rpgscript/runtime.js';
import { commands } from '../scene-commands.js';
import { Scene } from '../scene.js';
import { Sprite } from '../sprite.js';

const ink = { ch: '@', fg: { r: 255, g: 255, b: 255 }, bg: { r: 0, g: 0, b: 0 } };

function createSubscriptRunner(source: string) {
  const sprite = new Sprite('actor', 1, 1, 0, 0, [ink]);
  const ralgo = new Character('ralgo-id', 0, 1, 0, sprite, 'actor', 'Ralgo', 'idle', 'right', 100);
  const eva = new Character('eva-id', 0, 2, 0, sprite, 'actor', 'Eva', 'idle', 'right', 100);
  const scene = new Scene('room', 8, 4, 'regular-z', ink, [ralgo, eva], [], new Set(), [], [], [
    { id: 'marker', name: 'board', x: 4, y: 1 },
    { id: 'eva-marker', name: 'evaBoard', x: 4, y: 2 },
  ]);
  const control = new PlayerControl(scene);
  const runner = new ScriptRunner(parseRpgScript(source, 'subscript.rpgscript', { commands }), {
    commands, context: { scene, playerControl: control },
    getCharacterId: (reference) => findCharacter(scene, reference, control.playerWalkCh).id,
    isCharacterBusy: (ownerId) => findCharacter(scene, ownerId, control.playerWalkCh).isBusy(),
  });
  return { ralgo, eva, scene, runner, control };
}

const moveScript = '@move(ch)\n+walkToMarker([ch], board)\n+:finish([ch])\n@finish(ch)\n+setFacing([ch], left)\n+tmp.finished=[ch]';

it('setBusy skips direct subscripts and character timers until cleared', () => {
  const { runner, ralgo } = createSubscriptRunner('#clock\ntimer,tick,Ralgo,50\n@lock\n+setBusy(Ralgo, true)\n+callChSubscript(Ralgo, tick)\n@unlock\n+[busy]=false\n+setBusy(ralgo-id, [busy])\n@tick(ch)\n+^count=0\n+count={count}+1');
  runner.restartTimers(['clock']);
  runner.start('lock');
  runner.updateTimers(150);
  expect(ralgo.isBusy()).toBe(true);
  expect(runner.getStorage('count')).toBeUndefined();
  runner.start('unlock');
  expect(ralgo.isBusy()).toBe(false);
  runner.updateTimers(0);
  expect(runner.getStorage('count')).toBeUndefined();
  runner.updateTimers(50);
  expect(runner.getStorage('count')).toBe(1);
});

it.each([true, false])('conversation busy state skips calls and clears on endConversation(%s)', (restore) => {
  const { runner, ralgo, control } = createSubscriptRunner('#clock\ntimer,tick,Ralgo,50\n@start\n+callChSubscript(Ralgo, tick)\n@tick(ch)\n+^count=0\n+count={count}+1');
  runner.restartTimers(['clock']);
  control.startConversation(ralgo);
  runner.start('start');
  runner.updateTimers(50);
  expect(ralgo.isBusy()).toBe(true);
  expect(runner.getStorage('count')).toBeUndefined();
  control.endConversation(restore);
  expect(ralgo.isBusy()).toBe(false);
  runner.start('start');
  runner.updateTimers(50);
  expect(runner.getStorage('count')).toBe(2);
});

it('keeps manual and conversation busy states independent', () => {
  const { runner, ralgo, eva, control } = createSubscriptRunner('@lock\n+setBusy(Ralgo, true)\n@unlock\n+setBusy(Ralgo, false)');
  runner.start('lock');
  control.startConversation(ralgo);
  control.endConversation(false);
  expect(ralgo.isBusy()).toBe(true);
  control.startConversation(ralgo);
  runner.start('unlock');
  expect(ralgo.isBusy()).toBe(true);
  control.startConversation(eva);
  expect(ralgo.isBusy()).toBe(false);
  expect(eva.isBusy()).toBe(true);
  control.endConversation(false);
  expect(eva.isBusy()).toBe(false);
});

it('rejects invalid busy flags and missing characters', () => {
  const { runner } = createSubscriptRunner('@badFlag\n+setBusy(Ralgo, 1)\n@badCharacter\n+setBusy(Missing, true)');
  expect(() => runner.start('badFlag')).toThrow('setBusy requires true or false');
  expect(() => runner.start('badCharacter')).toThrow('no character Missing');
});

it('lets the main runner show dialogue while a character waits, then shares globals and preserves locals through nested calls', () => {
  const { runner, scene, ralgo } = createSubscriptRunner(
    `@start\n+callChSubscript(Ralgo, move)\n+tmp.mainContinued=true\n@talk\nGuide: "Hello"\n${moveScript}`,
  );
  runner.start('start');
  expect(runner.isIdle()).toBe(true);
  expect(runner.getStorage('tmp.mainContinued')).toBe(true);
  expect(runner.getStorage('tmp.finished')).toBeUndefined();
  runner.start('talk');
  scene.update(200);
  runner.update();
  expect(ralgo).toMatchObject({ x: 4, facing: 'left' });
  expect(runner.getStorage('tmp.finished')).toBe('ralgo-id');
  expect(runner.dialogue?.text).toBe('Hello');
});

it('pauses a marker walk for a talk script, then resumes after endConv without an interruption error', () => {
  const { ralgo, scene, runner, control } = createSubscriptRunner(
    '@start\n+callChSubscript(Ralgo, move)\n@move(ch)\n+walkToMarker([ch], board)\n+tmp.arrived=true\n@talk\n+setConv()\nGuide: "Hello"\n+endConv()',
  );
  runner.start('start');
  scene.update(50);
  const pausedX = ralgo.x;
  control.startConversation(ralgo);
  runner.start('talk');
  scene.update(200);
  runner.update();
  expect(ralgo.x).toBe(pausedX);
  expect(runner.getStorage('tmp.arrived')).toBeUndefined();
  runner.advance();
  expect(ralgo.isWalking()).toBe(true);
  scene.update(200);
  runner.update();
  expect(ralgo.x).toBe(4);
  expect(runner.getStorage('tmp.arrived')).toBe(true);
});

it('deduplicates calls by resolved character ID and permits different characters to run independently', () => {
  const { runner, scene, ralgo, eva } = createSubscriptRunner(
    `@start\n+callChSubscript(Ralgo, move)\n+callChSubscript(ralgo-id, other)\n+callChSubscript(Eva, evaMove)\n@evaMove(ch)\n+walkToMarker([ch], evaBoard)\n@other(ch)\n+tmp.other=[ch]\n${moveScript}`,
  );
  runner.start('start');
  expect(ralgo.isWalking()).toBe(true);
  expect(eva.isWalking()).toBe(true);
  expect(runner.getStorage('tmp.other')).toBeUndefined();
  scene.update(1000);
  runner.update();
  runner.start('start');
  expect(runner.getStorage('tmp.other')).toBe('ralgo-id');
});

it('cancels character continuations when cleared for scene changes', () => {
  const { runner, scene } = createSubscriptRunner(`@start\n+callChSubscript(Ralgo, move)\n${moveScript}`);
  runner.start('start');
  runner.clearSubscripts();
  scene.update(1000);
  runner.update();
  expect(runner.getStorage('tmp.finished')).toBeUndefined();
});

it('keeps firing the main timer while a character task is waiting', () => {
  const { runner, scene, ralgo } = createSubscriptRunner(
    `#clock\ntimer,tick,50\n@tick\n+callChSubscript(Ralgo, move)\n+tmp.tickFinished=true\n${moveScript}`,
  );
  runner.restartTimers(['clock']);
  runner.updateTimers(50);
  expect(runner.isIdle()).toBe(true);
  runner.setStorage('tmp.tickFinished', false);
  scene.update(50);
  runner.update();
  runner.updateTimers(50);
  expect(runner.getStorage('tmp.tickFinished')).toBe(true);
  expect(runner.getStorage('tmp.finished')).toBeUndefined();
  expect(ralgo.isWalking()).toBe(true);
  scene.update(150);
  runner.update();
  expect(runner.getStorage('tmp.finished')).toBe('ralgo-id');
});

it('fires character timers during main dialogue, passes instance IDs, and skips busy characters', () => {
  const { runner, scene, ralgo } = createSubscriptRunner(
    '#clock\ntimer,move,Ralgo,50\n@talk\nGuide: "Hello"\n@move(ch)\n+^count=0\n+count={count}+1\n+received=[ch]\n+walkToMarker([ch], board)\n+arrived=true',
  );
  runner.restartTimers(['clock']);
  runner.start('talk');
  runner.updateTimers(49);
  expect(ralgo.isWalking()).toBe(false);
  runner.updateTimers(1);
  expect(ralgo.isWalking()).toBe(true);
  expect(runner.getStorage('received')).toBe('ralgo-id');
  expect(runner.getStorage('count')).toBe(1);
  runner.updateTimers(150);
  expect(runner.getStorage('count')).toBe(1);
  scene.update(200);
  runner.update();
  expect(runner.getStorage('arrived')).toBe(true);
  runner.updateTimers(0);
  expect(runner.getStorage('count')).toBe(1);
  runner.updateTimers(50);
  expect(runner.getStorage('count')).toBe(2);
  expect(runner.dialogue?.text).toBe('Hello');
});

it('applies timer conditions per character and clears schedules on scene change', () => {
  const { runner } = createSubscriptRunner('#clock\ntimer,?oncePerInstance():tick,Ralgo,50\n@tick(ch)\n+^count=0\n+count={count}+1');
  runner.restartTimers(['clock']);
  runner.updateTimers(50);
  runner.updateTimers(50);
  expect(runner.getStorage('count')).toBe(1);
  runner.restartTimers([]);
  runner.updateTimers(1000);
  expect(runner.getStorage('count')).toBe(1);
});

it.each([
  ['@move', 'expects 0 argument(s), got 1'],
  ['@move(a, b)', 'expects 2 argument(s), got 1'],
])('requires exactly one target parameter: %s', (header, error) => {
  const { runner } = createSubscriptRunner(`@start\n+callChSubscript(Ralgo, move)\n${header}`);
  expect(() => runner.start('start')).toThrow(error);
});

it('keeps character task ownership during nested forks and rejects background dialogue', () => {
  const { runner } = createSubscriptRunner('@start\n+callChSubscript(Ralgo, move)\n@move(ch)\n+callChSubscript([ch], move)\nGuide: "Hello"');
  expect(() => runner.start('start')).toThrow('Character subscripts cannot show dialogue');
  expect(runner.dialogue).toBeUndefined();
});
