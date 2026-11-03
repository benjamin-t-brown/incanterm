import { expect, it } from 'vitest';
import { parseRpgScript, ScriptRunner } from './test-support.js';
import { ScriptRunner as RuntimeRunner } from '../runtime.js';
import { defineCommand } from '../command.js';
import { sceneCommandsShim } from '../../scene-commands-shim.js';

it('captures returned globals into a declared local on each call', () => {
  const runner = new ScriptRunner(parseRpgScript(`@testReturn1
  +[local]<+:testReturn2();
  +result=[local]
@testReturn2
  +^a=1
  +a={a} + 1
  <{a}`, 'returns.rpgscript'));
  runner.start('testReturn1');
  expect(runner.getStorage('result')).toBe(2);
  expect(runner.getStorage('local')).toBeUndefined();
  runner.start('testReturn1');
  expect(runner.getStorage('result')).toBe(3);
});

it('returns early from conditional blocks and preserves caller locals', () => {
  const runner = new ScriptRunner(parseRpgScript(`@start
  +[a]=10
  +[result]<+:child([a]);
  +result=[result]+[a]
@child(a)
  +?gt([a], 5):{
    +[a]=[a]+2
    <[a]
    +unreachable=true
  }
  <0`, 'returns.rpgscript'));
  runner.start('start');
  expect(runner.getStorage('result')).toBe(22);
  expect(runner.getStorage('unreachable')).toBeUndefined();
});

it.each([
  ['"1"', '1'], ['true', true], ['false', false], ['2+3*4', 14], ['"hello"', 'hello'], ['', undefined],
])('returns a typed value: <%s', (value, expected) => {
  const runner = new ScriptRunner(parseRpgScript(`@start\n+result<+:child();\n@child\n<${value}`, 'returns.rpgscript'));
  runner.start('start');
  expect(runner.getStorage('result')).toBe(expected);
});

it('returns undefined at the end and discards uncaptured returns', () => {
  const runner = new ScriptRunner(parseRpgScript('@start\n+[value]=1\n+[value]<+:empty();\n+result=[value]\n+:other()\n+continued=true\n@empty\n@other\n<2\n+unreachable=true', 'returns.rpgscript'));
  runner.start('start');
  expect(runner.getStorage('result')).toBeUndefined();
  expect(runner.getStorage('continued')).toBe(true);
  expect(runner.getStorage('unreachable')).toBeUndefined();
});

it('resumes the caller only after the callee finishes waiting and returns', () => {
  let ready = false;
  const commands = {
    ...sceneCommandsShim,
    waitForTest: defineCommand({
      parse: () => ({}),
      execute: (_step, context) => context.waitUntil(() => ready),
    }),
  };
  const runner = new RuntimeRunner(parseRpgScript('@start\n+[value]<+:child();\n+result=[value]\n@child\n+waitForTest()\n<42', 'returns.rpgscript', { commands }), {
    commands, context: { writeLine: () => {}, promptChoice: async () => 0 },
  });
  runner.start('start');
  expect(runner.isIdle()).toBe(false);
  expect(runner.getStorage('result')).toBeUndefined();
  ready = true;
  runner.update();
  expect(runner.getStorage('result')).toBe(42);
  expect(runner.isIdle()).toBe(true);
});

it('checks return call arguments and local references', () => {
  const runner = new ScriptRunner(parseRpgScript('@start\n+[value]<+:child();\n@child(arg)\n<[arg]', 'returns.rpgscript'));
  expect(() => runner.start('start')).toThrow('expects 1 argument(s), got 0');
  expect(() => parseRpgScript('@start\n<[missing]', 'returns.rpgscript')).toThrow('Unknown local [missing]');
});
