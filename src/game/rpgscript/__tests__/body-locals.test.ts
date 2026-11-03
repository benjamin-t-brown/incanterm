import { expect, it } from 'vitest';
import { parseRpgScript, ScriptRunner } from './test-support.js';

it('declares body locals without adding parameters or writing globals', () => {
  const library = parseRpgScript('@testReturn\n+[a]=1\n+result=[a]', 'locals.rpgscript');
  expect(library.get('testReturn')?.parameters).toEqual([]);
  const runner = new ScriptRunner(library);
  runner.start('testReturn');
  expect(runner.getStorage('result')).toBe(1);
  expect(runner.getStorage('a')).toBeUndefined();
});

it('isolates body locals in nested calls and resets them on each invocation', () => {
  const runner = new ScriptRunner(parseRpgScript(`@start
  +before=[a]
  +[a]=1
  +:child()
  +after=[a]
@child
  +setLocal(a, 2)
  +childValue=[a]`, 'locals.rpgscript'));
  for (let i = 0; i < 2; i++) {
    runner.start('start');
    expect(runner.getStorage('before')).toBeUndefined();
    expect(runner.getStorage('after')).toBe(1);
    expect(runner.getStorage('childValue')).toBe(2);
  }
});

it('scopes conditional assignments to the script, leaving skipped assignments undefined', () => {
  const runner = new ScriptRunner(parseRpgScript(`@start
  +?is(false):+[a]=1
  +?is(true):{
    +[b]=2
  }
  +resultA=[a]
  +resultB=[b]`, 'locals.rpgscript'));
  runner.start('start');
  expect(runner.getStorage('resultA')).toBeUndefined();
  expect(runner.getStorage('resultB')).toBe(2);
});

it('does not let a child read its caller locals or treat quoted assignments as declarations', () => {
  expect(() => parseRpgScript('@start\n+[a]=1\n@child\n+result=[a]', 'locals.rpgscript')).toThrow('Unknown local [a]');
  expect(() => parseRpgScript('@start\n+log("+[a]=1")', 'locals.rpgscript')).toThrow('Unknown local [a]');
});
