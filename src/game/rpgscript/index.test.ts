import fs from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  commands,
  loadRpgScripts,
  parseRpgScript,
  ScriptParser,
  ScriptRunner,
  TriggerType,
} from './index.js';
import { Scene } from '../scene.js';
import { createGameSession } from '../../server/game-session.js';

describe('RPGScript editor command catalog', () => {
  it('uses the configured scene-commands file in the language extension’s discoverable format', async () => {
    const settings = JSON.parse(
      await fs.readFile(path.join(process.cwd(), '.vscode/settings.json'), 'utf8'),
    ) as Record<string, string>;
    expect(settings['rpgscript.sceneCommandsPath']).toBe(
      '$' + '{workspaceFolder}/src/game/rpgscript/scene-commands.ts',
    );
    const source = await fs.readFile(
      path.join(process.cwd(), 'src/game/rpgscript/scene-commands.ts'),
      'utf8',
    );
    const declaration = /\b(?:export\s+)?(?:const|let|var)\s+commands\s*=\s*\{/.exec(source);
    expect(declaration?.index).toBeDefined();
    if (!declaration || declaration.index === undefined) return;
    const body = source.slice(declaration.index + declaration[0].length).split('}')[0];
    const discovered = body.replace(/\s/g, '').split(',').slice(0, -1);
    expect(discovered).toEqual(Object.keys(commands));
    for (const name of discovered) {
      expect(source).toContain(`const ${name} = `);
    }
  });
});

describe('RPGScript dialogue', () => {
  it('loads the real dialogue asset and advances through a script call', async () => {
    const scripts = await loadRpgScripts(path.join(process.cwd(), 'assets'));
    const logged: string[] = [];
    const runner = new ScriptRunner(scripts, (message) => logged.push(message));
    runner.start('testDialogue1');
    expect(runner.dialogue).toEqual({
      actor: 'Guide',
      text: 'Welcome to Incanterm.',
    });
    runner.advance();
    expect(runner.dialogue?.text).toBe('The crate is waiting for you.');
    runner.advance();
    expect(runner.dialogue?.text).toBe('See you soon.');
    runner.advance();
    expect(runner.dialogue).toBeUndefined();
    expect(runner.getStorage('a')).toBe(false);
    expect(logged).toEqual([
      '[RPGSCRIPT] A is set (test-dialogue.rpgscript:10)',
      '[RPGSCRIPT] A is set (test-dialogue.rpgscript:13)',
    ]);
  });

  it('keeps positions independent for two players', () => {
    const scripts = parseRpgScript('@start\nA: "First"\nA: "Second"', 'example.rpgscript');
    const definition = scripts.get('start');
    expect(Object.isFrozen(definition)).toBe(true);
    expect(Object.isFrozen(definition?.blocks)).toBe(true);
    expect(Object.isFrozen(definition?.blocks[0].steps[0])).toBe(true);
    const first = new ScriptRunner(scripts);
    const second = new ScriptRunner(scripts);
    first.start('start');
    second.start('start');
    first.advance();
    expect(first.dialogue?.text).toBe('Second');
    expect(second.dialogue?.text).toBe('First');
  });

  it('accepts the RPGScript script-call shorthand', () => {
    const scripts = parseRpgScript('@start\n+:next();\n@next\nA: "Called"', 'example.rpgscript');
    const runner = new ScriptRunner(scripts);
    runner.start('start');
    expect(runner.dialogue).toEqual({ actor: 'A', text: 'Called' });
  });

  it('parses the original language constructs before validating runtime support', () => {
    const parsed = new ScriptParser('example.rpgscript').parse(
      '#door\nload,start\n@start\n+?all(is("a"), is("b")):{\n  +wait(10)\n}\n$\nContinue:next',
    );
    expect(parsed.triggers.door.scriptCalls[0].scriptName).toBe('start');
    expect(parsed.scripts.start.blocks[0].conditional).toMatchObject({
      type: 'all',
    });
    expect(parsed.scripts.start.blocks[0].commands[0]).toMatchObject({
      type: 'wait',
      args: [10],
    });
    expect(Object.getPrototypeOf(parsed.scripts.start)).toBe(Object.prototype);
    expect(parsed.scripts.start.blocks[1].commands[0].type).toBe('showChoices');
    expect(() => parseRpgScript('@start\n+?is(flag):{\n  +wait(10)\n}', 'bad.rpgscript')).toThrow(
      'Unknown command wait',
    );
  });

  it('splits nested arguments and finds conditional delimiters outside quoted text', () => {
    const parsed = new ScriptParser('example.rpgscript').parse(
      '@start\n+?is("a:b"):+callScript("next", all(is("a,b"), is("c")))',
    );
    expect(parsed.scripts.start.blocks[0].conditional).toMatchObject({
      type: 'is',
      args: ['a:b'],
    });
    expect(parsed.scripts.start.blocks[0].commands[0].args).toEqual([
      'next',
      'all(is("a,b"), is("c"))',
    ]);
  });

  it('preserves RPGScript number and quoted-string argument formatting', () => {
    const parsed = new ScriptParser('example.rpgscript').parse(
      '@start\n+example(1, -2, "03", "a,b")',
    );
    expect(parsed.scripts.start.blocks[0].commands[0].args).toEqual([1, -2, '03', 'a,b']);
  });

  it('does not mistake command arguments containing dialogue-like text for dialogue', () => {
    const parsed = new ScriptParser('example.rpgscript').parse(
      '@start\n+?is(flag):{\n  +callScript(\'name: "hello"\')\n}',
    );
    expect(parsed.scripts.start.blocks[0].commands[0]).toMatchObject({
      type: 'callScript',
      args: ['name: "hello"'],
    });
  });

  it('does not retain state when a parser is reused for another document', () => {
    const parser = new ScriptParser('example.rpgscript');
    const first = parser.parse('@first\nGuide: "One"');
    const second = parser.parse('@second\nGuide: "Two"');
    expect(Object.keys(first.scripts)).toEqual(['first']);
    expect(Object.keys(second.scripts)).toEqual(['second']);
  });

  it('keeps the outer condition when a nested conditional block closes', () => {
    const parsed = new ScriptParser('nested.rpgscript').parse(
      '@start\n+?is("outer"):{\n  +?is("inner"):{\n    +callScript("one")\n  }\n  +callScript("two")\n}\n',
    );
    const blocks = parsed.scripts.start.blocks.filter((block) => block.commands.length > 0);
    expect(blocks).toHaveLength(2);
    expect(blocks[0].conditional).toMatchObject({ type: 'all' });
    expect(blocks[1].conditional).toMatchObject({ type: 'all' });
    expect(blocks[1].conditional).toEqual({
      type: 'all',
      args: [true, { type: 'branch', args: [0] }],
    });
  });

  it('reports unbalanced blocks with a source location', () => {
    expect(() => new ScriptParser('bad.rpgscript').parse('@start\n}')).toThrow(
      'bad.rpgscript:2: Unexpected closing brace',
    );
    expect(() => new ScriptParser('bad.rpgscript').parse('@start\n+?is(flag):{')).toThrow(
      'bad.rpgscript:2: Unclosed conditional block',
    );
  });

  it('rejects duplicate script names with file and line', () => {
    expect(() => parseRpgScript('@start\nA: "First"\n@start', 'dup.rpgscript')).toThrow(
      'dup.rpgscript:3: Duplicate script start',
    );
  });

  it('rejects unsupported features with a source location instead of silently ignoring them', () => {
    expect(() => parseRpgScript('@start\n+wait(5)', 'bad.rpgscript')).toThrow('bad.rpgscript:2');
    expect(() => parseRpgScript('@start\nA: "missing', 'bad.rpgscript')).toThrow('bad.rpgscript:2');
  });

  it('rejects missing script targets while loading', async () => {
    const root = await fs.mkdtemp(path.join(process.cwd(), '.data', 'rpgscript-test-'));
    try {
      await fs.mkdir(path.join(root, 'scripts'));
      await fs.writeFile(
        path.join(root, 'scripts', 'bad.rpgscript'),
        '@start\n+callScript("missing")',
      );
      await expect(loadRpgScripts(root)).rejects.toThrow('bad.rpgscript:2: Unknown script missing');
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});

describe('RPGScript execution', () => {
  it('supports bare else in nested blocks and inline branches with the same cached results', () => {
    const source = `@start
+?is(parent):{
  +parent=false
  +?is(child):+log("child")
  +?else:+log("inner else")
}
+?else:{
  +log("outer else")
}`;
    const scripts = parseRpgScript(source, 'else.rpgscript');
    expect(scripts).toEqual(
      parseRpgScript(source.replaceAll('?else:', '?else():'), 'else.rpgscript'),
    );
    const messages: string[] = [];
    const runner = new ScriptRunner(scripts, (message) => messages.push(message));
    runner.setStorage('parent', true);
    runner.start('start');
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain('inner else');
    messages.length = 0;
    runner.start('start');
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain('outer else');
    expect(() => parseRpgScript('@start\n+?else:+log("orphan")', 'else.rpgscript')).toThrow(
      'requires a preceding conditional',
    );
    expect(() =>
      parseRpgScript(
        '@start\n+?is(a):+log("if")\n+?else:+log("else")\n+?else:+log("again")',
        'else.rpgscript',
      ),
    ).toThrow('requires a preceding conditional');
  });

  it('uses the saved if result for else even when the if body changes storage', () => {
    const scripts = parseRpgScript(
      '@start\n+?is(a):{\n  +setStorage(a, false)\n  +log("if")\n}\n+?else():{\n  +log("else")\n}\n+log("after")',
      'else.rpgscript',
    );
    const messages: string[] = [];
    const runner = new ScriptRunner(scripts, (message) => messages.push(message));
    runner.setStorage('a', true);
    runner.start('start');
    expect(messages.map((message) => message.split(' (')[0])).toEqual([
      '[RPGSCRIPT] if',
      '[RPGSCRIPT] after',
    ]);
    expect(runner.getStorage('a')).toBe(false);
    messages.length = 0;
    runner.start('start');
    expect(messages.map((message) => message.split(' (')[0])).toEqual([
      '[RPGSCRIPT] else',
      '[RPGSCRIPT] after',
    ]);
  });

  it('supports an inline else after an inline conditional and an empty if body', () => {
    for (const ifBody of ['+?is(a):+log("if")', '+?is(a):{\n}']) {
      const messages: string[] = [];
      const runner = new ScriptRunner(
        parseRpgScript(`@start\n${ifBody}\n+?else():+log("else")`, 'else.rpgscript'),
        (message) => messages.push(message),
      );
      runner.start('start');
      expect(messages).toHaveLength(1);
      expect(messages[0]).toContain('[RPGSCRIPT] else');
    }
  });

  it('binds nested else to its sibling without rechecking the outer condition', () => {
    const scripts = parseRpgScript(
      '@start\n+?is(parent):{\n  +setStorage(parent, false)\n  +?is(child):{\n    +log("child")\n  }\n  +?else():{\n    +log("inner else")\n  }\n}\n+?else():{\n  +log("outer else")\n}',
      'else.rpgscript',
    );
    const messages: string[] = [];
    const runner = new ScriptRunner(scripts, (message) => messages.push(message));
    runner.setStorage('parent', true);
    runner.start('start');
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain('inner else');
    messages.length = 0;
    runner.start('start');
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain('outer else');
  });

  it('rejects an orphan, repeated, or argument-taking else with a location', () => {
    expect(() => parseRpgScript('@start\n+?else():+log("x")', 'else.rpgscript')).toThrow(
      'else.rpgscript:2: else() requires a preceding conditional',
    );
    expect(() =>
      parseRpgScript(
        '@start\n+?is(a):+log("if")\n+log("other")\n+?else():+log("else")',
        'else.rpgscript',
      ),
    ).toThrow('else.rpgscript:4: else() requires a preceding conditional');
    expect(() =>
      parseRpgScript(
        '@start\n+?is(a):+log("if")\n+?else():+log("else")\n+?else():+log("again")',
        'else.rpgscript',
      ),
    ).toThrow('else.rpgscript:4: else() requires a preceding conditional');
    expect(() =>
      parseRpgScript('@start\n+?is(a):+log("if")\n+?else(a):+log("else")', 'else.rpgscript'),
    ).toThrow('else.rpgscript:3: else() requires a preceding conditional');
  });

  it('evaluates nested is/isnot inside all alongside a numeric gt', () => {
    const source = '@start\n+?all(is(isnot(a)), gt(b, 0)):A: "Matched"';
    const scripts = parseRpgScript(source, 'nested.rpgscript');
    const runner = new ScriptRunner(scripts);

    runner.setStorage('a', false);
    runner.setStorage('b', 1);
    runner.start('start');
    expect(runner.dialogue?.text).toBe('Matched');

    runner.setStorage('a', true);
    runner.start('start');
    expect(runner.dialogue).toBeUndefined();

    runner.setStorage('a', false);
    runner.setStorage('b', 0);
    runner.start('start');
    expect(runner.dialogue).toBeUndefined();

    expect(() => parseRpgScript(source.replace('gt(b, 0)', 'gt(b)'), 'nested.rpgscript')).toThrow(
      'nested.rpgscript:2: Invalid arguments for condition gt',
    );
  });

  it('keeps a passing block active after its first command changes the condition', () => {
    const source =
      '@start\n+setStorage(a, true);\n+?is(a):{\n  +setStorage(a, false);\n  +log("A is set");\n}';
    const library = parseRpgScript(source, 'blocks.rpgscript');
    const messages: string[] = [];
    const runner = new ScriptRunner(library, (message) => messages.push(message));

    runner.start('start');

    expect(runner.getStorage('a')).toBe(false);
    expect(messages).toEqual(['[RPGSCRIPT] A is set (blocks.rpgscript:5)']);

    const skipped = new ScriptRunner(
      parseRpgScript(
        source.replace('setStorage(a, true)', 'setStorage(a, false)'),
        'blocks.rpgscript',
      ),
      (message) => messages.push(message),
    );
    skipped.start('start');
    expect(messages).toHaveLength(1);
  });

  it('evaluates nested conditions once per block and isolates session storage', () => {
    const scripts = parseRpgScript(
      '@start\n+setStorage(flag, true)\n+?is(flag):{\n  +?eq(flag, true):{\n    +setStorage(flag, false)\n    A: "Shown"\n    A: "Still shown"\n  }\n  A: "Outer remains active"\n}\n+?isnot(flag):A: "Done"',
      'logic.rpgscript',
    );
    const first = new ScriptRunner(scripts);
    const second = new ScriptRunner(scripts);
    first.start('start');
    second.start('start');
    expect(first.dialogue?.text).toBe('Shown');
    first.advance();
    expect(first.dialogue?.text).toBe('Still shown');
    expect(second.dialogue?.text).toBe('Shown');
    first.advance();
    expect(first.dialogue?.text).toBe('Outer remains active');
    first.advance();
    expect(first.dialogue?.text).toBe('Done');
    expect(first.getStorage('flag')).toBe(false);
    expect(second.getStorage('flag')).toBe(false);
  });

  it('checks trigger calls in order and commits once only for a successful condition', () => {
    const scripts = parseRpgScript(
      '#door\naction,?all(once(key),is(open)):first\naction,?once(key):second\n@first\nA: "First"\n@second\nA: "Second"',
      'triggers.rpgscript',
    );
    const first = new ScriptRunner(scripts);
    const second = new ScriptRunner(scripts);
    expect(first.dispatchTrigger('door', TriggerType.ACTION)).toBe(true);
    expect(first.dialogue?.text).toBe('Second');
    first.advance();
    expect(first.dispatchTrigger('door', TriggerType.ACTION)).toBe(false);
    second.setStorage('open', true);
    expect(second.dispatchTrigger('door', TriggerType.ACTION)).toBe(true);
    expect(second.dialogue?.text).toBe('First');
    expect(second.dispatchTrigger('door', TriggerType.ACTION)).toBe(false);
    second.advance();
    expect(second.dispatchTrigger('door', TriggerType.ACTION)).toBe(false);
    expect(first.getStorage('open')).toBeUndefined();
  });

  it('falls back when either equality operand is undefined, while matching defined falsey values', () => {
    const scripts = parseRpgScript(
      '#door\naction,+?eq({vars.a}, {vars.b}):matched\naction,fallback\n@matched\nA: "Matched"\n@fallback\nA: "Fallback"',
      'triggers.rpgscript',
    );
    const cases = [
      [undefined, undefined, 'Fallback'],
      [undefined, 0, 'Fallback'],
      [0, undefined, 'Fallback'],
      [0, 0, 'Matched'],
      [false, false, 'Matched'],
      ['', '', 'Matched'],
      [1, 2, 'Fallback'],
      [0, false, 'Fallback'],
    ] as const;
    const missing = new ScriptRunner(scripts);
    missing.dispatchTrigger('door', TriggerType.ACTION);
    expect(missing.dialogue?.text).toBe('Fallback');
    for (const [left, right, expected] of cases) {
      const runner = new ScriptRunner(scripts);
      runner.setStorage('vars.a', left);
      runner.setStorage('vars.b', right);
      expect(runner.dispatchTrigger('door', TriggerType.ACTION)).toBe(true);
      expect(runner.dialogue?.text).toBe(expected);
    }
  });

  it('does not consume once from a failing alternative inside any', () => {
    const scripts = parseRpgScript(
      '@start\n+?any(all(once(key),is(missing)),once(key)):A: "Available"',
      'once.rpgscript',
    );
    const runner = new ScriptRunner(scripts);
    runner.start('start');
    expect(runner.dialogue?.text).toBe('Available');
    runner.advance();
    runner.start('start');
    expect(runner.dialogue).toBeUndefined();
  });

  it('requires explicit instance identity for oncePerInstance', () => {
    const scripts = parseRpgScript(
      '#lever\naction,?oncePerInstance():use\n@use\nA: "Used"',
      'lever.rpgscript',
    );
    const runner = new ScriptRunner(scripts);
    expect(() => runner.dispatchTrigger('lever', TriggerType.ACTION)).toThrow('instanceId');
    expect(runner.dispatchTrigger('lever', TriggerType.ACTION, 'a')).toBe(true);
    runner.advance();
    expect(runner.dispatchTrigger('lever', TriggerType.ACTION, 'a')).toBe(false);
    expect(runner.dispatchTrigger('lever', TriggerType.ACTION, 'b')).toBe(true);
  });

  it('propagates the instance identity into called script blocks', () => {
    const scripts = parseRpgScript(
      '#lever\naction,use\n@use\n+:inner()\n@inner\n+?oncePerInstance():A: "Used"',
      'lever.rpgscript',
    );
    const runner = new ScriptRunner(scripts);
    expect(runner.dispatchTrigger('lever', TriggerType.ACTION, 'a')).toBe(true);
    expect(runner.dialogue?.text).toBe('Used');
    runner.advance();
    expect(runner.dispatchTrigger('lever', TriggerType.ACTION, 'a')).toBe(true);
    expect(runner.dialogue).toBeUndefined();
    expect(runner.dispatchTrigger('lever', TriggerType.ACTION, 'b')).toBe(true);
    expect(runner.dialogue?.text).toBe('Used');
  });

  it('handles choices and makes lastChoiceIndex available to following conditions', () => {
    const scripts = parseRpgScript(
      '@start\nA: "Pick"\n$\nYes:yes\nNo:no\n+?eq(lastChoiceIndex, 1):A: "No was chosen"\n@yes\nA: "Yes branch"\n@no\nA: "No branch"',
      'choices.rpgscript',
    );
    const runner = new ScriptRunner(scripts);
    runner.start('start');
    runner.advance();
    expect(runner.choice?.options).toEqual(['Yes', 'No']);
    expect(() => runner.choose(2)).toThrow('No such RPGScript choice');
    runner.choose(1);
    expect(runner.dialogue?.text).toBe('No branch');
    runner.advance();
    expect(runner.dialogue?.text).toBe('No was chosen');
    expect(runner.getStorage('lastChoiceIndex')).toBe(1);
  });

  it('supports awaitChoice without a branch', () => {
    const runner = new ScriptRunner(
      parseRpgScript(
        '@start\n+awaitChoice("A", "B")\n+?eq(lastChoiceIndex, 0):A: "A chosen"',
        'choice.rpgscript',
      ),
    );
    runner.start('start');
    expect(runner.choice?.options).toEqual(['A', 'B']);
    runner.choose(0);
    expect(runner.dialogue?.text).toBe('A chosen');
  });

  it('rejects unsupported condition functions and invalid trigger targets with locations', () => {
    expect(() => parseRpgScript('@s\n+?with(Sword):A: "Hi"', 'bad.rpgscript')).toThrow(
      'bad.rpgscript:2: Condition with is not supported yet',
    );
    expect(() => parseRpgScript('#door\naction,target(1)', 'bad.rpgscript')).toThrow(
      'bad.rpgscript:2: Trigger target',
    );
    expect(() => parseRpgScript('#door\nbad,target', 'bad.rpgscript')).toThrow(
      'bad.rpgscript:2: Unknown trigger event bad',
    );
    expect(() => parseRpgScript('#door\naction,a\n#door\naction,a', 'bad.rpgscript')).toThrow(
      'bad.rpgscript:3: Duplicate trigger door',
    );
    expect(() => parseRpgScript('@s\n+?all(flag):A: "Hi"', 'bad.rpgscript')).toThrow(
      'bad.rpgscript:2: Invalid arguments for condition all',
    );
    expect(() => parseRpgScript('@s\n+?with(Sword):{\n}', 'bad.rpgscript')).toThrow(
      'Condition with is not supported yet',
    );
    expect(() => parseRpgScript('@s\nA: "Hello [name]"', 'bad.rpgscript')).toThrow(
      'bad.rpgscript:2: Unknown local [name]',
    );
  });

  it('loads trigger targets across files and diagnoses missing ones', async () => {
    const root = await fs.mkdtemp(path.join(process.cwd(), '.data', 'rpgscript-test-'));
    try {
      await fs.mkdir(path.join(root, 'scripts'));
      await fs.writeFile(path.join(root, 'scripts', 'one.rpgscript'), '#door\naction,two');
      await expect(loadRpgScripts(root)).rejects.toThrow('one.rpgscript:2: Unknown script two');
      await fs.writeFile(path.join(root, 'scripts', 'two.rpgscript'), '@two\nA: "Loaded"');
      const runner = new ScriptRunner(await loadRpgScripts(root));
      expect(runner.dispatchTrigger('door', TriggerType.ACTION)).toBe(true);
      expect(runner.dialogue?.text).toBe('Loaded');
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('accepts numbered choices from input without advancing on unrelated keys', () => {
    const scripts = parseRpgScript(
      '#room-entry\nload,test-dialogue\n@test-dialogue\n+awaitChoice("First", "Second")\n+?eq(lastChoiceIndex, 1):A: "Selected second"',
      'session.rpgscript',
    );
    const scene = new Scene(
      'choices-room',
      1,
      1,
      'regular-z',
      {
        ch: ' ',
        fg: { r: 255, g: 255, b: 255 },
        bg: { r: 0, g: 0, b: 0 },
      },
      [],
      ['room-entry'],
    );
    const first: string[] = [];
    const second: string[] = [];
    const a = createGameSession(scene, (text) => first.push(text), scripts);
    const b = createGameSession(scene, (text) => second.push(text), scripts);
    a.open();
    b.open();
    expect(first.at(-1)).toContain('2. Second');
    a.input(' ');
    a.input('3');
    expect(first).toHaveLength(1);
    a.input('2');
    expect(first.at(-1)).toContain('Selected second');
    expect(second.at(-1)).toContain('2. Second');
  });
});
