import { expect, it } from 'vitest';
import { parseRpgScript, ScriptRunner } from './test-support.js';

it('tracks independent repeating intervals and resets scene bindings', () => {
  const logs: string[] = [];
  const runner = new ScriptRunner(parseRpgScript(
    '#clock\ntimer,fast,250\ntimer,slow\n@fast\n+log("fast")\n@slow\n+log("slow")',
    'timer.rpgscript',
  ), (message) => logs.push(message));
  runner.restartTimers(['clock']);
  runner.updateTimers(249);
  expect(logs).toEqual([]);
  runner.updateTimers(1);
  runner.updateTimers(750);
  expect(logs).toEqual([expect.stringContaining('fast'), expect.stringContaining('fast'), expect.stringContaining('slow')]);
  runner.restartTimers([]);
  runner.updateTimers(1000);
  expect(logs).toHaveLength(3);
  runner.restartTimers(['clock']);
  runner.updateTimers(249);
  expect(logs).toHaveLength(3);
});

it.each(['scene', 'session'])('defers %s timers during dialogue and coalesces missed ticks', (scope) => {
  const logs: string[] = [];
  const runner = new ScriptRunner(parseRpgScript(
    '#clock\ntimer,this\n@clock\n+log("Tick!")\n@talk\nGuide: "Hello"',
    'timer.rpgscript',
  ), (message) => logs.push(message));
  runner.startTimers(scope === 'scene' ? ['clock'] : [], scope === 'session' ? ['clock'] : []);
  runner.start('talk');
  runner.updateTimers(3500);
  expect(logs).toEqual([]);
  runner.advance();
  runner.updateTimers(0);
  expect(logs).toEqual([expect.stringContaining('Tick!')]);
  runner.updateTimers(500);
  expect(logs).toEqual([expect.stringContaining('Tick!'), expect.stringContaining('Tick!')]);
});

it('starts fresh session clocks for each runner and schedules duplicate names only once', () => {
  const library = parseRpgScript('#clock\ntimer,this,100\n@clock\n+log("Tick!")', 'timer.rpgscript');
  const firstLog: string[] = [];
  const secondLog: string[] = [];
  const first = new ScriptRunner(library, (message) => firstLog.push(message));
  const second = new ScriptRunner(library, (message) => secondLog.push(message));
  first.startTimers(['clock'], ['clock', 'clock']);
  first.updateTimers(50);
  second.startTimers([], ['clock']);
  first.updateTimers(50);
  second.updateTimers(50);
  expect(firstLog).toHaveLength(1);
  expect(secondLog).toHaveLength(0);
  second.updateTimers(50);
  expect(secondLog).toHaveLength(1);
});

it.each(['0', '-1', 'NaN', 'Infinity', '', '100,200,300'])('rejects invalid timer interval %s', (interval) => {
  expect(() => parseRpgScript(`#clock\ntimer,clock,${interval}\n@clock`, 'timer.rpgscript'))
    .toThrow('Timer interval must be a positive number');
});
