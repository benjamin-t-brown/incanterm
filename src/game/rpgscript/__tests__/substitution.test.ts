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
    runner.setGlobal('name', 'Ada');
    runner.setGlobal('score', 0);
    runner.setGlobal('active', false);
    runner.setGlobal('speaker', 'Narrator');
    runner.start('start');
    expect(runner.getGlobal('message')).toBe('Hello Ada, Ada!  0 false');
    expect(runner.getGlobal('raw')).toBe(0);
    expect(logs).toEqual(['[RPGSCRIPT] Hello Ada, Ada!  0 false (substitution.rpgscript:4)']);
    expect(runner.dialogue).toEqual({ actor: 'Guide', text: 'Welcome Ada /  / 0 / false' });

    runner.setGlobal('name', 'Bea');
    runner.setGlobal('score', 8);
    runner.advance();
    expect(runner.dialogue?.text).toBe('Next Bea');
    runner.advance();
    expect(runner.dialogue).toEqual({ actor: 'Narrator', text: 'Score 8' });

    const second = new ScriptRunner(library, () => {});
    second.setGlobal('name', 'Cy');
    second.start('start');
    expect(second.dialogue?.text).toBe('Welcome Cy /  /  / ');
    expect(second.getGlobal('message')).toBe('Hello Cy, Cy!   ');
    expect(second.getGlobal('raw')).toBeUndefined();
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
    runner.setGlobal('name', 'Ada');
    runner.setGlobal('score', 0);
    runner.setGlobal('enabled', true);
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

  it('compares numeric strings but rejects empty and nonnumeric values', () => {
    const logs: string[] = [];
    const script = '@start\n+?lt({roll}, 100):+log("below")\n+?gt({roll}, "10"):+log("above")';
    const library = parseRpgScript(script, 'numbers.rpgscript');
    const runner = new ScriptRunner(library, (message) => logs.push(message));
    runner.setGlobal('roll', ' 42 ');
    runner.start('start');
    expect(logs.map((message) => message.split(' (')[0])).toEqual(['[RPGSCRIPT] below', '[RPGSCRIPT] above']);

    for (const value of ['', 'nope', undefined]) {
      runner.setGlobal('roll', value);
      expect(() => runner.start('start')).toThrow('lt requires numeric values');
    }
  });

  it('interpolates a named once condition at evaluation time', () => {
    const logs: string[] = [];
    const runner = new ScriptRunner(
      parseRpgScript('@start\n+?once("seen-{name}"):+log("new {name}")', 'once.rpgscript'),
      (message) => logs.push(message),
    );
    runner.setGlobal('name', 'Ada');
    runner.start('start');
    runner.start('start');
    runner.setGlobal('name', 'Bea');
    runner.start('start');
    expect(logs.map((message) => message.split(' (')[0])).toEqual([
      '[RPGSCRIPT] new Ada',
      '[RPGSCRIPT] new Bea',
    ]);
  });

  it('substitutes both prompt types when shown, without changing static branch targets', () => {
    const library = parseRpgScript(
      `@start
+awaitChoice("What about the {item}?", "Take {item}", "Skip {missing}")
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
    runner.setGlobal('item', 'key');
    runner.start('start');
    expect(runner.choice).toEqual({ question: 'What about the key?', options: ['Take key', 'Skip '] });
    runner.setGlobal('item', 'coin');
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
