import { expect, it } from 'vitest';
import { parseRpgScript, ScriptRunner } from './test-support.js';

it('initializes a global once across calls and scripts, independently for each session', () => {
  const library = parseRpgScript('@start\n+^a=1\n@other\n+^a=2', 'static.rpgscript');
  const runner = new ScriptRunner(library);
  runner.start('start');
  expect(runner.getStorage('a')).toBe(1);
  runner.setStorage('a', 3);
  runner.start('start');
  runner.start('other');
  expect(runner.getStorage('a')).toBe(3);
  const second = new ScriptRunner(library);
  second.start('other');
  expect(second.getStorage('a')).toBe(2);
  runner.setStorage('a', undefined);
  runner.start('start');
  expect(runner.getStorage('a')).toBe(1);
});

it.each([0, false, ''])('preserves a defined falsy value: %s', (value) => {
  const runner = new ScriptRunner(parseRpgScript('@start\n+^a=1', 'static.rpgscript'));
  runner.setStorage('a', value);
  runner.start('start');
  expect(runner.getStorage('a')).toBe(value);
});

it('supports conditional assignments, dotted globals and typed values without altering locals', () => {
  const runner = new ScriptRunner(parseRpgScript(`@start
  +[a]=9
  +?is(true):+^a=1
  +?is(false):+^skipped=1
  +?is(true):{
    +^tmp.flag=false
    +^tmp.text="hello"
    +^tmp.copy={a}
  }
  +result=[a]`, 'static.rpgscript'));
  runner.start('start');
  expect(runner.getStorage('a')).toBe(1);
  expect(runner.getStorage('result')).toBe(9);
  expect(runner.getStorage('skipped')).toBeUndefined();
  expect(runner.getStorage('tmp.flag')).toBe(false);
  expect(runner.getStorage('tmp.text')).toBe('hello');
  expect(runner.getStorage('tmp.copy')).toBe(1);
});

it('supports indirect global keys', () => {
  const runner = new ScriptRunner(parseRpgScript('@start\n+key="tmp.value"\n+^{key}=4\n+^{key}=5', 'static.rpgscript'));
  runner.start('start');
  expect(runner.getStorage('tmp.value')).toBe(4);
});

it('rejects local targets', () => {
  expect(() => parseRpgScript('@start(a)\n+^[a]=1', 'static.rpgscript')).toThrow('cannot target local variables');
});
