import { expect, it } from 'vitest';
import { parseRpgScript, ScriptRunner } from '../runtime.js';
import { sceneCommandsShim } from '../../scene-commands-shim.js';

function createExpressionRunner(source: string) {
  const errors: string[] = [];
  const runner = new ScriptRunner(parseRpgScript(source, 'math.rpgscript', { commands: sceneCommandsShim }), {
    commands: sceneCommandsShim,
    context: { writeLine: () => {}, promptChoice: async () => 0 },
    onCommandError: (error, location) => errors.push(`${location}: ${String(error)}`),
  });
  return { runner, errors };
}

it('increments globals and evaluates JavaScript arithmetic with locals and normal precedence', () => {
  const { runner, errors } = createExpressionRunner(`@start
  +^a=1
  +a={a}+1
  +[b]=({a}+2)*3
  +result=[b]/2-1
  +power=2**3
  +remainder=7%4
  +negative=-({a}+1)
  +decimal=1e2+.5
  +quoted="{a}+1"`);
  runner.start('start');
  expect(errors).toEqual([]);
  expect(runner.getStorage('a')).toBe(2);
  expect(runner.getStorage('result')).toBe(5);
  expect(runner.getStorage('power')).toBe(8);
  expect(runner.getStorage('remainder')).toBe(3);
  expect(runner.getStorage('negative')).toBe(-3);
  expect(runner.getStorage('decimal')).toBe(100.5);
  expect(runner.getStorage('quoted')).toBe('2+1');
  runner.start('start');
  expect(runner.getStorage('a')).toBe(3);
});

it.each([undefined, '1', 'abc', false])('logs and aborts the script when an operand is %s', (value) => {
  const { runner, errors } = createExpressionRunner('@start\n+a={a}+1\n+continued=true');
  runner.setStorage('a', value);
  runner.start('start');
  expect(errors).toHaveLength(1);
  expect(errors[0]).toContain('math.rpgscript:2');
  expect(errors[0]).toContain('must be a finite number');
  expect(runner.getStorage('a')).toBe(value);
  expect(runner.getStorage('continued')).toBeUndefined();
  expect(runner.isIdle()).toBe(true);
});

it.each(['1/0', '0/0'])('logs evaluation errors and aborts: %s', (expression) => {
  const { runner, errors } = createExpressionRunner(`@start\n+result=${expression}\n+continued=true`);
  runner.start('start');
  expect(errors).toHaveLength(1);
  expect(runner.getStorage('continued')).toBeUndefined();
  expect(runner.isIdle()).toBe(true);
});

it('does not evaluate an if-undefined initializer for an existing global', () => {
  const { runner, errors } = createExpressionRunner('@start\n+^a={missing}+1\n+continued=true');
  runner.setStorage('a', 0);
  runner.start('start');
  expect(errors).toEqual([]);
  expect(runner.getStorage('continued')).toBe(true);
});

it('aborts nested script calls and conditions on invalid arithmetic', () => {
  const { runner, errors } = createExpressionRunner('@start\n+:child()\n+continued=true\n@child\n+?gt({missing}+1, 2):+passed=true');
  runner.start('start');
  expect(errors).toHaveLength(1);
  expect(runner.getStorage('continued')).toBeUndefined();
  expect(runner.isIdle()).toBe(true);
});

it('rejects non-arithmetic JavaScript and undeclared local references', () => {
  expect(() => createExpressionRunner('@start\n+a=4)')).toThrow('Invalid storage assignment');
  expect(() => createExpressionRunner('@start\n+a=(globalThis.process.exit())')).toThrow('Invalid numeric expression');
  expect(() => createExpressionRunner('@start\n+a=[missing]+1')).toThrow('Unknown local [missing]');
});

it('stops a failing character task without stopping the main runner', () => {
  const { runner, errors } = createExpressionRunner('@start\n+callChSubscript(Ralgo, child)\n+mainContinued=true\n@child(ch)\n+a={missing}+1\n+childContinued=true');
  runner.start('start');
  expect(errors).toHaveLength(1);
  expect(runner.getStorage('mainContinued')).toBe(true);
  expect(runner.getStorage('childContinued')).toBeUndefined();
});
