import { describe, expect, it } from 'vitest';
import { ScriptParser, ScriptRunner, TriggerType, parseRpgScript } from './test-support.js';
import { formatRpgScript } from '../format.js';
import { getScriptNames } from '../../../editor/rpgscript/diagnose.js';

describe('inline trigger script headers', () => {
  it('dispatches the same script through its action trigger and direct calls', () => {
    const source = '@before\n+log("before")\n  #@poster\nGuide: "Smile!"\n@after\n+:poster()';
    const parsed = new ScriptParser('room.rpgscript').parse(source);
    expect(parsed.triggers.poster).toMatchObject({
      name: 'poster',
      lineNum: 3,
      scriptCalls: [{ type: 'action', condition: true, scriptName: 'poster', line: 3 }],
    });
    expect(parsed.scripts.poster.lineNum).toBe(3);
    expect(parsed.scripts.poster.blocks[0].commands[0].i).toBe(4);
    const runner = new ScriptRunner(parseRpgScript(source, 'room.rpgscript'));
    expect(runner.dispatchTrigger('poster', TriggerType.LOAD)).toBe(false);
    expect(runner.dispatchTrigger('poster', TriggerType.ACTION)).toBe(true);
    expect(runner.dialogue?.text).toBe('Smile!');
    runner.advance();
    runner.start('after');
    expect(runner.dialogue?.text).toBe('Smile!');
    expect(getScriptNames(source)).toEqual(['before', 'poster', 'after']);
    expect(formatRpgScript('#@poster\nGuide: "Smile!"')).toBe('#@poster\n  Guide: "Smile!"');
  });

  it.each([
    ['action', TriggerType.ACTION],
    ['step', TriggerType.STEP],
    ['load', TriggerType.LOAD],
  ])('dispatches an inline %s trigger like its longhand equivalent', (header, type) => {
    const source = `#${header}@intro\nGuide: "Hello!"`;
    const library = parseRpgScript(source, 'room.rpgscript');
    const runner = new ScriptRunner(library);
    const otherType = type === TriggerType.LOAD ? TriggerType.ACTION : TriggerType.LOAD;
    expect(runner.dispatchTrigger('intro', otherType)).toBe(false);
    expect(runner.dispatchTrigger('intro', type)).toBe(true);
    expect(runner.dialogue?.text).toBe('Hello!');
  });

  it('schedules an inline timer using the interval in the header', () => {
    const source = '#timer@clock, 250\n+log("Tick!")';
    const parsed = new ScriptParser('room.rpgscript').parse(source);
    expect(parsed.triggers.clock.scriptCalls).toEqual([
      { type: TriggerType.TIMER, condition: true, scriptName: 'clock', line: 1, intervalMs: 250 },
    ]);
    expect(formatRpgScript(source)).toBe('#timer@clock, 250\n  +log("Tick!")');
    const logs: string[] = [];
    const runner = new ScriptRunner(parseRpgScript(source, 'room.rpgscript'), (message) =>
      logs.push(message),
    );
    runner.restartTimers(['clock']);
    runner.updateTimers(249);
    expect(logs).toHaveLength(0);
    runner.updateTimers(1);
    runner.updateTimers(250);
    expect(logs).toEqual([expect.stringContaining('Tick!'), expect.stringContaining('Tick!')]);
  });

  it.each([
    ['#@poster\n#poster', 'Duplicate trigger poster'],
    ['#poster\n#@poster', 'Duplicate trigger poster'],
    ['@poster\n#@poster', 'Duplicate script poster'],
    ['#@poster\n@poster', 'Duplicate script poster'],
    ['#@', 'Invalid script signature'],
    ['#@poster(value)', 'cannot have parameters'],
    ['#step@door\n#load@door', 'Duplicate trigger door'],
    ['#load@intro\n@intro', 'Duplicate script intro'],
    ['#load@intro,100', 'does not take arguments'],
    ['#timer@clock(a,b),250', 'cannot have parameters'],
    ['#item@pickUp', 'Unsupported shorthand trigger type'],
    ['#timer@clock', 'Timer interval must be a positive number'],
    ['#timer@clock,', 'Timer interval must be a positive number'],
    ['#timer@clock,0', 'Timer interval must be a positive number'],
    ['#timer@clock,-250', 'Timer interval must be a positive number'],
    ['#timer@clock,Infinity', 'Timer interval must be a positive number'],
    ['#timer@clock,250ms', 'Timer interval must be a positive number'],
    ['#timer@clock,Guide,250', 'Timer interval must be a positive number'],
  ])('rejects invalid declarations: %s', (source, message) => {
    expect(() => new ScriptParser('room.rpgscript').parse(source)).toThrow(message);
  });
});
