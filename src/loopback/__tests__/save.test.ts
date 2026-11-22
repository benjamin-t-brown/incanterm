import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadLoopbackOptions } from '../cli.js';
import { loadSaveVariables } from '../save.js';

it('requires a value for --save', async () => {
  await expect(loadLoopbackOptions(['--save', '--scene', 'room'])).rejects.toThrow('--save');
});

describe('loopback save files', () => {
  let directory: string;
  let savePath: string;

  beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'incanterm-save-'));
    savePath = path.join(directory, 'save.json');
  });

  afterEach(async () => {
    await fs.rm(directory, { recursive: true, force: true });
  });

  it('reads JSON RPGScript values without changing the keys or types', async () => {
    const vars = { 'quest.done': false, 'quest.attempts': 0, 'quest.data': ['book', { count: 2 }] };
    await fs.writeFile(savePath, JSON.stringify({ v: 1, vars }));
    await expect(loadSaveVariables(savePath)).resolves.toEqual(vars);
  });

  it('identifies the file when it does not exist', async () => {
    await expect(loadSaveVariables(savePath)).rejects.toThrow('save.json');
  });

  it.each([
    ['{', 'Invalid JSON'],
    ['{"v": 2, "vars": {}}', 'Expected save version'],
    ['{"v": 1, "room": "other", "vars": {}}', 'Unsupported save field "room"'],
    ['{"v": 1, "vars": []}', '"vars" must be an object'],
    ['{"v": 1, "vars": {"bad name": true}}', 'Invalid RPGScript variable name "bad name"'],
    [
      '{"v": 1, "vars": {"quest.data": [null]}}',
      'Unsupported value for RPGScript variable "quest.data"',
    ],
    [
      '{"v": 1, "vars": {"quest.attempts": 1e400}}',
      'Unsupported value for RPGScript variable "quest.attempts"',
    ],
  ])('rejects invalid save data: %s', async (contents, error) => {
    await fs.writeFile(savePath, contents);
    await expect(loadSaveVariables(savePath)).rejects.toThrow(error);
  });
});
