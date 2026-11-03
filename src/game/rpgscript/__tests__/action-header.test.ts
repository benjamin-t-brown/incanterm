import { describe, expect, it } from 'vitest';
import { ScriptParser, ScriptRunner, TriggerType, parseRpgScript } from './test-support.js';
import { formatRpgScript } from '../format.js';
import { getScriptNames } from '../../../editor/rpgscript/diagnose.js';

describe('action script headers', () => {
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
    ['#@poster\n#poster', 'Duplicate trigger poster'],
    ['#poster\n#@poster', 'Duplicate trigger poster'],
    ['@poster\n#@poster', 'Duplicate script poster'],
    ['#@poster\n@poster', 'Duplicate script poster'],
    ['#@', 'Invalid script signature'],
    ['#@poster(value)', 'cannot have parameters'],
  ])('rejects invalid declarations: %s', (source, message) => {
    expect(() => new ScriptParser('room.rpgscript').parse(source)).toThrow(message);
  });
});
