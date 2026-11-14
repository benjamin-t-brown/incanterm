import { describe, expect, it } from 'vitest';
import { parseRpgScript, ScriptRunner } from './test-support.js';

describe('RPGScript switch', () => {
  const source = `@pick(value, label)
  +tmp.a=[value]
  +?switch(tmp.a):{
    0: {
      +result="zero"
    }
    1: {
      +result="one"
      +tmp.a=99
    }
    false: {
      +result="boolean false"
    }
    true: {
      +result="boolean true"
    }
    "true": {
      +result="string true"
    }
    "false": {
      +result="string false"
    }
    "*": {
      +result="star"
    }
    a: {
      +result="bare a"
    }
    [label]: {
      +result="local"
    }
    {expected}: {
      +result="global"
    }
    *: {
      +result="default"
    }
  }`;

  it.each([
    [0, 'zero'], ['0', 'zero'], [1, 'one'], ['1', 'one'],
    [false, 'boolean false'], [true, 'boolean true'], ['true', 'string true'], ['false', 'string false'],
    ['*', 'star'], ['a', 'bare a'], ['local match', 'local'], ['global match', 'global'], ['other', 'default'],
  ])('matches %s as %s', (value, expected) => {
    const runner = new ScriptRunner(parseRpgScript(source, 'switch.rpgscript'));
    runner.setStorage('expected', 'global match');
    runner.setStorage('a', 'other');
    runner.start('pick', [value, 'local match']);
    expect(runner.getStorage('result')).toBe(expected);
  });

  it('uses bare names as literal strings, not storage lookups or the default', () => {
    const scripts = parseRpgScript(`@pick(value)
+?switch([value]):{
  a: {
    +result="a"
  }
  *: {
    +result="default"
  }
}`, 'switch.rpgscript');
    const runner = new ScriptRunner(scripts);
    runner.setStorage('a', 'other');
    runner.start('pick', ['other']);
    expect(runner.getStorage('result')).toBe('default');
    runner.start('pick', ['a']);
    expect(runner.getStorage('result')).toBe('a');
  });

  it('evaluates conditions in switch(true) in order and does not fall through', () => {
    const scripts = parseRpgScript(`@pick
+?switch(true):{
  lt({score}, 50): {
    +result="low"
  }
  lt({score}, 80): {
    +result="mid"
  }
  *: {
    +result="high"
  }
}`, 'switch.rpgscript');
    const runner = new ScriptRunner(scripts);
    for (const [score, result] of [[30, 'low'], [70, 'mid'], [90, 'high']] as const) {
      runner.setStorage('score', score);
      runner.start('pick');
      expect(runner.getStorage('result')).toBe(result);
    }
  });

  it('keeps case selection across dialogue and re-evaluates on each loop pass', () => {
    const scripts = parseRpgScript(`@pick
+[count]=0
+?while lt([count], 2):{
  +?switch([count]):{
    0: {
      Guide: "First"
      +[count]=1
    }
    1: {
      Guide: "Second"
      +[count]=2
    }
  }
}
+result=[count]`, 'switch.rpgscript');
    const runner = new ScriptRunner(scripts);
    runner.start('pick');
    expect(runner.dialogue?.text).toBe('First');
    runner.advance();
    expect(runner.dialogue?.text).toBe('Second');
    runner.advance();
    expect(runner.getStorage('result')).toBe(2);
  });

  it('treats quoted labels as literal strings, including brackets', () => {
    const scripts = parseRpgScript(`@pick
+?switch("[missing]"):{
  "[missing]": {
    +result="matched"
  }
}`, 'switch.rpgscript');
    const runner = new ScriptRunner(scripts);
    runner.start('pick');
    expect(runner.getStorage('result')).toBe('matched');
  });

  it('rejects malformed cases and cases after the default', () => {
    expect(() => parseRpgScript('@pick\n+?switch(a):{\n  1: +result=1\n}', 'switch.rpgscript'))
      .toThrow(/switch cases require a braced block/);
    expect(() => parseRpgScript('@pick\n+?switch(a):{\n  *: {\n  }\n  1: {\n  }\n}', 'switch.rpgscript'))
      .toThrow(/No case may follow the default/);
  });
});
