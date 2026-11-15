import { expect, it } from 'vitest';
import { parseRpgScript, ScriptRunner } from './test-support.js';

it('declares body locals without adding parameters or writing globals', () => {
  const library = parseRpgScript('@testReturn\n+[a]=1\n+result=[a]', 'locals.rpgscript');
  expect(library.get('testReturn')?.parameters).toEqual([]);
  const runner = new ScriptRunner(library);
  runner.start('testReturn');
  expect(runner.getGlobal('result')).toBe(1);
  expect(runner.getGlobal('a')).toBeUndefined();
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
    expect(runner.getGlobal('before')).toBeUndefined();
    expect(runner.getGlobal('after')).toBe(1);
    expect(runner.getGlobal('childValue')).toBe(2);
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
  expect(runner.getGlobal('resultA')).toBeUndefined();
  expect(runner.getGlobal('resultB')).toBe(2);
});

it('does not let a child read its caller locals or treat quoted assignments as declarations', () => {
  expect(() => parseRpgScript('@start\n+[a]=1\n@child\n+result=[a]', 'locals.rpgscript')).toThrow('Unknown local [a]');
  expect(() => parseRpgScript('@start\n+log("+[a]=1")', 'locals.rpgscript')).toThrow('Unknown local [a]');
});
