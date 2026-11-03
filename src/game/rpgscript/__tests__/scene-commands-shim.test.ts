import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import { createAnimation, createSprite, createEmptySpriteFrame, createCharacter } from '../../../editor/schema.js';
import { encodeStoredSprite } from '../../../editor/art/sprite-storage.js';
import type { PortraitAssets } from '../../portrait-assets.js';
import { commands } from '../../scene-commands.js';
import { loadRpgScripts } from './test-support.js';
import { runRpgScriptSnippet, sceneCommandsShim, type ShimIO } from '../../scene-commands-shim.js';

describe('scene-free RPGScript shim', () => {
  const roots: string[] = [];
  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
  });

  async function createFixture(): Promise<string> {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'incanterm-rpgscript-shim-'));
    roots.push(root);
    await fs.mkdir(path.join(root, 'scripts'));
    await fs.writeFile(
      path.join(root, 'scripts', 'one.rpgscript'),
      '@testDialogue\nGuide: "First"\n+setStorage(name, "Ada")\n+:next()\n@pick\n$\nYes:yes\nNo:no\n@yes\nGuide: "Yes"\n@no\nGuide: "No"',
    );
    await fs.writeFile(
      path.join(root, 'scripts', 'two.rpgscript'),
      '@next\nGuide: "Hello {name}"\n+log("done {name}")\n+awaitChoice("Go", "Stay")\n+?eq(lastChoiceIndex, 0):+callScript(pick)',
    );
    return root;
  }

  it('supports the server catalog and rejects unknown commands during normal and shim loading', async () => {
    expect(Object.keys(sceneCommandsShim)).toEqual(Object.keys(commands));
    const root = await createFixture();
    await fs.writeFile(path.join(root, 'scripts', 'bad.rpgscript'), '@bad\n+unknownCommand()');
    for (const shim of [false, true]) {
      await expect(loadRpgScripts(root, { shim })).rejects.toThrow(
        'bad.rpgscript:2: Unknown command unknownCommand',
      );
    }
  });

  it('loads cross-file scripts, runs a bare call, prints dialogue/logs, and prompts for both choice forms', async () => {
    const scripts = await loadRpgScripts(await createFixture(), { shim: true });
    const output: string[] = [];
    const prompts: string[][] = [];
    const io: ShimIO = {
      writeLine: (text) => output.push(text),
      async promptChoice(options) {
        prompts.push([...options]);
        return 0;
      },
    };
    const runner = await runRpgScriptSnippet(scripts, 'testDialogue()', io);
    expect(output).toEqual([
      'Guide: First',
      'Guide: Hello Ada',
      '[RPGSCRIPT] done Ada (two.rpgscript:3)',
      'Guide: Yes',
    ]);
    expect(prompts).toEqual([
      ['Go', 'Stay'],
      ['Yes', 'No'],
    ]);
    expect(runner.getStorage('name')).toBe('Ada');
    expect(runner.getStorage('lastChoiceIndex')).toBe(0);
    expect(runner.isIdle()).toBe(true);
  });

  it('executes inline commands and diagnoses missing scripts', async () => {
    const scripts = await loadRpgScripts(await createFixture(), { shim: true });
    const output: string[] = [];
    const io: ShimIO = {
      writeLine: (text) => output.push(text),
      promptChoice: async () => 0,
    };
    await runRpgScriptSnippet(scripts, '+log("Inline")', io);
    expect(output).toEqual(['[RPGSCRIPT] Inline (<terminal>:2)']);
    const portrait = await runRpgScriptSnippet(scripts, '+setConv()\nGuide: "Hello"\n+endConv()', io);
    expect(portrait.getStorage('dialogue.active')).toBe(false);
    expect(output.at(-1)).toBe('Guide: Hello');
    await expect(runRpgScriptSnippet(scripts, 'missing()', io)).rejects.toThrow(
      'Unknown script missing',
    );
    await expect(runRpgScriptSnippet(scripts, '', io)).rejects.toThrow('Expected an RPGScript');
    await expect(runRpgScriptSnippet(scripts, '+testDialogue()', io)).rejects.toThrow(
      '<terminal>:2: Unknown command testDialogue',
    );
    await expect(runRpgScriptSnippet(scripts, '+log()', io)).rejects.toThrow('<terminal>:2:');
  });

  it('prints the speaking character portrait for each dialogue line', async () => {
    const scripts = await loadRpgScripts(await createFixture(), { shim: true });
    const ink = { fg: { r: 255, g: 255, b: 255 }, bg: { r: 0, g: 0, b: 0 } };
    const portraits: PortraitAssets = Object.assign(new Map([
      [
        'talking',
        {
          width: 2,
          height: 2,
          loop: true,
          frames: [
            {
              width: 2,
              height: 2,
              durationMs: 50,
              cells: 'ABCD'.split('').map((ch) => ({ ch, ...ink })),
            },
            {
              width: 2,
              height: 2,
              durationMs: 50,
              cells: 'WXYZ'.split('').map((ch) => ({ ch, ...ink })),
            },
          ],
        },
      ],
    ]), { characters: new Map([['Guide', { id: 'guide', scriptName: 'Guide', portraits: [
      { facing: 'right' as const, emotion: '', portrait: 'talking' },
    ] }]]), });
    const output: string[] = [];
    const io: ShimIO = {
      portraits,
      writeLine: (text) => output.push(text),
      promptChoice: async () => 0,
    };
    await runRpgScriptSnippet(
      scripts,
      '+setConv()\nGuide: "First"\nGuide: "Second"\n+endConv()\nGuide: "Third"',
      io,
    );
    expect(output).toEqual(['AB', 'CD', '', 'Guide: First', 'AB', 'CD', '', 'Guide: Second', 'Guide: Third']);
    output.length = 0;
    await runRpgScriptSnippet(scripts, '+setConv()', io);
    expect(output).toEqual([]);
    output.length = 0;
    await runRpgScriptSnippet(scripts, '+setConv()\n+endConv()', io);
    expect(output).toEqual([]);
    output.length = 0;
    await runRpgScriptSnippet(
      scripts,
      '+log("Before")\n+setConv()\n+log("After")\nGuide: "Later"',
      io,
    );
    expect(output).toEqual([
      '[RPGSCRIPT] Before (<terminal>:2)',
      '[RPGSCRIPT] After (<terminal>:4)',
      'AB',
      'CD',
      '',
      'Guide: Later',
    ]);
  });

  it('validates scene-only commands while allowing scene-free execution', async () => {
    const scripts = await loadRpgScripts(await createFixture(), { shim: true });
    const output: string[] = [];
    const io: ShimIO = {
      writeLine: (text) => output.push(text),
      promptChoice: async () => 0,
    };
    const runner = await runRpgScriptSnippet(
      scripts,
      '+setPlayerWalkCh(hero)\n+chWalkToCoord(npc, 3, 4)\nGuide: "Ready"',
      io,
    );
    expect(output).toEqual(['Guide: Ready']);
    expect(runner.isIdle()).toBe(true);
    await expect(runRpgScriptSnippet(scripts, '+setPlayerWalkCh(42)', io)).rejects.toThrow(
      '<terminal>:2: setPlayerWalkCh requires a character id or instance name',
    );
    await expect(runRpgScriptSnippet(scripts, '+chWalkToCoord(npc, nope, 4)', io)).rejects.toThrow(
      '<terminal>:2: chWalkToCoord requires integer coordinates',
    );
  });

  it('exits with a failure status and prints the location for an unknown inline command', async () => {
    const root = await createFixture();
    const child = spawn(
      process.execPath,
      ['--import', 'tsx', 'src/game/run-terminal.ts', '--assets', root, '+testDialogue()'],
      { cwd: process.cwd(), stdio: ['pipe', 'pipe', 'pipe'] },
    );
    let errors = '';
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
      errors += chunk;
    });
    child.stdin.end();
    const code = await new Promise<number | null>((resolve, reject) => {
      child.once('error', reject);
      child.once('close', resolve);
    });
    expect(code).toBe(1);
    expect(errors).toContain('<terminal>:2: Unknown command testDialogue');
  });

  it('runs the terminal entry point with a piped choice without loading a scene', async () => {
    const root = await createFixture();
    const child = spawn(
      process.execPath,
      ['--import', 'tsx', 'src/game/run-terminal.ts', '--assets', root, 'pick()'],
      { cwd: process.cwd(), stdio: ['pipe', 'pipe', 'pipe'] },
    );
    let output = '';
    let errors = '';
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
      output += chunk;
    });
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
      errors += chunk;
    });
    child.stdin.end('9\n2\n');
    const code = await new Promise<number | null>((resolve, reject) => {
      child.once('error', reject);
      child.once('close', resolve);
    });
    expect(code).toBe(0);
    expect(errors).toBe('');
    expect(output).toContain('1. Yes\n2. No\nChoose (1-2): ');
    expect(output).toContain('Invalid choice; enter a number from the list.');
    expect(output).toContain('Guide: No');
  });

  it('loads a sprite-sheet animation from --assets and prints its first frame in the CLI', async () => {
    const root = await createFixture();
    await fs.mkdir(path.join(root, 'sprites'));
    await fs.mkdir(path.join(root, 'animations'));
    await fs.mkdir(path.join(root, 'characters'));
    const sprite = createSprite('face', 2, 2);
    const first = sprite.sprites[0].layers[0].cells;
    for (const [index, ch] of 'ABCD'.split('').entries()) {
      first[index] = { ch, fg: 'white', bg: 'black' };
    }
    const next = createEmptySpriteFrame(2, 2);
    for (const [index, ch] of 'WXYZ'.split('').entries()) {
      next.layers[0].cells[index] = { ch, fg: 'white', bg: 'black' };
    }
    sprite.sprites.push(next);
    await fs.writeFile(path.join(root, 'sprites', 'face.json'), encodeStoredSprite(sprite));
    const animation = createAnimation('talking');
    animation.frames.push(
      { sprite: 'face', index: 0, durationMs: 30 },
      { sprite: 'face', index: 1, durationMs: 30 },
    );
    await fs.writeFile(path.join(root, 'animations', 'talking.json'), JSON.stringify(animation));
    await fs.writeFile(path.join(root, 'characters', 'guide.json'), JSON.stringify({
      ...createCharacter('guide', 'talking'), scriptName: 'Guide',
      portraits: [{ facing: 'right', emotion: '', portrait: 'talking' }],
    }));
    await fs.writeFile(
      path.join(root, 'scripts', 'portrait.rpgscript'),
      '@portrait\n+setConv()\nGuide: "Hello"',
    );
    const child = spawn(
      process.execPath,
      ['--import', 'tsx', 'src/game/run-terminal.ts', '--assets', root, 'portrait()'],
      { cwd: process.cwd(), stdio: ['pipe', 'pipe', 'pipe'] },
    );
    let output = '';
    let errors = '';
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
      output += chunk;
    });
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
      errors += chunk;
    });
    child.stdin.end();
    const code = await new Promise<number | null>((resolve, reject) => {
      child.once('error', reject);
      child.once('close', resolve);
    });
    expect(code).toBe(0);
    expect(errors).toBe('');
    expect(output).toBe('AB\nCD\n\nGuide: Hello\n');
  });
});
