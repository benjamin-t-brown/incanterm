import { expect, it } from 'vitest';
import { parseRpgScript, ScriptRunner } from './test-support.js';

it.each([
  ['|1, 2|', true],
  ['||', true],
  ['"hello"', true],
  ['"false"', true],
  ['""', false],
  ['false', false],
  ['0', false],
  ['', false],
])('uses truthiness for the script return <%s', (returned, expected) => {
  const scripts = parseRpgScript(
    `
    @start
      +truthy=?is(+:read())
      +falsy=?isnot(+:read())
    @read
      <${returned}
    `,
    'truthiness.rpgscript',
  );
  const runner = new ScriptRunner(scripts);
  runner.start('start');
  expect(runner.getGlobal('truthy')).toBe(expected);
  expect(runner.getGlobal('falsy')).toBe(!expected);
});

it('resumes the same condition after dialogue, preserving typed arguments and the return value', () => {
  const scripts = parseRpgScript(
    `
    @start
      +[expected]="open"
      +?all(once(door),eq(+:read([expected]), "open")):{
        +opened=true
      }
    @read(value)
      +^calls=0
      +calls={calls}+1
      Guide: "Checking"
      <[value]
    `,
    'condition-call.rpgscript',
  );
  const runner = new ScriptRunner(scripts);
  runner.start('start');
  expect(runner.dialogue?.text).toBe('Checking');
  expect(runner.getGlobal('opened')).toBeUndefined();
  runner.advance();
  expect(runner.isIdle()).toBe(true);
  expect(runner.getGlobal('opened')).toBe(true);
  expect(runner.getGlobal('calls')).toBe(1);
  runner.start('start');
  expect(runner.isIdle()).toBe(true);
  expect(runner.getGlobal('calls')).toBe(1);
});

it('commits a false assignment and short-circuits calls in boolean conditions', () => {
  const runner = new ScriptRunner(
    parseRpgScript(
      `
      @start
        +skippedCall=?all(is(false), is(+:unreachable()))
        +atLeast=?gte(+:number(2), 2)
        +quoted=?eq("+:unreachable()", "+:unreachable()")
        +matchesText=?eq(+:word(), "false")
        +matchesBoolean=?eq(+:word(), false)
        +zeroText=?eq(+:asText(), "0")
        +zeroNumber=?eq(+:asText(), 0)
        +zeroBelowOne=?lt(+:asText(), 1)
      @number(n)
        <[n]
      @word
        <"false"
      @asText
        <"0"
      `,
      'condition-short-circuit.rpgscript',
    ),
  );
  runner.start('start');
  expect(runner.getGlobal('skippedCall')).toBe(false);
  expect(runner.getGlobal('atLeast')).toBe(true);
  expect(runner.getGlobal('quoted')).toBe(true);
  expect(runner.getGlobal('matchesText')).toBe(true);
  expect(runner.getGlobal('matchesBoolean')).toBe(false);
  expect(runner.getGlobal('zeroText')).toBe(true);
  expect(runner.getGlobal('zeroNumber')).toBe(false);
  expect(runner.getGlobal('zeroBelowOne')).toBe(true);
});

it('reports invalid call arguments and disallows yielding calls in trigger conditions', () => {
  const runner = new ScriptRunner(
    parseRpgScript('@start\n+?is(+:read()):{\n<\n}\n@read(arg)\n<[arg]', 'calls.rpgscript'),
  );
  expect(() => runner.start('start')).toThrow(
    'calls.rpgscript:2: Script read expects 1 argument(s)',
  );
  expect(() =>
    parseRpgScript('#door\naction,+?is(+:read()):read\n@read\n<true', 'trigger.rpgscript'),
  ).toThrow('trigger.rpgscript:2: Script calls are not supported in trigger conditions');
  expect(() => parseRpgScript('@start\n+result=?lt(+:start())', 'lt.rpgscript')).toThrow(
    'lt.rpgscript:2: Invalid arguments for condition lt',
  );
});
