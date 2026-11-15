import { describe, expect, it } from 'vitest';
import { parseRpgScript, ScriptParser, ScriptRunner } from './test-support.js';
import { formatRpgScript } from '../format.js';

describe('RPGScript storage assignments', () => {
  it.each([
    ['a=true', 'setStorage(a, true)'],
    ['b={vars.tmp}', 'setStorage(b, {vars.tmp})'],
    ['c=4', 'setStorage(c, 4)'],
    ['vars.tmp = -2.5;', 'setStorage(vars.tmp, -2.5)'],
    ['my_key = "a,b=(c)?d:e"', 'setStorage(my_key, "a,b=(c)?d:e")'],
    ['old-key = false', 'setStorage(old-key, false)'],
    ["empty = ''", "setStorage(empty, '')"],
    ['literal = "{vars.tmp}"', 'setStorage(literal, "{vars.tmp}")'],
    ['{someVar}=2', 'setStorage({someVar}, 2)'],
    ['{vars.destination} = {vars.source};', 'setStorage({vars.destination}, {vars.source})'],
  ])('lowers %s to the same command as %s', (assignment, call) => {
    const parser = new ScriptParser('assign.rpgscript');
    expect(parser.parseCommand(assignment, 3)).toEqual(parser.parseCommand(call, 3));
  });

  it('uses the referenced destination name for both assignment forms', () => {
    const runner = new ScriptRunner(
      parseRpgScript(
        `@start
+someVar=a
+{someVar}=2
+setStorage({someVar}, 3)
+setStorage("{someVar}", 4)`,
        'assign.rpgscript',
      ),
    );
    runner.start('start');
    expect(runner.getGlobal('a')).toBe(3);
    expect(runner.getGlobal('someVar')).toBe('a');
    expect(runner.getGlobal('{someVar}')).toBe(4);
    expect(runner.isIdle()).toBe(true);
  });

  it('resolves destinations at execution time separately for each runner', () => {
    const library = parseRpgScript(
      `@start
Guide: "Pause"
+{vars.destination}={vars.source}
+?is(true):{
  +?is(true):+{vars.destination}={missing}
  +{vars.destination}=2
}
+?is(true):{vars.destination}=3`,
      'assign.rpgscript',
    );
    const first = new ScriptRunner(library);
    const second = new ScriptRunner(library);
    first.setGlobal('vars.destination', 'old');
    first.setGlobal('vars.source', false);
    second.setGlobal('vars.destination', 'other');
    first.start('start');
    second.start('start');
    first.setGlobal('vars.destination', 'new');
    first.advance();
    second.advance();
    expect(first.getGlobal('old')).toBeUndefined();
    expect(first.getGlobal('new')).toBe(3);
    expect(first.getGlobal('other')).toBeUndefined();
    expect(second.getGlobal('other')).toBe(3);
    expect(second.getGlobal('new')).toBeUndefined();
    const step = library.get('start')?.blocks[1].steps[0];
    if (step?.type !== 'setStorage') throw new Error('Expected storage assignment');
    expect(step.key).toEqual({ storageKey: 'vars.destination' });
    expect(Object.isFrozen(step.key)).toBe(true);
  });

  it('does not recursively substitute the value of the resolved destination', () => {
    const runner = new ScriptRunner(
      parseRpgScript('@start\n+someVar=a\n+a=b\n+{someVar}=2', 'assign.rpgscript'),
    );
    runner.start('start');
    expect(runner.getGlobal('a')).toBe(2);
    expect(runner.getGlobal('b')).toBeUndefined();
  });

  it.each([undefined, '', 4, false])('rejects a destination resolving to %s', (value) => {
    const runner = new ScriptRunner(parseRpgScript('@start\n+{someVar}=2', 'assign.rpgscript'));
    runner.setGlobal('someVar', value);
    expect(() => runner.start('start')).toThrow(
      'assign.rpgscript:2: setStorage requires a non-empty string key',
    );
    expect(runner.getGlobal('undefined')).toBeUndefined();
  });

  it('accepts bare dynamic assignments inside a block', () => {
    const runner = new ScriptRunner(
      parseRpgScript('@start\n+someVar=a\n+?is(true):{\n  {someVar}=2\n}', 'assign.rpgscript'),
    );
    runner.start('start');
    expect(runner.getGlobal('a')).toBe(2);
  });

  it.each(['{someVar=2', 'someVar}=2', '{}=2', '{{someVar}}=2'])(
    'rejects malformed destination %s with its source location',
    (source) => {
      expect(() => parseRpgScript(`@start\n+${source}`, 'bad.rpgscript')).toThrow(
        'bad.rpgscript:2:',
      );
    },
  );

  it('resolves references at execution time with their original types and session isolation', () => {
    const source = `@start
+a=true
+b={vars.tmp}
+c=4
Guide: "Pause"
+after={vars.tmp}
+setStorage(long_form, {vars.tmp})
+off={off_source}
+zero={zero_source}
+empty={empty_source}
+literal="{vars.tmp}"`;
    const library = parseRpgScript(source, 'assign.rpgscript');
    const first = new ScriptRunner(library);
    const second = new ScriptRunner(library);
    for (const runner of [first, second]) {
      runner.setGlobal('off_source', false);
      runner.setGlobal('zero_source', 0);
      runner.setGlobal('empty_source', '');
    }
    first.setGlobal('vars.tmp', 7);
    second.setGlobal('vars.tmp', 'second');
    first.start('start');
    second.start('start');
    expect(first.getGlobal('a')).toBe(true);
    expect(first.getGlobal('b')).toBe(7);
    expect(first.getGlobal('c')).toBe(4);
    expect(second.getGlobal('b')).toBe('second');
    first.setGlobal('vars.tmp', 9);
    first.advance();
    second.advance();
    expect(first.getGlobal('after')).toBe(9);
    expect(first.getGlobal('long_form')).toBe(9);
    expect(second.getGlobal('after')).toBe('second');
    expect(first.getGlobal('off')).toBe(false);
    expect(first.getGlobal('zero')).toBe(0);
    expect(first.getGlobal('empty')).toBe('');
    expect(first.getGlobal('literal')).toBe('9');
    expect(first.isIdle()).toBe(true);
    const step = library.get('start')?.blocks[1].steps[0];
    expect(step?.type).toBe('setStorage');
    if (step?.type === 'setStorage') {
      expect(step.value).toEqual({ storageKey: 'vars.tmp' });
      expect(Object.isFrozen(step.value)).toBe(true);
    }
  });

  it('works in nested and inline conditions without mistaking reference braces for blocks', () => {
    const source = `@start
+a=true
+vars.tmp=4
+?is(a):{
  +a=false
  +b={vars.tmp}
  +?eq(b, 4):{
    +nested=true
  }
  +after_nested={b}
}
+?else():{
  +wrong_branch=true
}
+?is(nested):+inline={after_nested}
+?else():+wrong_inline=true`;
    const formatted = formatRpgScript(source);
    const runner = new ScriptRunner(parseRpgScript(formatted, 'assign.rpgscript'));
    runner.start('start');
    expect(runner.getGlobal('a')).toBe(false);
    expect(runner.getGlobal('b')).toBe(4);
    expect(runner.getGlobal('nested')).toBe(true);
    expect(runner.getGlobal('after_nested')).toBe(4);
    expect(runner.getGlobal('inline')).toBe(4);
    expect(runner.getGlobal('wrong_branch')).toBeUndefined();
    expect(runner.getGlobal('wrong_inline')).toBeUndefined();
    expect(runner.isIdle()).toBe(true);
    expect(formatRpgScript(formatted)).toBe(formatted);
  });

  it.each(['a=', 'a=;', 'a=true, false', 'a=b=4', 'a={vars.tmp', 'a={}', 'a="missing', 'a=4)'])(
    'rejects malformed assignment %s with its source location',
    (assignment) => {
      expect(() => parseRpgScript(`@start\n+${assignment}`, 'bad.rpgscript')).toThrow(
        'bad.rpgscript:2: Invalid storage assignment',
      );
    },
  );

  it('assigns undefined from a missing reference and continues executing', () => {
    const logs: string[] = [];
    const runner = new ScriptRunner(
      parseRpgScript(
        '@testGoodbye\nGuide: "See you soon."\n+b={vars.tmp}\n+c=4\n+log("continued")',
        'test-room-triggers.rpgscript',
      ),
      (message) => logs.push(message),
    );
    runner.start('testGoodbye');
    expect(runner.dialogue).toEqual({ actor: 'Guide', text: 'See you soon.' });
    runner.advance();
    expect(runner.getGlobal('b')).toBeUndefined();
    expect(runner.getGlobal('c')).toBe(4);
    expect(logs).toEqual(['[RPGSCRIPT] continued (test-room-triggers.rpgscript:5)']);
    expect(runner.isIdle()).toBe(true);
  });

  it.each([
    ['shorthand', '+result={missing.path}'],
    ['long form', '+setStorage(result, {missing.path})'],
    ['inline conditional', '+?isnot(flag):+result={missing.path}'],
  ])('resolves any missing reference to undefined in %s', (_form, assignment) => {
    const runner = new ScriptRunner(
      parseRpgScript(`@start\n${assignment}\n+copy={result}\n+next=4`, 'assign.rpgscript'),
    );
    runner.start('start');
    expect(runner.getGlobal('result')).toBeUndefined();
    expect(runner.getGlobal('copy')).toBeUndefined();
    expect(runner.getGlobal('next')).toBe(4);
    expect(runner.isIdle()).toBe(true);
  });

  it('resolves an explicitly undefined source like a missing source', () => {
    const runner = new ScriptRunner(
      parseRpgScript('@start\n+setStorage(result, {source})\n+next=true', 'assign.rpgscript'),
    );
    runner.setGlobal('source', undefined);
    runner.start('start');
    expect(runner.getGlobal('result')).toBeUndefined();
    expect(runner.getGlobal('next')).toBe(true);
    expect(runner.isIdle()).toBe(true);
  });
});
