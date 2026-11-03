import { describe, expect, it } from 'vitest';
import { parseRpgScript, ScriptRunner } from './test-support.js';

describe('RPGScript text substitution', () => {
  it('interpolates dialogue and text arguments at execution time without changing the compiled script', () => {
    const library = parseRpgScript(
      `@start
+setStorage(message, "Hello {name}, {name}! {missing} {score} {active}")
+setStorage(raw, {score})
+log("{message}")
Guide: "Welcome {name} / {missing} / {score} / {active}"
Guide: "Next {name}"
+playDialogue("{speaker}", "Score {score}")`,
      'substitution.rpgscript',
    );
    const logs: string[] = [];
    const runner = new ScriptRunner(library, (message) => logs.push(message));
    runner.setStorage('name', 'Ada');
    runner.setStorage('score', 0);
    runner.setStorage('active', false);
    runner.setStorage('speaker', 'Narrator');
    runner.start('start');
    expect(runner.getStorage('message')).toBe('Hello Ada, Ada!  0 false');
    expect(runner.getStorage('raw')).toBe(0);
    expect(logs).toEqual(['[RPGSCRIPT] Hello Ada, Ada!  0 false (substitution.rpgscript:4)']);
    expect(runner.dialogue).toEqual({ actor: 'Guide', text: 'Welcome Ada /  / 0 / false' });

    runner.setStorage('name', 'Bea');
    runner.setStorage('score', 8);
    runner.advance();
    expect(runner.dialogue?.text).toBe('Next Bea');
    runner.advance();
    expect(runner.dialogue).toEqual({ actor: 'Narrator', text: 'Score 8' });

    const second = new ScriptRunner(library, () => {});
    second.setStorage('name', 'Cy');
    second.start('start');
    expect(second.dialogue?.text).toBe('Welcome Cy /  /  / ');
    expect(second.getStorage('message')).toBe('Hello Cy, Cy!   ');
    expect(second.getStorage('raw')).toBeUndefined();
  });

  it('substitutes condition arguments while preserving typed whole-value references', () => {
    const logs: string[] = [];
    const runner = new ScriptRunner(
      parseRpgScript(
        `@start
+?eq("Hi {name}", "Hi Ada"):+log("matched")
+?eq({score}, 0):+log("zero")
+?is({enabled}):+log("enabled")
+?isnot({missing}):+log("missing")
+?eq({missing}, {alsoMissing}):+log("undefined")
+?eq("{missing}", ""):+log("empty text")
+?gt({score}, -1):+log("positive")`,
        'conditions.rpgscript',
      ),
      (message) => logs.push(message),
    );
    runner.setStorage('name', 'Ada');
    runner.setStorage('score', 0);
    runner.setStorage('enabled', true);
    runner.start('start');
    expect(logs.map((message) => message.split(' (')[0])).toEqual([
      '[RPGSCRIPT] matched',
      '[RPGSCRIPT] zero',
      '[RPGSCRIPT] enabled',
      '[RPGSCRIPT] missing',
      '[RPGSCRIPT] empty text',
      '[RPGSCRIPT] positive',
    ]);
  });

  it('interpolates a named once condition at evaluation time', () => {
    const logs: string[] = [];
    const runner = new ScriptRunner(
      parseRpgScript('@start\n+?once("seen-{name}"):+log("new {name}")', 'once.rpgscript'),
      (message) => logs.push(message),
    );
    runner.setStorage('name', 'Ada');
    runner.start('start');
    runner.start('start');
    runner.setStorage('name', 'Bea');
    runner.start('start');
    expect(logs.map((message) => message.split(' (')[0])).toEqual([
      '[RPGSCRIPT] new Ada',
      '[RPGSCRIPT] new Bea',
    ]);
  });

  it('substitutes both prompt types when shown, without changing static branch targets', () => {
    const library = parseRpgScript(
      `@start
+awaitChoice("Take {item}", "Skip {missing}")
$
Keep {item}:keep
Leave {missing}:leave
@keep
Guide: "Kept {item}"
@leave
Guide: "Left"`,
      'choices.rpgscript',
    );
    const runner = new ScriptRunner(library);
    runner.setStorage('item', 'key');
    runner.start('start');
    expect(runner.choice?.options).toEqual(['Take key', 'Skip ']);
    runner.setStorage('item', 'coin');
    runner.choose(0);
    expect(runner.choice?.options).toEqual(['Keep coin', 'Leave ']);
    runner.choose(0);
    expect(runner.dialogue?.text).toBe('Kept coin');
  });

  it('rejects references to undeclared locals', () => {
    expect(() => parseRpgScript('@start\nGuide: "Hello [name]"', 'bad.rpgscript')).toThrow(
      'bad.rpgscript:2: Unknown local [name]',
    );
  });
});
