import { describe, expect, it } from 'vitest';
import { diagnoseScript, getScriptNames } from '../diagnose.js';

describe('RPGScript diagnose', () => {
  it('reports a structural parse error without guessing at the following lines', () => {
    expect(diagnoseScript('@intro\n+waitMs(', ['intro'])).toEqual([
      { line: 2, severity: 'error', message: expect.stringContaining('no end parens') },
    ]);
  });

  it('reports an invalid command argument, an unknown command, and a missing callScript target', () => {
    const source = [
      '@intro',
      '+waitMs()',
      '+dance()',
      "+callScript('missing')",
      'Guide: "Hello"',
    ].join('\n');
    expect(diagnoseScript(source, ['intro'])).toEqual([
      { line: 2, severity: 'error', message: expect.stringContaining('waitMs') },
      { line: 3, severity: 'warning', message: 'No command exists with name "dance"' },
      { line: 4, severity: 'error', message: 'No script exists with name "missing".' },
    ]);
  });

  it('accepts a known command and a script defined in the project', () => {
    const source = ['@intro', "+callScript('other')", '+waitMs(1)', '+barkProp(speaker, "Beep")'].join('\n');
    expect(diagnoseScript(source, ['intro', 'other'])).toEqual([]);
  });

  it('accepts the writer’s voice request and flags an invalid request mode', () => {
    const source = `@intro
+playDialogue("Tess", "Hi", "", "v_hi")
+playDialogue("Tess", "Bye", "", "v_bye", "no-voice")
+playDialogue("Tess", "Wait", "", "v_wait", "maybe")`;
    expect(diagnoseScript(source, ['intro'])).toEqual([
      { line: 4, severity: 'error', message: expect.stringContaining('playDialogue') },
    ]);
  });

  it.each(['result = ', '[local] = +', '?is(ready):+result = '])('reports invalid dialogue result assignment: %s', (assignment) => {
    expect(diagnoseScript(`@intro\n+${assignment}playDialogue(Ada, "Hello", "", "v_id")`, ['intro'])).toEqual([
      { line: 2, severity: 'error', message: expect.stringContaining('playDialogue does not return a value') },
    ]);
  });

  it('indexes inline trigger scripts without the trigger type or timer interval', () => {
    const source = '#@poster\n#action@talk\n#step@door\n#load@intro\n#timer@clock,250\n#plain';
    const names = getScriptNames(source);
    expect(names).toEqual(['poster', 'talk', 'door', 'intro', 'clock']);
    expect(diagnoseScript(`${source}\n@start\n+callScript("clock")`, names)).toEqual([]);
    expect(diagnoseScript('#timer@bad,0', [])).toEqual([
      { line: 1, severity: 'error', message: expect.stringContaining('Timer interval must be a positive number of milliseconds') },
    ]);
  });

  it('indexes parameterized scripts by name and skips invalid signatures and @this', () => {
    const source = [
      '@bad(1)',
      '@pushShelf(instance)',
      '@adjustShelf (instance, direction)',
      '@this',
      '@reset()',
    ].join('\n');
    expect(getScriptNames(source)).toEqual(['pushShelf', 'adjustShelf', 'reset']);
    expect(diagnoseScript(`@start\n+callScript("pushShelf")`, getScriptNames(source))).toEqual([]);
  });

  it('recognizes switch case blocks without hiding commands within them', () => {
    const source = ['@intro', '+?switch(true):{', '  eq({a}, 1): {', '    +dance()', '  }', '  *: {', '    +waitMs(1)', '  }', '}'].join('\n');
    expect(diagnoseScript(source, ['intro'])).toEqual([
      { line: 4, severity: 'warning', message: 'No command exists with name "dance"' },
    ]);
  });

  it('accepts timer declarations, current conversation commands, and contextual else blocks', () => {
    const source = `#watch
  timer,tick,750
@tick
  +setConv2(Scout, Pilot)
  +?once(firstVisit):{
    Scout: "Clear skies?"
  }
  +?else:{
    Pilot: "Still clear."
  }
  +endConv()`;
    expect(diagnoseScript(source, getScriptNames(source))).toEqual([]);
  });

  it('recognizes command results, boolean assignments, and script calls in conditions', () => {
    const source = `
@check
  +[pos]=+getChPos(player)
  +[result]=?lte([pos]->1, 1)
  <[result]
@start
  +[sceneId]=getSceneId()
  +sceneName=getSceneName()
  +?is(+:check()):{
    <
  }
`;
    expect(diagnoseScript(source, ['check', 'start'])).toEqual([]);
  });

  it('recognizes prop slide commands and reports invalid arguments', () => {
    const source = `@push(instance)
+[ready] = approachSlideProp([instance])
+[available] = getPropPushes([instance])
+[direction] = choosePropPush([instance])
+[settled] = slideProp([instance], [direction])
+[reset] = resetPropSlides(safe)
+approachSlideProp()
+slideProp([instance])
+slideProp([instance], northeast)
+resetPropSlides(safe, other)
+resetPropSlides()`;
    const diagnostics = diagnoseScript(source, ['push']);
    expect(diagnostics.map(({ line, severity }) => ({ line, severity }))).toEqual([
      { line: 7, severity: 'error' },
      { line: 8, severity: 'error' },
      { line: 9, severity: 'error' },
      { line: 10, severity: 'error' },
      { line: 11, severity: 'error' },
    ]);
    expect(diagnostics[2].message).toContain('direction must be left, right, up, or down');
    expect(diagnostics[4].message).toContain('safe marker name');
  });
});
