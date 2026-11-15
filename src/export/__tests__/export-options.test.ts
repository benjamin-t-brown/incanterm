import { expect, it } from 'vitest';
import { parseExportArguments } from '../export-options.js';

it('parses a project, output directory, and optional scene label', () => {
  expect(
    parseExportArguments(
      ['--project', 'My Project', '--out', 'release/game', '--scene', 'Room Label'],
      {},
    ),
  ).toEqual({
    projectPath: 'My Project',
    outputPath: 'release/game',
    sceneReference: 'Room Label',
  });
});

it('allows an explicitly configured environment project', () => {
  expect(
    parseExportArguments(['--out', 'release/game'], { INCANTERM_PROJECT: 'chosen-game' })
      .projectPath,
  ).toBe('chosen-game');
  expect(
    parseExportArguments(['--out', 'release/game', '--project', 'explicit'], {
      INCANTERM_PROJECT: 'other',
    }).projectPath,
  ).toBe('explicit');
});

it.each([
  [],
  ['--project', 'game'],
  ['--out', 'release/game'],
  ['--project'],
  ['--project', 'game', '--out'],
  ['--project', 'game', '--out', '--scene'],
  ['--assets', 'assets'],
  ['--force'],
  ['--project', 'game', '--project', 'other'],
])('rejects incomplete or unsupported export arguments %j', (...args) => {
  expect(() => parseExportArguments(args, {})).toThrow();
});
