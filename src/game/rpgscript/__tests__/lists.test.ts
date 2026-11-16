import { describe, expect, it } from 'vitest';
import { parseRpgScript, ScriptRunner } from './test-support.js';

describe('RPGScript indexed lists', () => {
  it('iterates over a global list, reads and updates an element', () => {
    const source = `@start
+items=|key, map, coin|
+[i]=0
+?while in([i], {items}):{
  +[item]={items}->[i]
  +[i]=[i]+1
}
+{items}->1="compass"
+result={items}->1
+count=[i]`;
    const runner = new ScriptRunner(parseRpgScript(source, 'lists.rpgscript'));
    runner.start('start');
    expect(runner.getGlobal('count')).toBe(3);
    expect(runner.getGlobal('items')).toEqual(['key', 'compass', 'coin']);
    expect(runner.getGlobal('result')).toBe('compass');
  });

  it('keeps local lists local and allows indexed assignments', () => {
    const runner = new ScriptRunner(parseRpgScript(`@start
+[items]=|1, 2|
+[items]->0=5
+answer=[items]->0`, 'lists.rpgscript'));
    runner.start('start');
    expect(runner.getGlobal('answer')).toBe(5);
    expect(runner.getGlobal('items')).toBeUndefined();
  });

  it('rejects invalid indexes without extending lists', () => {
    const runner = new ScriptRunner(parseRpgScript(`@start
+items=|1|
+{items}->1=3`, 'lists.rpgscript'));
    expect(() => runner.start('start')).toThrow('existing integer index');
    expect(runner.getGlobal('items')).toEqual([1]);
  });

  it('supports multiline, empty, and single-element lists without confusing local references', () => {
    const runner = new ScriptRunner(parseRpgScript(`@start
+[value]="hello"
+items=|
  [value],
  "a,b",
  3,
|
+empty=||
+[copy]=[value]
+one=|[value]|
+result={items}->0`, 'lists.rpgscript'));
    runner.start('start');
    expect(runner.getGlobal('items')).toEqual(['hello', 'a,b', 3]);
    expect(runner.getGlobal('empty')).toEqual([]);
    expect(runner.getGlobal('one')).toEqual(['hello']);
    expect(runner.getGlobal('result')).toBe('hello');
  });

  it('uses pipes for one bare string and rejects the old bracket literal', () => {
    const runner = new ScriptRunner(parseRpgScript('@start\n+one=|a|\n+copy={one}', 'lists.rpgscript'));
    runner.start('start');
    expect(runner.getGlobal('one')).toEqual(['a']);
    expect(() => parseRpgScript('@start\n+items=[1, 2]', 'lists.rpgscript')).toThrow();
  });

  it('reports an unterminated list at its opening line', () => {
    expect(() => parseRpgScript('@start\n+items=|\n  a,\n  b', 'lists.rpgscript'))
      .toThrow('lists.rpgscript:2: Unterminated list literal');
  });
});
