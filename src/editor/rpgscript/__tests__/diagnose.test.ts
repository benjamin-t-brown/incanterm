import { describe, expect, it } from 'vitest';
import { diagnoseScript, getScriptNames } from '../diagnose.js';

describe('RPGScript diagnose', () => {
  it('reports a parse error, an unknown command, and a missing callScript target', () => {
    const source = [
      '@intro',
      '+wait(',
      '+dance()',
      "+callScript('missing')",
      'Guide: "Hello"',
    ].join('\n');
    expect(diagnoseScript(source, ['intro'])).toEqual([
      { line: 2, severity: 'error', message: 'Invalid command, missing parentheses' },
      { line: 3, severity: 'warning', message: 'No command exists with name "dance"' },
      { line: 4, severity: 'error', message: 'No script exists with name "missing".' },
    ]);
  });

  it('accepts a known command and a script defined in the project', () => {
    const source = ['@intro', "+callScript('other')", '+wait(1)'].join('\n');
    expect(diagnoseScript(source, ['intro', 'other'])).toEqual([]);
  });

  it('indexes inline trigger scripts without the trigger type or timer interval', () => {
    const source = '#@poster\n#action@talk\n#step@door\n#load@intro\n#timer@clock,250\n#plain';
    const names = getScriptNames(source);
    expect(names).toEqual(['poster', 'talk', 'door', 'intro', 'clock']);
    expect(diagnoseScript(`${source}\n@start\n+callScript("clock")`, names)).toEqual([]);
    expect(diagnoseScript('#timer@bad,0', [])).toEqual([
      { line: 1, severity: 'error', message: 'Timer interval must be a positive number of milliseconds' },
    ]);
  });

  it('recognizes switch case blocks without hiding commands within them', () => {
    const source = ['@intro', '+?switch(true):{', '  eq({a}, 1): {', '    +dance()', '  }', '  *: {', '    +wait(1)', '  }', '}'].join('\n');
    expect(diagnoseScript(source, ['intro'])).toEqual([
      { line: 4, severity: 'warning', message: 'No command exists with name "dance"' },
    ]);
  });

  it('recognizes command results, boolean assignments, and script calls in conditions', () => {
    const source = `
@check
  +[pos]=+getChPos(player)
  +[result]=?lte([pos]->1, 1)
  <[result]
@start
  +?is(+:check()):{
    <
  }
`;
    expect(diagnoseScript(source, ['check', 'start'])).toEqual([]);
  });
});
