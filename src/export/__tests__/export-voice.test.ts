import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { dispatchVoiceRequest } from '../../editor/voice/api.js';
import type { StudioApproval } from '../../editor/voice/types.js';
import { createProject, type LoadedProject } from '../../project/project.js';
import { getVoiceRevision } from '../../voice/contracts.js';
import { exportGame } from '../export-game.js';
import { exportVoice } from '../export-voice.js';

const approvedBytes = Buffer.from('synthetic approved bytes');
const published = {
  lineId: 'v_wait',
  revision: getVoiceRevision('Guide', 'Wait here.'),
  file: 'wait.mp3',
  checksum: createHash('sha256').update(approvedBytes).digest('hex'),
};

let directory: string;
let project: LoadedProject;
let outputPath: string;

beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'incanterm-export-voice-'));
  outputPath = path.join(directory, 'release');
  project = await createProject(path.join(directory, 'source'), 'Voice export');
});

afterEach(async () => {
  await fs.rm(directory, { recursive: true, force: true });
});

async function writeScript(name: string, ...lines: string[]) {
  await fs.writeFile(
    path.join(project.assetsRoot, 'scripts', `${name}.rpgscript`),
    [`@${name}`, ...lines, ''].join('\n'),
  );
}

async function writeIndex(
  clips: unknown[],
  directory = path.join(project.assetsRoot, 'audio', 'voice'),
) {
  await fs.mkdir(directory);
  await fs.writeFile(path.join(directory, 'index.json'), JSON.stringify({ version: 1, clips }));
  return directory;
}

it('reports missing publication at the requested dialogue and cleans up the release', async () => {
  await writeScript(
    'greet',
    'Guide: "Text only."',
    '+playDialogue(Guide, "Wait here.", "", "v_wait")',
  );
  await expect(exportGame({ projectPath: project.root, outputPath })).rejects.toThrow(
    /greet\.rpgscript:3/,
  );
  await expect(fs.access(outputPath)).rejects.toMatchObject({ code: 'ENOENT' });
});

it('reports both source locations for a duplicate, even if one request was turned off', async () => {
  await writeScript('greet', '+playDialogue(Guide, "Wait here.", "", "v_wait")');
  await writeScript('leave', '+playDialogue(Guide, "Wait there.", "", "v_wait", "no-voice")');
  const result = exportGame({ projectPath: project.root, outputPath });
  await expect(result).rejects.toThrow(/greet\.rpgscript:2/);
  await expect(result).rejects.toThrow(/leave\.rpgscript:2/);
  await expect(fs.access(outputPath)).rejects.toMatchObject({ code: 'ENOENT' });
});

it.each([
  {
    fault: 'stale',
    clip: { ...published, revision: getVoiceRevision('Guide', 'Wait outside.') },
    error: /stale/i,
  },
  { fault: 'missing entry', clip: { ...published, lineId: 'other' }, error: /missing/i },
  { fault: 'missing file', clip: { ...published, file: 'lost.mp3' }, error: /lost\.mp3/ },
  { fault: 'changed bytes', clip: published, error: /checksum/i },
  { fault: 'unsafe path', clip: { ...published, file: '../original.mp3' }, error: /invalid/i },
])(
  'rejects $fault with its location before producing a release',
  async ({ fault, clip, error }) => {
    await writeScript('greet', '+playDialogue(Guide, "Wait here.", "", "v_wait")');
    const directory = await writeIndex([clip]);
    await fs.writeFile(
      path.join(directory, 'wait.mp3'),
      fault === 'changed bytes' ? 'different synthetic bytes' : approvedBytes,
    );
    const result = exportGame({ projectPath: project.root, outputPath });
    await expect(result).rejects.toThrow(error);
    await expect(result).rejects.toThrow(/greet\.rpgscript:2/);
    await expect(fs.access(outputPath)).rejects.toMatchObject({ code: 'ENOENT' });
  },
);

it('validates staged wording rather than a later save in the source project', async () => {
  const staged = await createProject(path.join(directory, 'snapshot'), 'Snapshot');
  await writeScript('greet', '+playDialogue(Guide, "Wait here.", "", "v_wait")');
  const voice = await writeIndex([published]);
  await fs.writeFile(path.join(voice, published.file), approvedBytes);
  await fs.writeFile(
    path.join(staged.assetsRoot, 'scripts', 'greet.rpgscript'),
    '@greet\n+playDialogue(Guide, "Already moved.", "", "v_wait")\n',
  );
  await expect(exportVoice(project.assetsRoot, staged.assetsRoot)).rejects.toThrow(/stale/i);
});

it('requires republication after a different take is approved for identical wording', async () => {
  await writeScript('greet', '+playDialogue(Guide, "Wait here.", "", "v_wait")');
  const { lineId, revision } = published;
  async function saveApprovedTake(
    text: string,
    expectedApproval: StudioApproval | null = null,
  ): Promise<StudioApproval> {
    const reservation = await dispatchVoiceRequest(
      project,
      'POST',
      ['takes'],
      JSON.stringify({ lineId, revision }),
      'application/json',
    );
    expect(reservation.status).toBe(200);
    const { id } = JSON.parse(String(reservation.body));
    const upload = await dispatchVoiceRequest(
      project,
      'PUT',
      ['takes', id, 'audio'],
      Buffer.from(text),
      'audio/webm',
    );
    expect(upload.status).toBe(200);
    const approval = await dispatchVoiceRequest(
      project,
      'PUT',
      ['takes', id, 'approval'],
      JSON.stringify({ revision, expectedApproval }),
      'application/json',
    );
    expect(approval.status).toBe(200);
    return JSON.parse(String(approval.body));
  }
  const firstApproval = await saveApprovedTake('take A');
  const voice = await writeIndex([published]);
  await fs.writeFile(path.join(voice, published.file), approvedBytes);
  await saveApprovedTake('take B', firstApproval);
  await expect(exportGame({ projectPath: project.root, outputPath })).rejects.toThrow(
    /greet\.rpgscript:2: v_wait: missing published voice clip/,
  );
  await expect(fs.access(outputPath)).rejects.toMatchObject({ code: 'ENOENT' });
});

it('exports text-only and disabled dialogue with no published index', async () => {
  await writeScript(
    'greet',
    'Guide: "Text only."',
    '+playDialogue(Guide, "Changed.", "", "v_wait", "no-voice")',
  );
  await exportGame({ projectPath: project.root, outputPath });
  const voice = path.join(outputPath, 'game', 'assets', 'audio', 'voice');
  expect(await fs.readdir(voice)).toEqual(['index.json']);
  expect(JSON.parse(await fs.readFile(path.join(voice, 'index.json'), 'utf8'))).toEqual({
    version: 1,
    clips: [],
  });
});

it('rejects a linked published directory even when its index and checksum match', async () => {
  await writeScript('greet', '+playDialogue(Guide, "Wait here.", "", "v_wait")');
  const outside = await writeIndex([published], path.join(directory, 'outside'));
  await fs.writeFile(path.join(outside, published.file), approvedBytes);
  await fs.symlink(outside, path.join(project.assetsRoot, 'audio', 'voice'), 'junction');
  await expect(exportGame({ projectPath: project.root, outputPath })).rejects.toThrow(/link/);
  await expect(fs.access(outputPath)).rejects.toMatchObject({ code: 'ENOENT' });
});
