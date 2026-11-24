import { mkdtemp, mkdir, rename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { getVoiceRevision, readVoiceCatalog } from '../catalog.js';

let assetsRoot: string;
beforeEach(async () => {
  assetsRoot = await mkdtemp(path.join(os.tmpdir(), 'voice-catalog-'));
  await mkdir(path.join(assetsRoot, 'scripts'));
});
afterEach(async () => {
  await rm(assetsRoot, { recursive: true, force: true });
});

function writeScript(name: string, source: string) {
  return writeFile(path.join(assetsRoot, 'scripts', `${name}.rpgscript`), source);
}

it('rejects assigning a dialogue result and does not expose lines from the invalid file', async () => {
  await writeScript('broken', `@intro
+playDialogue(Ada, "First", "", "v_first")
+result = playDialogue(Ada, "Hello", "", "v_id")`);
  const catalog = await readVoiceCatalog(assetsRoot);
  expect(catalog.lines).toEqual([]);
  expect(catalog.errors).toEqual([{
    file: 'scripts/broken.rpgscript',
    message: 'scripts/broken.rpgscript:3: Command playDialogue does not return a value',
  }]);
});

it('uses the game loader’s top-level script set, including dotted filenames', async () => {
  await writeScript('chapter.1', '@a\n+playDialogue(Tess, "Dotted", "", "v_dot")');
  await mkdir(path.join(assetsRoot, 'scripts', 'unused'));
  await writeScript('unused/scratch', '@b\n+playDialogue(Tess, "Nested", "", "v_dot")');
  const catalog = await readVoiceCatalog(assetsRoot);
  expect(catalog.errors).toEqual([]);
  expect(catalog.duplicates).toEqual([]);
  expect(catalog.lines.map(({ file }) => file)).toEqual(['scripts/chapter.1.rpgscript']);
});

it('uses parsed dialogue, source location and neighboring speech within a script', async () => {
  await writeScript(
    'arrival',
    `@arrival
Ada: "First"
+?is(ready):+playDialogue(Tess, "Lift, please.", sad, "v_test")
+endConv()
+playDialogue(Ada, "Later")
@exit
+playDialogue(Tess, "Bye", "", "v_off", "no-voice")`,
  );
  const catalog = await readVoiceCatalog(assetsRoot);
  expect(catalog.errors).toEqual([]);
  expect(catalog.lines).toEqual([
    {
      file: 'scripts/arrival.rpgscript',
      script: 'arrival',
      line: 3,
      speaker: 'Tess',
      text: 'Lift, please.',
      revision: getVoiceRevision('Tess', 'Lift, please.'),
      lineId: 'v_test',
      requested: true,
      before: { speaker: 'Ada', text: 'First' },
      after: { speaker: 'Ada', text: 'Later' },
    },
    {
      file: 'scripts/arrival.rpgscript',
      script: 'exit',
      line: 7,
      speaker: 'Tess',
      text: 'Bye',
      revision: getVoiceRevision('Tess', 'Bye'),
      lineId: 'v_off',
      requested: false,
      before: null,
      after: null,
    },
  ]);
});

it('retains revisions across moves, indentation, emotion and request changes; tracks speaker and wording', async () => {
  await writeScript('old', '@a\n+playDialogue(Tess, "Wait.", happy, "v_lift")');
  const original = (await readVoiceCatalog(assetsRoot)).lines[0];
  await rename(
    path.join(assetsRoot, 'scripts', 'old.rpgscript'),
    path.join(assetsRoot, 'scripts', 'new.rpgscript'),
  );
  await writeScript('new', `@b\n\n    Tess&sad: 'Wait.' // no-voice v_lift`);
  const moved = (await readVoiceCatalog(assetsRoot)).lines[0];
  expect(moved).toMatchObject({
    file: 'scripts/new.rpgscript',
    line: 3,
    revision: original.revision,
    requested: false,
  });
  expect(getVoiceRevision('Tess', 'Wait!')).not.toBe(moved.revision);
  expect(getVoiceRevision('Ada', 'Wait.')).not.toBe(moved.revision);
});

it('reports both duplicate owners and keeps parse failures distinct from line deletion', async () => {
  await writeScript('one', '@one\n+playDialogue(A, "First", "", "v_dup")');
  await writeScript('two', '@two\n\n+playDialogue(B, "Second", "", "v_dup", "no-voice")');
  await writeScript(
    'bad',
    '@bad\n+playDialogue(C, "Lost", "", "v_unknown")\nBroken: "unterminated',
  );
  const catalog = await readVoiceCatalog(assetsRoot);
  expect(catalog.duplicates).toEqual([
    {
      lineId: 'v_dup',
      locations: [
        { file: 'scripts/one.rpgscript', script: 'one', line: 2 },
        { file: 'scripts/two.rpgscript', script: 'two', line: 3 },
      ],
    },
  ]);
  expect(catalog.errors).toEqual([
    { file: 'scripts/bad.rpgscript', message: expect.stringContaining(':3:') },
  ]);
  expect(catalog.lines).toHaveLength(2);
  await writeScript('bad', '@bad\n+playDialogue(C, "Lost", "", "v_unknown")');
  expect((await readVoiceCatalog(assetsRoot)).errors).toEqual([]);
  await rm(path.join(assetsRoot, 'scripts', 'two.rpgscript'));
  expect((await readVoiceCatalog(assetsRoot)).duplicates).toEqual([]);
});
