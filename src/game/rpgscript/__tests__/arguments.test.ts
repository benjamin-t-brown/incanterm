import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadRpgScripts, parseRpgScript, ScriptRunner } from './test-support.js';

describe('RPGScript call-local arguments', () => {
  it('runs the authored example without writing arguments into session storage', async () => {
    const logs: string[] = [];
    const runner = new ScriptRunner(await loadRpgScripts('assets'), (text) => logs.push(text));
    runner.setStorage('arg1', 'global');
    runner.start('testArgs');
    expect(logs.map((log) => log.replace(/ \(test-room-triggers\.rpgscript:\d+\)$/, ''))).toEqual([
      '[RPGSCRIPT] Args a',
      '[RPGSCRIPT] Arg 1 is good',
      '[RPGSCRIPT] Args ',
      '[RPGSCRIPT] Arg1 is bad',
    ]);
    expect(runner.getStorage('arg1')).toBe('global');
    expect(runner.getStorage('arg2')).toBeUndefined();
    expect(runner.isIdle()).toBe(true);
  });

  it('preserves types across calls, local writes, and global reads', () => {
    const runner = new ScriptRunner(
      parseRpgScript(
        `@start
      +:receive("42", 42, false, "false", {missing})
    @receive(text, number, flag, word, absent)
      +text=[text]
      +number=[number]
      +flag=[flag]
      +word=[word]
      +absent=[absent]
      +[number]=7
      +updated=[number]
      +[text]="23"
      +updated_text=[text]
      +?all(eq([number], 7), isnot([flag])):+passed=true`,
        'args.rpgscript',
      ),
    );
    runner.start('start');
    expect(runner.getStorage('text')).toBe('42');
    expect(runner.getStorage('number')).toBe(42);
    expect(runner.getStorage('flag')).toBe(false);
    expect(runner.getStorage('word')).toBe('false');
    expect(runner.getStorage('absent')).toBeUndefined();
    expect(runner.getStorage('updated')).toBe(7);
    expect(runner.getStorage('updated_text')).toBe('23');
    expect(runner.getStorage('passed')).toBe(true);
  });

  it('retains caller locals across recursion, dialogue, and choices', () => {
    const runner = new ScriptRunner(
      parseRpgScript(
        `@recurse(value)
      +?eq([value], "outer"):{
        +:recurse("inner")
      }
      Guide: "[value]"
      +awaitChoice("Choose [value]")
      +[value]="changed"
      Guide: "[value]"`,
        'args.rpgscript',
      ),
    );
    runner.start('recurse', ['outer']);
    expect(runner.dialogue?.text).toBe('inner');
    runner.advance();
    expect(runner.choice?.options).toEqual(['Choose inner']);
    runner.choose(0);
    expect(runner.dialogue?.text).toBe('changed');
    runner.advance();
    expect(runner.dialogue?.text).toBe('outer');
    runner.advance();
    expect(runner.choice?.options).toEqual(['Choose outer']);
    runner.choose(0);
    runner.advance();
    expect(runner.isIdle()).toBe(true);
    expect(runner.getStorage('value')).toBeUndefined();
  });

  it('resolves caller arguments once and keeps separate runners isolated', () => {
    const library = parseRpgScript(
      `@start(value)
      +:child([value], "[value] {global}")
    @child(value, text)
      Guide: "[value]|[text]"`,
      'args.rpgscript',
    );
    const first = new ScriptRunner(library);
    const second = new ScriptRunner(library);
    first.setStorage('global', '[value]');
    first.start('start', ['{global}']);
    second.start('start', ['other']);
    expect(first.dialogue?.text).toBe('{global}|{global} [value]');
    expect(second.dialogue?.text).toBe('other|other ');
  });

  it.each([
    '+log("[missing]")',
    '+[missing]=1',
    '+setLocal(missing, 1)',
    '+?is([missing]):+log("x")',
  ])('rejects unknown locals in %s', (body) => {
    expect(() => parseRpgScript(`@start(known)\n${body}`, 'bad.rpgscript')).toThrow(
      'Unknown local [missing]',
    );
  });

  it.each(['@bad(a, a)', '@bad(a,)', '@bad(1)', '@bad(a', '@bad(a) trailing'])(
    'rejects invalid signatures: %s',
    (header) => {
      expect(() => parseRpgScript(header, 'bad.rpgscript')).toThrow('bad.rpgscript:1:');
    },
  );

  it('checks entry and nested argument counts, including empty parentheses', () => {
    const library = parseRpgScript('@start()\n+:child()\n@child(value)', 'bad.rpgscript');
    const runner = new ScriptRunner(library);
    expect(() => runner.start('child')).toThrow('expects 1 argument(s), got 0');
    expect(() => runner.start('start', [1])).toThrow('expects 0 argument(s), got 1');
    expect(() => runner.start('start')).toThrow(
      'bad.rpgscript:2: Script child expects 1 argument(s), got 0',
    );
  });

  it.each(['@start\n+:child()', '#entry\nload,child', '@start\n$\nNext:child'])(
    'checks arity during asset loading: %s',
    async (source) => {
      const root = await fs.mkdtemp(path.join(os.tmpdir(), 'rpgscript-args-'));
      try {
        await fs.mkdir(path.join(root, 'scripts'));
        await fs.writeFile(path.join(root, 'scripts/main.rpgscript'), `${source}\n@child(value)`);
        await expect(loadRpgScripts(root)).rejects.toThrow('expects 1 argument(s), got 0');
      } finally {
        await fs.rm(root, { recursive: true, force: true });
      }
    },
  );
});
